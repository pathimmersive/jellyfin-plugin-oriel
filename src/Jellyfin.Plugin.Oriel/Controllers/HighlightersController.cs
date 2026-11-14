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
/// Lists and replaces the caller's highlighters: the four built-ins and their own.
/// </summary>
[ApiController]
[Refusals]
[Route("Oriel/Highlighters")]
[Authorize]
[StoreUnavailable]
public partial class HighlightersController : ControllerBase
{
    private readonly HighlightersStore _highlighters;
    private readonly IAuthorizationContext _authorizationContext;

    /// <summary>
    /// Initializes a new instance of the <see cref="HighlightersController"/> class.
    /// </summary>
    /// <param name="highlighters">The highlighters store.</param>
    /// <param name="authorizationContext">The host authorization context.</param>
    public HighlightersController(HighlightersStore highlighters, IAuthorizationContext authorizationContext)
    {
        _highlighters = highlighters;
        _authorizationContext = authorizationContext;
    }

    /// <summary>
    /// Gets the caller's highlighters.
    /// </summary>
    /// <returns>The highlighters in their order, with how many highlights use each; the built-ins for a caller who has changed nothing.</returns>
    [HttpGet]
    [Produces(MediaTypeNames.Application.Json)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<IReadOnlyList<HighlighterResponse>>> GetHighlighters()
    {
        var userId = await CallerAsync().ConfigureAwait(false);
        if (userId is null)
        {
            return Unauthorized();
        }

        return _highlighters.List(userId.Value).Select(Reply).ToList();
    }

    /// <summary>
    /// Replaces the caller's highlighters with a whole list: new ones are added, changed ones kept as sent,
    /// and the caller's own left out are deleted, their highlights becoming Quotes highlights.
    /// </summary>
    /// <param name="request">The whole list, in its order.</param>
    /// <returns>The highlighters as GET returns them; 400 for a malformed list.</returns>
    [HttpPut]
    [Consumes(MediaTypeNames.Application.Json)]
    [Produces(MediaTypeNames.Application.Json)]
    [RequestSizeLimit(16 * 1024)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<IReadOnlyList<HighlighterResponse>>> PutHighlighters([FromBody] IReadOnlyList<HighlighterRequest?>? request)
    {
        var userId = await CallerAsync().ConfigureAwait(false);
        if (userId is null)
        {
            return Unauthorized();
        }

        var own = _highlighters.List(userId.Value).Where(highlighter => !highlighter.BuiltIn).Select(highlighter => highlighter.Id).ToHashSet(StringComparer.Ordinal);
        if (ReadingRules.CheckHighlighters(request?.Select(entry => entry is null ? ((string?, string?, string?)?)null : (entry.Id, entry.Name, entry.Colour)).ToList(), own) is not { } list)
        {
            return BadRequest(new RequestRefusal("invalidHighlighters"));
        }

        return _highlighters.Replace(userId.Value, list).Select(Reply).ToList();
    }

    private static HighlighterResponse Reply(StoredHighlighter highlighter) =>
        new(highlighter.Id, highlighter.Name, highlighter.Colour, highlighter.BuiltIn, highlighter.Uses);

    private async Task<Guid?> CallerAsync()
    {
        var info = await _authorizationContext.GetAuthorizationInfo(HttpContext).ConfigureAwait(false);
        return info.UserId.Equals(Guid.Empty) ? null : info.UserId;
    }

    /// <summary>
    /// A highlighter in the body of <see cref="PutHighlighters"/>.
    /// </summary>
    /// <param name="Id">Its id; none for a new one.</param>
    /// <param name="Name">Its name.</param>
    /// <param name="Colour">Its colour, as #rrggbb.</param>
    public record HighlighterRequest(
        [property: JsonPropertyName("id")] string? Id,
        [property: JsonPropertyName("name")] string? Name,
        [property: JsonPropertyName("colour")] string? Colour);

    /// <summary>
    /// A highlighter as <see cref="GetHighlighters"/> and <see cref="PutHighlighters"/> return it.
    /// </summary>
    /// <param name="Id">Its id.</param>
    /// <param name="Name">Its name.</param>
    /// <param name="Colour">Its colour, as #rrggbb.</param>
    /// <param name="BuiltIn">True for the four built-ins, which cannot be deleted.</param>
    /// <param name="Uses">How many of the caller's highlights, in every book, are in it.</param>
    public record HighlighterResponse(
        [property: JsonPropertyName("id")] string Id,
        [property: JsonPropertyName("name")] string Name,
        [property: JsonPropertyName("colour")] string Colour,
        [property: JsonPropertyName("builtIn")] bool BuiltIn,
        [property: JsonPropertyName("uses")] int Uses);
}
