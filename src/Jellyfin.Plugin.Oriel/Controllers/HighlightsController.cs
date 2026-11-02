using System;
using System.Collections.Generic;
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
/// Lists, adds, recolours and removes the caller's highlights in a book.
/// </summary>
[ApiController]
[Route("Oriel/Highlights")]
[Authorize]
public class HighlightsController : ControllerBase
{
    /// <summary>
    /// The longest text a highlight keeps.
    /// </summary>
    public const int MaxTextLength = 1000;

    /// <summary>
    /// The highlighters' colours: Quotes, Green, Vocabulary and Pink.
    /// </summary>
    public static readonly IReadOnlySet<string> Colours = new HashSet<string>(StringComparer.Ordinal) { "yellow", "green", "blue", "pink" };

    private readonly PositionStore _store;
    private readonly IAuthorizationContext _authorizationContext;
    private readonly IItemAccess _itemAccess;
    private readonly TimeProvider _time;

    /// <summary>
    /// Initializes a new instance of the <see cref="HighlightsController"/> class.
    /// </summary>
    /// <param name="store">The plugin's database.</param>
    /// <param name="authorizationContext">The host authorization context.</param>
    /// <param name="itemAccess">Whether the caller can see a book.</param>
    /// <param name="time">The clock highlights are stamped with.</param>
    public HighlightsController(PositionStore store, IAuthorizationContext authorizationContext, IItemAccess itemAccess, TimeProvider time)
    {
        _store = store;
        _authorizationContext = authorizationContext;
        _itemAccess = itemAccess;
        _time = time;
    }

