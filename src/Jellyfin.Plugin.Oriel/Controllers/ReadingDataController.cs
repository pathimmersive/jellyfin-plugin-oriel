using System;
using System.Globalization;
using System.IO;
using System.Net.Mime;
using System.Threading.Tasks;
using Jellyfin.Plugin.Oriel.Data;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Oriel.Controllers;

/// <summary>
/// Exports the caller's reading data to a file and imports such a file back.
/// </summary>
[ApiController]
[Route("Oriel")]
[Authorize]
public class ReadingDataController : ControllerBase
{
    /// <summary>
    /// The largest file accepted for import, in bytes.
    /// </summary>
    public const int MaxImportBytes = 8 * 1024 * 1024;

    private readonly ReadingData _readingData;
    private readonly IAuthorizationContext _authorizationContext;
    private readonly TimeProvider _time;

    /// <summary>
    /// Initializes a new instance of the <see cref="ReadingDataController"/> class.
    /// </summary>
    /// <param name="readingData">Export and import.</param>
    /// <param name="authorizationContext">The host authorization context.</param>
    /// <param name="time">The clock exports are stamped with.</param>
    public ReadingDataController(ReadingData readingData, IAuthorizationContext authorizationContext, TimeProvider time)
    {
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
        var userId = await CallerAsync().ConfigureAwait(false);
        if (userId is null)
        {
            return Unauthorized();
        }

        var now = _time.GetUtcNow();
        var file = _readingData.Export(userId.Value, now);
        var name = string.Create(CultureInfo.InvariantCulture, $"oriel-reading-data-{now:yyyy-MM-dd}.json");
        return File(ReadingData.Serialize(file), MediaTypeNames.Application.Json, name);
    }

    /// <summary>
    /// Imports a file from <see cref="Export"/> for the caller, keeping whichever position in each book was saved last.
    /// </summary>
    /// <returns>
    /// How many positions were imported and kept, and the books that matched none the caller can see;
    /// 400, storing nothing, for a file that is not an Oriel export, has a newer version, is malformed or is too large.
    /// </returns>
    [HttpPost("Import")]
    [Produces(MediaTypeNames.Application.Json)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<ImportResult>> Import()
    {
        var userId = await CallerAsync().ConfigureAwait(false);
        if (userId is null)
        {
            return Unauthorized();
        }

        var body = await ReadAtMostAsync(Request.Body, MaxImportBytes).ConfigureAwait(false);
        if (body is null || ReadingData.Parse(body) is not { } file)
        {
            return BadRequest();
        }

        return _readingData.Import(userId.Value, file);
    }

    // The whole stream, or null when it is longer than `limit` bytes.
    private static async Task<byte[]?> ReadAtMostAsync(Stream stream, int limit)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await stream.ReadAsync(chunk).ConfigureAwait(false)) > 0)
        {
            if (buffer.Length + read > limit)
            {
                return null;
            }

            buffer.Write(chunk, 0, read);
        }

        return buffer.ToArray();
    }

    private async Task<Guid?> CallerAsync()
    {
        var info = await _authorizationContext.GetAuthorizationInfo(HttpContext).ConfigureAwait(false);
        return info.UserId.Equals(Guid.Empty) ? null : info.UserId;
    }
}
