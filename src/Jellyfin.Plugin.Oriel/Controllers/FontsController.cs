using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Mime;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using Jellyfin.Plugin.Oriel.Data;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Oriel.Controllers;

/// <summary>
/// Lists, adds, serves and removes the caller's own font files.
/// </summary>
[ApiController]
[Route("Oriel/Fonts")]
[Authorize]
public class FontsController : ControllerBase
{
    /// <summary>
    /// The largest font file kept: 5 MB.
    /// </summary>
    public const int MaxBytes = 5 * 1024 * 1024;

    private static readonly Dictionary<string, string> Types = new(StringComparer.Ordinal)
    {
        ["ttf"] = "font/ttf",
        ["otf"] = "font/otf",
        ["woff2"] = "font/woff2",
    };

    private readonly PositionStore _store;
    private readonly IAuthorizationContext _authorizationContext;
    private readonly TimeProvider _time;

    /// <summary>
    /// Initializes a new instance of the <see cref="FontsController"/> class.
    /// </summary>
    /// <param name="store">The plugin's database.</param>
    /// <param name="authorizationContext">The host authorization context.</param>
    /// <param name="time">The clock a file's added time is read from.</param>
    public FontsController(PositionStore store, IAuthorizationContext authorizationContext, TimeProvider time)
    {
        _store = store;
        _authorizationContext = authorizationContext;
        _time = time;
    }

    /// <summary>
    /// Gets the caller's font files.
    /// </summary>
    /// <returns>The files, by family, then weight, then upright before italic.</returns>
    [HttpGet]
    [Produces(MediaTypeNames.Application.Json)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<IReadOnlyList<FontResponse>>> GetFonts()
    {
        var userId = await CallerAsync().ConfigureAwait(false);
        if (userId is null)
        {
            return Unauthorized();
        }

        return _store.ListFonts(userId.Value).Select(Reply).ToList();
    }

    /// <summary>
    /// Adds a font file, sent as the body, in place of the caller's file of its family, weight and italic.
    /// </summary>
    /// <returns>The file as GET lists it; 413 over 5 MB; 400 for a file that is not a font, or a 21st file.</returns>
    [HttpPost]
    [RequestSizeLimit(MaxBytes + (1024 * 1024))]
    [Produces(MediaTypeNames.Application.Json)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status413PayloadTooLarge)]
    public async Task<ActionResult<FontResponse>> AddFont()
    {
        var userId = await CallerAsync().ConfigureAwait(false);
        if (userId is null)
        {
            return Unauthorized();
        }

        // Read one byte past the limit, to tell a file at the limit from one over it.
        using var body = new MemoryStream();
        var buffer = new byte[81920];
        int read;
        while ((read = await Request.Body.ReadAsync(buffer).ConfigureAwait(false)) > 0)
        {
            body.Write(buffer, 0, read);
            if (body.Length > MaxBytes)
            {
                return StatusCode(StatusCodes.Status413PayloadTooLarge);
            }
        }

        var data = body.ToArray();
        if (FontFile.Read(data) is not { } font)
        {
            return BadRequest(new Refusal("notAFont"));
        }

        var (stored, result) = _store.AddFont(userId.Value, font, data, _time.GetUtcNow());
        return result == FontAdded.TooMany || stored is null ? BadRequest(new Refusal("tooMany")) : Reply(stored);
    }

    /// <summary>
    /// Gets one of the caller's font files.
    /// </summary>
    /// <param name="fontId">The file.</param>
    /// <returns>The file with its type; 404 for a file the caller does not have.</returns>
    [HttpGet("{fontId}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult> GetFont([FromRoute] Guid fontId)
    {
        var userId = await CallerAsync().ConfigureAwait(false);
        if (userId is null)
        {
            return Unauthorized();
        }

        if (_store.GetFontData(userId.Value, fontId) is not { } file)
        {
            return NotFound();
        }

        // A file's id changes whenever it is replaced, so the caller's browser may keep it.
        Response.Headers.CacheControl = "private, max-age=31536000, immutable";
        return File(file.Data, Types.GetValueOrDefault(file.Format, MediaTypeNames.Application.Octet));
    }

    /// <summary>
    /// Removes every file of one of the caller's font families.
    /// </summary>
    /// <param name="family">The family.</param>
    /// <returns>204; 404 when the caller has no file of the family.</returns>
    [HttpDelete]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult> RemoveFamily([FromQuery] string? family)
    {
        var userId = await CallerAsync().ConfigureAwait(false);
        if (userId is null)
        {
            return Unauthorized();
        }

        return family is not null && _store.RemoveFontFamily(userId.Value, family) > 0 ? NoContent() : NotFound();
    }

    private static FontResponse Reply(StoredFont font) =>
        new(font.Id.ToString("N"), font.Font.Family, font.Font.Style, font.Font.Weight, font.Font.Italic, font.Font.Format);

    private async Task<Guid?> CallerAsync()
    {
        var info = await _authorizationContext.GetAuthorizationInfo(HttpContext).ConfigureAwait(false);
        return info.UserId.Equals(Guid.Empty) ? null : info.UserId;
    }

    /// <summary>
    /// A font file as <see cref="GetFonts"/> and <see cref="AddFont"/> return it.
    /// </summary>
    /// <param name="Id">Its id.</param>
    /// <param name="Family">Its family.</param>
    /// <param name="Style">Its style: Regular, Italic, Bold and so on.</param>
    /// <param name="Weight">Its weight, from 1 to 1000.</param>
    /// <param name="Italic">True for an italic or oblique face.</param>
    /// <param name="Format">ttf, otf or woff2.</param>
    public record FontResponse(
        [property: JsonPropertyName("id")] string Id,
        [property: JsonPropertyName("family")] string Family,
        [property: JsonPropertyName("style")] string Style,
        [property: JsonPropertyName("weight")] int Weight,
        [property: JsonPropertyName("italic")] bool Italic,
        [property: JsonPropertyName("format")] string Format);

    /// <summary>
    /// Why a font file was refused.
    /// </summary>
    /// <param name="Reason">notAFont or tooMany.</param>
    public record Refusal([property: JsonPropertyName("reason")] string Reason);
}