    /// <summary>
    /// Gets the caller's highlights in a book.
    /// </summary>
    /// <param name="itemId">The book.</param>
    /// <returns>The highlights in book order; 404 when the book is not visible to the caller.</returns>
    [HttpGet("{itemId:guid}")]
    [Produces(MediaTypeNames.Application.Json)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<IReadOnlyList<HighlightResponse>>> GetHighlights([FromRoute] Guid itemId)
    {
        var userId = await CallerAsync().ConfigureAwait(false);
        if (userId is null)
        {
            return Unauthorized();
        }

        if (!_itemAccess.CanSee(userId.Value, itemId))
        {
            return NotFound();
        }

        return _store.ListHighlights(userId.Value, itemId).Select(Reply).ToList();
    }

    /// <summary>
    /// Highlights text in a book for the caller.
    /// </summary>
    /// <param name="itemId">The book.</param>
    /// <param name="request">The highlight.</param>
    /// <returns>
    /// The highlight, stamped with the server's time, or the one already at that CFI in the colour asked for;
    /// 400 for a malformed highlight; 404 when the book is not visible to the caller.
    /// </returns>
    [HttpPost("{itemId:guid}")]
    [Consumes(MediaTypeNames.Application.Json)]
    [Produces(MediaTypeNames.Application.Json)]
    [RequestSizeLimit(16 * 1024)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<HighlightResponse>> PostHighlight([FromRoute] Guid itemId, [FromBody] HighlightRequest? request)
    {
        var userId = await CallerAsync().ConfigureAwait(false);
        if (userId is null)
        {
            return Unauthorized();
        }

        if (request?.Cfi is not { Length: > 0 and <= PositionsController.MaxCfiLength } cfi
            || request.Fraction is not { } fraction
            || double.IsNaN(fraction) || fraction < 0 || fraction > 1
            || request.Colour is not { } colour || !Colours.Contains(colour)
            || request.Text is not { Length: <= MaxTextLength } text)
        {
            return BadRequest();
        }

        if (!_itemAccess.CanSee(userId.Value, itemId))
        {
            return NotFound();
        }

        var (highlight, _) = _store.AddHighlight(userId.Value, itemId, cfi, fraction, colour, text, _time.GetUtcNow());
        if (highlight.Colour != colour)
        {
            highlight = _store.RecolourHighlight(userId.Value, itemId, highlight.Id, colour) ?? highlight;
        }

        return Reply(highlight);
    }

    /// <summary>
    /// Changes the highlighter of one of the caller's highlights in a book.
    /// </summary>
    /// <param name="itemId">The book.</param>
    /// <param name="highlightId">The highlight.</param>
    /// <param name="request">The new highlighter.</param>
    /// <returns>
    /// The highlight as it is now; 400 for an unknown colour; 404 when the book is not visible to the caller
    /// or the caller has no such highlight in it.
    /// </returns>
    [HttpPatch("{itemId:guid}/{highlightId:guid}")]
    [Consumes(MediaTypeNames.Application.Json)]
    [Produces(MediaTypeNames.Application.Json)]
    [RequestSizeLimit(1024)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<HighlightResponse>> PatchHighlight([FromRoute] Guid itemId, [FromRoute] Guid highlightId, [FromBody] RecolourRequest? request)
    {
        var userId = await CallerAsync().ConfigureAwait(false);
        if (userId is null)
        {
            return Unauthorized();
        }

        if (request?.Colour is not { } colour || !Colours.Contains(colour))
        {
            return BadRequest();
        }

        if (!_itemAccess.CanSee(userId.Value, itemId) || _store.RecolourHighlight(userId.Value, itemId, highlightId, colour) is not { } highlight)
        {
            return NotFound();
        }

        return Reply(highlight);
    }

    /// <summary>
    /// Removes one of the caller's highlights in a book.
    /// </summary>
    /// <param name="itemId">The book.</param>
    /// <param name="highlightId">The highlight.</param>
    /// <returns>204; 404 when the book is not visible to the caller or the caller has no such highlight in it.</returns>
    [HttpDelete("{itemId:guid}/{highlightId:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult> DeleteHighlight([FromRoute] Guid itemId, [FromRoute] Guid highlightId)
    {
        var userId = await CallerAsync().ConfigureAwait(false);
        if (userId is null)
        {
            return Unauthorized();
        }

        if (!_itemAccess.CanSee(userId.Value, itemId) || !_store.RemoveHighlight(userId.Value, itemId, highlightId))
        {
            return NotFound();
        }

        return NoContent();
    }

    private static HighlightResponse Reply(StoredHighlight highlight) =>
        new(highlight.Id.ToString("N"), highlight.Cfi, highlight.Fraction, highlight.Colour, highlight.Text, highlight.CreatedAt);

    private async Task<Guid?> CallerAsync()
    {
        var info = await _authorizationContext.GetAuthorizationInfo(HttpContext).ConfigureAwait(false);
        return info.UserId.Equals(Guid.Empty) ? null : info.UserId;
    }

    /// <summary>
    /// The body of <see cref="PostHighlight"/>.
    /// </summary>
    /// <param name="Cfi">The EPUB range CFI of the highlighted text.</param>
    /// <param name="Fraction">How far through the book the page it was made on is, from 0 to 1.</param>
    /// <param name="Colour">Its highlighter's colour.</param>
    /// <param name="Text">The highlighted text.</param>
    public record HighlightRequest(
        [property: JsonPropertyName("cfi")] string? Cfi,
        [property: JsonPropertyName("fraction")] double? Fraction,
        [property: JsonPropertyName("colour")] string? Colour,
        [property: JsonPropertyName("text")] string? Text);

    /// <summary>
    /// The body of <see cref="PatchHighlight"/>.
    /// </summary>
    /// <param name="Colour">The new highlighter's colour.</param>
    public record RecolourRequest([property: JsonPropertyName("colour")] string? Colour);

    /// <summary>
    /// A highlight as <see cref="GetHighlights"/>, <see cref="PostHighlight"/> and <see cref="PatchHighlight"/> return it.
    /// </summary>
    /// <param name="Id">The highlight's id.</param>
    /// <param name="Cfi">The EPUB range CFI of the highlighted text.</param>
    /// <param name="Fraction">How far through the book the page it was made on is, from 0 to 1.</param>
    /// <param name="Colour">Its highlighter's colour.</param>
    /// <param name="Text">The highlighted text.</param>
    /// <param name="CreatedAt">When the highlight was made.</param>
    public record HighlightResponse(
        [property: JsonPropertyName("id")] string Id,
        [property: JsonPropertyName("cfi")] string Cfi,
        [property: JsonPropertyName("fraction")] double Fraction,
        [property: JsonPropertyName("colour")] string Colour,
        [property: JsonPropertyName("text")] string Text,
        [property: JsonPropertyName("createdAt")] DateTimeOffset CreatedAt);
}
