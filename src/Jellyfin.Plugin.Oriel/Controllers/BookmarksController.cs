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
/// Lists, adds and removes the caller's bookmarks in a book.
/// </summary>
[ApiController]
[Refusals]
[Route("Oriel/Bookmarks")]
[Authorize]
[StoreUnavailable]
public class BookmarksController : ControllerBase
{
    /// <summary>
    /// The longest text a bookmark keeps.
    /// </summary>
    public const int MaxTextLength = 500;

    private readonly PositionStore _store;
    private readonly IAuthorizationContext _authorizationContext;
    private readonly IItemAccess _itemAccess;
    private readonly TimeProvider _time;

    /// <summary>
    /// Initializes a new instance of the <see cref="BookmarksController"/> class.
    /// </summary>
    /// <param name="store">The plugin's database.</param>
    /// <param name="authorizationContext">The host authorization context.</param>
    /// <param name="itemAccess">Whether the caller can see a book.</param>
    /// <param name="time">The clock bookmarks are stamped with.</param>
    public BookmarksController(PositionStore store, IAuthorizationContext authorizationContext, IItemAccess itemAccess, TimeProvider time)
    {
        _store = store;
        _authorizationContext = authorizationContext;
        _itemAccess = itemAccess;
        _time = time;
    }

    /// <summary>
    /// Gets the caller's bookmarks in a book.
    /// </summary>
    /// <param name="itemId">The book.</param>
    /// <returns>The bookmarks in book order; 404 when the book is not visible to the caller.</returns>
    [HttpGet("{itemId:guid}")]
    [Produces(MediaTypeNames.Application.Json)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<IReadOnlyList<BookmarkResponse>>> GetBookmarks([FromRoute] Guid itemId)
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

        return _store.ListBookmarks(userId.Value, itemId).Select(Reply).ToList();
    }

    /// <summary>
    /// Bookmarks a page of a book for the caller.
    /// </summary>
    /// <param name="itemId">The book.</param>
    /// <param name="request">The page.</param>
    /// <returns>
    /// The bookmark, stamped with the server's time, or the one already at that CFI;
    /// 400 for a malformed bookmark; 404 when the book is not visible to the caller;
    /// 409 when the caller already has the most bookmarks kept.
    /// </returns>
    [HttpPost("{itemId:guid}")]
    [Consumes(MediaTypeNames.Application.Json)]
    [Produces(MediaTypeNames.Application.Json)]
    [RequestSizeLimit(16 * 1024)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<BookmarkResponse>> PostBookmark([FromRoute] Guid itemId, [FromBody] BookmarkRequest? request)
    {
        var userId = await CallerAsync().ConfigureAwait(false);
        if (userId is null)
        {
            return Unauthorized();
        }

        if (request?.Cfi is not { Length: > 0 and <= PositionsController.MaxCfiLength } cfi)
        {
            return BadRequest(new RequestRefusal("invalidCfi"));
        }

        if (request.Fraction is not { } fraction || double.IsNaN(fraction) || fraction < 0 || fraction > 1)
        {
            return BadRequest(new RequestRefusal("invalidFraction"));
        }

        if (request.Text is not { Length: <= MaxTextLength } text)
        {
            return BadRequest(new RequestRefusal("invalidText"));
        }

        if (!_itemAccess.CanSee(userId.Value, itemId))
        {
            return NotFound();
        }

        try
        {
            var (bookmark, _) = _store.AddBookmark(userId.Value, itemId, cfi, fraction, text, _time.GetUtcNow());
            return Reply(bookmark);
        }
        catch (LimitReachedException)
        {
            return Conflict(new ConflictReason("limitReached"));
        }
    }

    /// <summary>
    /// Removes one of the caller's bookmarks in a book.
    /// </summary>
    /// <param name="itemId">The book.</param>
    /// <param name="bookmarkId">The bookmark.</param>
    /// <returns>204; 404 when the book is not visible to the caller or the caller has no such bookmark in it.</returns>
    [HttpDelete("{itemId:guid}/{bookmarkId:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult> DeleteBookmark([FromRoute] Guid itemId, [FromRoute] Guid bookmarkId)
    {
        var userId = await CallerAsync().ConfigureAwait(false);
        if (userId is null)
        {
            return Unauthorized();
        }

        if (!_itemAccess.CanSee(userId.Value, itemId) || !_store.RemoveBookmark(userId.Value, itemId, bookmarkId))
        {
            return NotFound();
        }

        return NoContent();
    }

    private static BookmarkResponse Reply(StoredBookmark bookmark) =>
        new(bookmark.Id.ToString("N"), bookmark.Cfi, bookmark.Fraction, bookmark.Text, bookmark.CreatedAt);

    private async Task<Guid?> CallerAsync()
    {
        var info = await _authorizationContext.GetAuthorizationInfo(HttpContext).ConfigureAwait(false);
        return info.UserId.Equals(Guid.Empty) ? null : info.UserId;
    }

    /// <summary>
    /// The body of <see cref="PostBookmark"/>.
    /// </summary>
    /// <param name="Cfi">The EPUB CFI of the start of the page.</param>
    /// <param name="Fraction">How far through the book the page is, from 0 to 1.</param>
    /// <param name="Text">The text the page opens with.</param>
    public record BookmarkRequest(
        [property: JsonPropertyName("cfi")] string? Cfi,
        [property: JsonPropertyName("fraction")] double? Fraction,
        [property: JsonPropertyName("text")] string? Text);

    /// <summary>
    /// A bookmark as <see cref="GetBookmarks"/> and <see cref="PostBookmark"/> return it.
    /// </summary>
    /// <param name="Id">The bookmark's id.</param>
    /// <param name="Cfi">The EPUB CFI of the start of the page.</param>
    /// <param name="Fraction">How far through the book the page is, from 0 to 1.</param>
    /// <param name="Text">The text the page opens with.</param>
    /// <param name="CreatedAt">When the bookmark was made.</param>
    public record BookmarkResponse(
        [property: JsonPropertyName("id")] string Id,
        [property: JsonPropertyName("cfi")] string Cfi,
        [property: JsonPropertyName("fraction")] double Fraction,
        [property: JsonPropertyName("text")] string Text,
        [property: JsonPropertyName("createdAt")] DateTimeOffset CreatedAt);
}
