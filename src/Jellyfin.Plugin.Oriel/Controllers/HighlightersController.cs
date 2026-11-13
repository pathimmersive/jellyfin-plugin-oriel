using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Mime;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
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
[Route("Oriel/Highlighters")]
[Authorize]
[StoreUnavailable]
public partial class HighlightersController : ControllerBase
{
    /// <summary>
    /// The most highlighters a user keeps, built-ins included.
    /// </summary>
    public const int MaxHighlighters = 8;

    /// <summary>
    /// The longest name a highlighter keeps.
    /// </summary>
    public const int MaxNameLength = 40;

    /// <summary>
    /// The longest id a highlighter has.
    /// </summary>
    public const int MaxIdLength = 64;

    private readonly PositionStore _store;
    private readonly IAuthorizationContext _authorizationContext;

    /// <summary>
    /// Initializes a new instance of the <see cref="HighlightersController"/> class.
    /// </summary>
    /// <param name="store">The plugin's database.</param>
    /// <param name="authorizationContext">The host authorization context.</param>
    public HighlightersController(PositionStore store, IAuthorizationContext authorizationContext)
    {
        _store = store;
        _authorizationContext = authorizationContext;
    }

    /// <summary>
    /// Whether a colour is written as #rrggbb.
    /// </summary>
    /// <param name="colour">The colour.</param>
    /// <returns>True for #rrggbb.</returns>
    public static bool IsColour(string? colour) => colour is not null && HexColour().IsMatch(colour);

    /// <summary>
    /// Checks a whole list of highlighters for a user whose own highlighters have the ids in <paramref name="own"/>:
    /// 4 to 8 of them, each built-in once, any other id one of the user's own, a name of 1 to 40 characters and a
    /// colour written as #rrggbb. Entries without an id are new and are given one.
    /// </summary>
    /// <param name="list">The list as sent.</param>
    /// <param name="own">The ids of the user's own highlighters.</param>
    /// <returns>The list to keep, or null when it is malformed.</returns>
    public static IReadOnlyList<HighlighterEntry>? Check(IReadOnlyList<HighlighterRequest?>? list, IReadOnlySet<string> own)
    {
        if (list is not { Count: >= 4 and <= MaxHighlighters })
        {
            return null;
        }

        var builtIns = PositionStore.BuiltInHighlighters.Select(builtIn => builtIn.Id).ToHashSet(StringComparer.Ordinal);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var kept = new List<HighlighterEntry>();
        foreach (var entry in list)
        {
            if (entry?.Name?.Trim() is not { Length: > 0 and <= MaxNameLength } name || !IsColour(entry.Colour))
            {
                return null;
            }

            var id = entry.Id ?? Guid.NewGuid().ToString("N");
            if (!seen.Add(id) || (entry.Id is not null && !builtIns.Contains(id) && !own.Contains(id)))
            {
                return null;
            }

            kept.Add(new HighlighterEntry(id, name, entry.Colour!.ToLowerInvariant()));
        }

        return builtIns.IsSubsetOf(seen) ? kept : null;
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

        return _store.ListHighlighters(userId.Value).Select(Reply).ToList();
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

        var own = _store.ListHighlighters(userId.Value).Where(highlighter => !highlighter.BuiltIn).Select(highlighter => highlighter.Id).ToHashSet(StringComparer.Ordinal);
        if (Check(request, own) is not { } list)
        {
            return BadRequest();
        }

        return _store.ReplaceHighlighters(userId.Value, list).Select(Reply).ToList();
    }

    [GeneratedRegex("^#[0-9a-fA-F]{6}$")]
    private static partial Regex HexColour();

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
