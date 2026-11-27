using System;
using System.Globalization;
using System.IO;
using System.Net.Mime;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.Oriel.Data;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Net.Http.Headers;

namespace Jellyfin.Plugin.Oriel.Controllers;

/// <summary>
/// Exports the caller's reading data to a file and imports such a file back.
/// </summary>
[ApiController]
[Refusals]
[Route("Oriel")]
[Authorize]
[StoreUnavailable]
public partial class ReadingDataController : ControllerBase
{
    /// <summary>
    /// The largest file accepted for import, in bytes: room for 20 fonts of 5 MB as base64 beside everything else.
    /// </summary>
    public const int MaxImportBytes = 160 * 1024 * 1024;

    private readonly ReadingData _readingData;
    private readonly IAuthorizationContext _authorizationContext;
    private readonly TimeProvider _time;
    private readonly ILogger<ReadingDataController> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="ReadingDataController"/> class.
    /// </summary>
    /// <param name="readingData">Export and import.</param>
    /// <param name="authorizationContext">The host authorization context.</param>
    /// <param name="time">The clock exports are stamped with.</param>
    /// <param name="logger">Where imports and exports are logged; nowhere when null.</param>
    public ReadingDataController(ReadingData readingData, IAuthorizationContext authorizationContext, TimeProvider time, ILogger<ReadingDataController>? logger = null)
    {
        _logger = logger ?? NullLogger<ReadingDataController>.Instance;
        _readingData = readingData;
        _authorizationContext = authorizationContext;
        _time = time;
    }

    /// <summary>
    /// Downloads the caller's reading data: each stored position in a book the caller can see.
    /// </summary>
    /// <returns>The file as a JSON download.</returns>
    [HttpGet("Export")]
    [Produces(MediaTypeNames.Application.Json)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult> Export()
    {
        var userId = await _authorizationContext.CallerAsync(HttpContext).ConfigureAwait(false);
        if (userId is null)
        {
            return Unauthorized();
        }

        var now = _time.GetUtcNow();
        var file = _readingData.Export(userId.Value, now);
        LogExported(_logger, userId.Value, file.Positions?.Count ?? 0, file.Bookmarks?.Count ?? 0, file.Highlights?.Count ?? 0);
        var name = string.Create(CultureInfo.InvariantCulture, $"oriel-reading-data-{now:yyyy-MM-dd}.json");
        // The user's own reading data: kept by no cache along the way.
        Response.Headers.CacheControl = "no-store";
        Response.ContentType = MediaTypeNames.Application.Json;
        var disposition = new ContentDispositionHeaderValue("attachment");
        disposition.SetHttpFileName(name);
        Response.Headers.ContentDisposition = disposition.ToString();
        try
        {
            await ReadingData.WriteAsync(Response.Body, file, HttpContext.RequestAborted).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (HttpContext.RequestAborted.IsCancellationRequested)
        {
            // The caller stopped reading: there is no one to answer.
        }
        catch when (!Response.HasStarted)
        {
            Response.Headers.Remove(HeaderNames.ContentDisposition);
            throw;
        }

        return new EmptyResult();
    }

    /// <summary>
    /// Imports a file from <see cref="Export"/> for the caller, keeping whichever position in each book was saved last.
    /// </summary>
    /// <returns>
    /// How many positions were imported and kept, and the books that matched none the caller can see;
    /// 400, storing nothing, for a file that is not an Oriel export, has a newer version, is malformed or is too large;
    /// 409 while another import runs on the server.
    /// </returns>
    [HttpPost("Import")]
    // The body is counted as it is read. A limit of the server's own would end the connection before the refusal is sent.
    [DisableRequestSizeLimit]
    [Produces(MediaTypeNames.Application.Json)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<ImportResult>> Import()
    {
        var userId = await _authorizationContext.CallerAsync(HttpContext).ConfigureAwait(false);
        if (userId is null)
        {
            return Unauthorized();
        }

        // A body that says it is too large is refused before it is read.
        if (Request.ContentLength > MaxImportBytes)
        {
            return BadRequest(new RequestRefusal("tooLarge"));
        }

        ReadingDataFile? file;
        string? reason;
        try
        {
            var body = LimitedBody.Limit(Request.Body, MaxImportBytes);
            (file, reason) = await ReadingData.ReadAsync(body).ConfigureAwait(false);

            // Reading stops where the JSON is wrong. What is left is counted too, so a body past the limit is
            // refused for that whatever it holds.
            await body.CopyToAsync(Stream.Null).ConfigureAwait(false);
        }
        catch (BodyTooLargeException)
        {
            return BadRequest(new RequestRefusal("tooLarge"));
        }

        if (file is null)
        {
            return BadRequest(new RequestRefusal(reason ?? "malformed"));
        }

        ImportResult result;
        try
        {
            result = _readingData.Import(userId.Value, file);
        }
        catch (ImportRunningException)
        {
            return Conflict(new RequestRefusal("importRunning"));
        }
        catch (Exception exception) when (exception is not StoreUnavailableException)
        {
            LogImportFailed(_logger, userId.Value, exception.GetType().Name);
            throw;
        }

        LogImported(
            _logger,
            userId.Value,
            result.Imported,
            result.Kept,
            result.Unmatched.Count,
            result.Bookmarks,
            result.Highlights,
            result.Highlighters,
            result.Themes,
            result.Fonts,
#pragma warning disable CA1873 // Once an import, and at most a few words.
            string.Join(',', result.Limited ?? []));
#pragma warning restore CA1873
        return result;
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "Oriel exported reading data for user {UserId}: {Positions} positions, {Bookmarks} bookmarks, {Highlights} highlights")]
    private static partial void LogExported(ILogger logger, Guid userId, int positions, int bookmarks, int highlights);

    [LoggerMessage(Level = LogLevel.Information, Message = "Oriel imported reading data for user {UserId}: {Imported} positions imported, {Kept} kept, {Unmatched} books unmatched, {Bookmarks} bookmarks, {Highlights} highlights, {Highlighters} highlighters, {Themes} themes, {Fonts} fonts; limits reached: {Limited}")]
    private static partial void LogImported(ILogger logger, Guid userId, int imported, int kept, int unmatched, int bookmarks, int highlights, int highlighters, int themes, int fonts, string limited);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Oriel's import for user {UserId} failed part way ({Failure}) and stored nothing")]
    private static partial void LogImportFailed(ILogger logger, Guid userId, string failure);
}
