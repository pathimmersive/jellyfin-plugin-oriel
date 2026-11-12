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
/// Lists and replaces the caller's own themes.
/// </summary>
[ApiController]
[Route("Oriel/Themes")]
[Authorize]
[StoreUnavailable]
public class ThemesController : ControllerBase
{
    /// <summary>
    /// The longest name a theme keeps.
    /// </summary>
    public const int MaxNameLength = 40;

    private readonly PositionStore _store;
    private readonly IAuthorizationContext _authorizationContext;

    /// <summary>
    /// Initializes a new instance of the <see cref="ThemesController"/> class.
    /// </summary>
    /// <param name="store">The plugin's database.</param>
    /// <param name="authorizationContext">The host authorization context.</param>
    public ThemesController(PositionStore store, IAuthorizationContext authorizationContext)
    {
        _store = store;
        _authorizationContext = authorizationContext;
    }

    /// <summary>
    /// Checks a whole list of themes for a user whose own themes have the ids in <paramref name="own"/>:
    /// at most 12, each id one of the user's own and not repeated, a name of 1 to 40 characters and
    /// ten colours written as #rrggbb. Entries without an id are new and are given one.
    /// </summary>
    /// <param name="list">The list as sent.</param>
    /// <param name="own">The ids of the user's own themes.</param>
    /// <returns>The list to keep, or null when it is malformed.</returns>
    public static IReadOnlyList<ThemeEntry>? Check(IReadOnlyList<ThemeRequest?>? list, IReadOnlySet<string> own)
    {
        if (list is not { Count: <= PositionStore.MaxThemes })
        {
            return null;
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        var kept = new List<ThemeEntry>();
        foreach (var entry in list)
        {
            if (entry?.Name?.Trim() is not { Length: > 0 and <= MaxNameLength } name)
            {
                return null;
            }

            var colours = entry.Colours();
            if (!colours.All(HighlightersController.IsColour))
            {
                return null;
            }

            var id = entry.Id ?? Guid.NewGuid().ToString("N");
            if (!seen.Add(id) || (entry.Id is not null && !own.Contains(id)))
            {
                return null;
            }

            kept.Add(new ThemeEntry(id, name, colours.Select(colour => colour!.ToLowerInvariant()).ToList()));
        }

        return kept;
    }

    /// <summary>
    /// Gets the caller's own themes.
    /// </summary>
    /// <returns>The themes in their order; none for a caller who has made none.</returns>
    [HttpGet]
    [Produces(MediaTypeNames.Application.Json)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<IReadOnlyList<ThemeResponse>>> GetThemes()
    {
        var userId = await CallerAsync().ConfigureAwait(false);
        if (userId is null)
        {
            return Unauthorized();
        }

        return _store.ListThemes(userId.Value).Select(Reply).ToList();
    }

    /// <summary>
    /// Replaces the caller's own themes with a whole list: new ones are added, changed ones kept as sent,
    /// and those left out are deleted.
    /// </summary>
    /// <param name="request">The whole list, in its order.</param>
    /// <returns>The themes as GET returns them; 400 for a malformed list.</returns>
    [HttpPut]
    [Consumes(MediaTypeNames.Application.Json)]
    [Produces(MediaTypeNames.Application.Json)]
    [RequestSizeLimit(32 * 1024)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<IReadOnlyList<ThemeResponse>>> PutThemes([FromBody] IReadOnlyList<ThemeRequest?>? request)
    {
        var userId = await CallerAsync().ConfigureAwait(false);
        if (userId is null)
        {
            return Unauthorized();
        }

        var own = _store.ListThemes(userId.Value).Select(theme => theme.Id).ToHashSet(StringComparer.Ordinal);
        if (Check(request, own) is not { } list)
        {
            return BadRequest();
        }

        return _store.ReplaceThemes(userId.Value, list).Select(Reply).ToList();
    }

    private static ThemeResponse Reply(ThemeEntry theme) => new(
        theme.Id,
        theme.Name,
        theme.Colours[0],
        theme.Colours[1],
        theme.Colours[2],
        theme.Colours[3],
        theme.Colours[4],
        theme.Colours[5],
        theme.Colours[6],
        theme.Colours[7],
        theme.Colours[8],
        theme.Colours[9]);

    private async Task<Guid?> CallerAsync()
    {
        var info = await _authorizationContext.GetAuthorizationInfo(HttpContext).ConfigureAwait(false);
        return info.UserId.Equals(Guid.Empty) ? null : info.UserId;
    }

    /// <summary>
    /// A theme in the body of <see cref="PutThemes"/>.
    /// </summary>
    /// <param name="Id">Its id; none for a new one.</param>
    /// <param name="Name">Its name.</param>
    /// <param name="Background">The page.</param>
    /// <param name="Text">The book's text.</param>
    /// <param name="Secondary">Chapter names, progress and labels.</param>
    /// <param name="Accent">Selected items, links and the slider.</param>
    /// <param name="Selection">Selected text.</param>
    /// <param name="Separator">Lines between rows.</param>
    /// <param name="Controls">The header, footer and panels.</param>
    /// <param name="ControlsText">Text and icons in the controls.</param>
    /// <param name="Buttons">Buttons in the controls.</param>
    /// <param name="Grayed">Unavailable items.</param>
    public record ThemeRequest(
        [property: JsonPropertyName("id")] string? Id,
        [property: JsonPropertyName("name")] string? Name,
        [property: JsonPropertyName("background")] string? Background,
        [property: JsonPropertyName("text")] string? Text,
        [property: JsonPropertyName("secondary")] string? Secondary,
        [property: JsonPropertyName("accent")] string? Accent,
        [property: JsonPropertyName("selection")] string? Selection,
        [property: JsonPropertyName("separator")] string? Separator,
        [property: JsonPropertyName("controls")] string? Controls,
        [property: JsonPropertyName("controlsText")] string? ControlsText,
        [property: JsonPropertyName("buttons")] string? Buttons,
        [property: JsonPropertyName("grayed")] string? Grayed)
    {
        /// <summary>
        /// The colours, in the order the store keeps them.
        /// </summary>
        /// <returns>The ten colours as sent.</returns>
        public IReadOnlyList<string?> Colours() =>
            [Background, Text, Secondary, Accent, Selection, Separator, Controls, ControlsText, Buttons, Grayed];
    }

    /// <summary>
    /// A theme as <see cref="GetThemes"/> and <see cref="PutThemes"/> return it.
    /// </summary>
    /// <param name="Id">Its id.</param>
    /// <param name="Name">Its name.</param>
    /// <param name="Background">The page.</param>
    /// <param name="Text">The book's text.</param>
    /// <param name="Secondary">Chapter names, progress and labels.</param>
    /// <param name="Accent">Selected items, links and the slider.</param>
    /// <param name="Selection">Selected text.</param>
    /// <param name="Separator">Lines between rows.</param>
    /// <param name="Controls">The header, footer and panels.</param>
    /// <param name="ControlsText">Text and icons in the controls.</param>
    /// <param name="Buttons">Buttons in the controls.</param>
    /// <param name="Grayed">Unavailable items.</param>
    public record ThemeResponse(
        [property: JsonPropertyName("id")] string Id,
        [property: JsonPropertyName("name")] string Name,
        [property: JsonPropertyName("background")] string Background,
        [property: JsonPropertyName("text")] string Text,
        [property: JsonPropertyName("secondary")] string Secondary,
        [property: JsonPropertyName("accent")] string Accent,
        [property: JsonPropertyName("selection")] string Selection,
        [property: JsonPropertyName("separator")] string Separator,
        [property: JsonPropertyName("controls")] string Controls,
        [property: JsonPropertyName("controlsText")] string ControlsText,
        [property: JsonPropertyName("buttons")] string Buttons,
        [property: JsonPropertyName("grayed")] string Grayed);
}
