using System;
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
/// Reads and saves the caller's exact reading position in a book.
/// </summary>
[ApiController]
[Route("Oriel/Positions")]
[Authorize]
public class PositionsController : ControllerBase
{
    /// <summary>
    /// The longest CFI accepted.
    /// </summary>
    public const int MaxCfiLength = 4096;

    private readonly PositionStore _store;
    private readonly IAuthorizationContext _authorizationContext;
    private readonly IItemAccess _itemAccess;
    private readonly TimeProvider _time;

    /// <summary>
    /// Initializes a new instance of the <see cref="PositionsController"/> class.
    /// </summary>
    /// <param name="store">The position store.</param>
    /// <param name="authorizationContext">The host authorization context.</param>
    /// <param name="itemAccess">Whether the caller can see a book.</param>
    /// <param name="time">The clock positions are stamped with.</param>
    public PositionsController(PositionStore store, IAuthorizationContext authorizationContext, IItemAccess itemAccess, TimeProvider time)
    {
        _store = store;
        _authorizationContext = authorizationContext;
        _itemAccess = itemAccess;
        _time = time;
    }

    /// <summary>
    /// Gets the caller's position in a book.
    /// </summary>
    /// <param name="itemId">The book.</param>
    /// <returns>The position, or 404 when none is stored or the book is not visible to the caller.</returns>
    [HttpGet("{itemId:guid}")]
    [Produces(MediaTypeNames.Application.Json)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PositionResponse>> GetPosition([FromRoute] Guid itemId)
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

        var position = _store.Get(userId.Value, itemId);
        return position is null
            ? NotFound()
            : new PositionResponse(position.Cfi, position.Fraction, position.SavedAt);
    }

    /// <summary>
    /// Saves the caller's position in a book, replacing the previous one.
    /// </summary>
    /// <param name="itemId">The book.</param>
    /// <param name="request">The position.</param>
    /// <returns>204 when saved; 400 for a malformed position; 404 when the book is not visible to the caller.</returns>
    [HttpPut("{itemId:guid}")]
    [Consumes(MediaTypeNames.Application.Json)]
    [RequestSizeLimit(16 * 1024)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult> PutPosition([FromRoute] Guid itemId, [FromBody] PositionRequest? request)
    {
        var userId = await CallerAsync().ConfigureAwait(false);
        if (userId is null)
        {
            return Unauthorized();
        }

        if (request?.Cfi is not { Length: > 0 and <= MaxCfiLength } cfi
            || request.Fraction is not { } fraction
            || double.IsNaN(fraction) || fraction < 0 || fraction > 1)
        {
            return BadRequest();
        }

        if (!_itemAccess.CanSee(userId.Value, itemId))
        {
            return NotFound();
        }

        _store.Save(userId.Value, itemId, new StoredPosition(cfi, fraction, _time.GetUtcNow()));
        return NoContent();
    }

    private async Task<Guid?> CallerAsync()
    {
        var info = await _authorizationContext.GetAuthorizationInfo(HttpContext).ConfigureAwait(false);
        return info.UserId.Equals(Guid.Empty) ? null : info.UserId;
    }

    /// <summary>
    /// The body of <see cref="PutPosition"/>.
    /// </summary>
    /// <param name="Cfi">The EPUB CFI of the position.</param>
    /// <param name="Fraction">How far through the book the position is, from 0 to 1.</param>
    public record PositionRequest(
        [property: JsonPropertyName("cfi")] string? Cfi,
        [property: JsonPropertyName("fraction")] double? Fraction);

    /// <summary>
    /// The body of <see cref="GetPosition"/>.
    /// </summary>
    /// <param name="Cfi">The EPUB CFI of the position.</param>
    /// <param name="Fraction">How far through the book the position is, from 0 to 1.</param>
    /// <param name="SavedAt">When the position was saved.</param>
    public record PositionResponse(
        [property: JsonPropertyName("cfi")] string Cfi,
        [property: JsonPropertyName("fraction")] double Fraction,
        [property: JsonPropertyName("savedAt")] DateTimeOffset SavedAt);
}
