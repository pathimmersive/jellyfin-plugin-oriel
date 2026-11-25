using System;
using System.Net.Mime;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using Jellyfin.Plugin.Oriel.Data;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace Jellyfin.Plugin.Oriel.Controllers;

/// <summary>
/// Reads and saves the caller's exact reading position in a book.
/// </summary>
[ApiController]
[Refusals]
[Route("Oriel/Positions")]
[Authorize]
[StoreUnavailable]
public partial class PositionsController : ControllerBase
{
    private readonly PositionsStore _positions;
    private readonly IAuthorizationContext _authorizationContext;
    private readonly IItemAccess _itemAccess;
    private readonly TimeProvider _time;
    private readonly IProgressMirror _mirror;
    private readonly ILogger<PositionsController> _logger;

    /// <summary>
    /// Initializes a new instance of the <see cref="PositionsController"/> class.
    /// </summary>
    /// <param name="positions">The positions store.</param>
    /// <param name="authorizationContext">The host authorization context.</param>
    /// <param name="itemAccess">Whether the caller can see a book.</param>
    /// <param name="time">The clock positions are stamped with.</param>
    /// <param name="mirror">Jellyfin's copy of each position.</param>
    /// <param name="logger">Where a copy that cannot be written is logged; nowhere when null.</param>
    public PositionsController(PositionsStore positions, IAuthorizationContext authorizationContext, IItemAccess itemAccess, TimeProvider time, IProgressMirror mirror, ILogger<PositionsController>? logger = null)
    {
        _mirror = mirror;
        _logger = logger ?? NullLogger<PositionsController>.Instance;
        _positions = positions;
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
        var userId = await _authorizationContext.CallerAsync(HttpContext).ConfigureAwait(false);
        if (userId is null)
        {
            return Unauthorized();
        }

        if (!_itemAccess.CanSee(userId.Value, itemId))
        {
            return NotFound();
        }

        var position = _positions.Get(userId.Value, itemId);
        return position is null
            ? NotFound()
            : new PositionResponse(position.Cfi, position.Fraction, position.SavedAt);
    }

    /// <summary>
    /// Saves the caller's position in a book, replacing the previous one, and Jellyfin's copy of it.
    /// </summary>
    /// <param name="itemId">The book.</param>
    /// <param name="request">The position.</param>
    /// <returns>
    /// The stored position with the server's time, which Jellyfin's copy carries too;
    /// 400 for a malformed position; 404 when the book is not visible to the caller.
    /// </returns>
    [HttpPut("{itemId:guid}")]
    [Consumes(MediaTypeNames.Application.Json)]
    [Produces(MediaTypeNames.Application.Json)]
    [RequestSizeLimit(16 * 1024)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PositionResponse>> PutPosition([FromRoute] Guid itemId, [FromBody] PositionRequest? request)
    {
        var userId = await _authorizationContext.CallerAsync(HttpContext).ConfigureAwait(false);
        if (userId is null)
        {
            return Unauthorized();
        }

        if (request?.Cfi is not { Length: > 0 and <= ReadingRules.MaxCfiLength } cfi)
        {
            return BadRequest(new RequestRefusal("invalidCfi"));
        }

        if (request.Fraction is not { } fraction || !ReadingRules.IsFraction(fraction))
        {
            return BadRequest(new RequestRefusal("invalidFraction"));
        }

        if (!_itemAccess.CanSee(userId.Value, itemId))
        {
            return NotFound();
        }

        var position = new StoredPosition(cfi, fraction, _time.GetUtcNow());
        _positions.Save(userId.Value, itemId, position);
        try
        {
            _mirror.Write(userId.Value, itemId, fraction, position.SavedAt);
        }
        catch (Exception exception)
        {
            // The place is kept either way; only Resume and Continue Reading lag behind.
            LogNotMirrored(_logger, userId.Value, itemId, exception.GetType().Name);
        }

        return new PositionResponse(position.Cfi, position.Fraction, position.SavedAt);
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Oriel saved user {UserId}'s place in {ItemId} but could not write Jellyfin's copy ({Failure})")]
    private static partial void LogNotMirrored(ILogger logger, Guid userId, Guid itemId, string failure);

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
