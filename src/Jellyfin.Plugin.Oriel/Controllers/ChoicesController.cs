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
/// Gets and keeps the theme and font the caller has chosen, so they follow the caller to every device.
/// </summary>
[ApiController]
[Refusals]
[Route("Oriel/Choices")]
[Authorize]
[StoreUnavailable]
public class ChoicesController : ControllerBase
{
    /// <summary>
    /// The themes Oriel has built in.
    /// </summary>
    public static readonly IReadOnlySet<string> Themes = new HashSet<string>(StringComparer.Ordinal) { "light", "sepia", "dark" };

    /// <summary>
    /// The fonts the reader bundles, by name.
    /// </summary>
    public static readonly IReadOnlySet<string> Fonts = new HashSet<string>(StringComparer.Ordinal)
    {
        "Default", "Literata", "Noto Serif", "Noto Sans", "Atkinson Hyperlegible",
    };

    private const string Own = "own:";

    private readonly PositionStore _store;
    private readonly IAuthorizationContext _authorizationContext;

    /// <summary>
    /// Initializes a new instance of the <see cref="ChoicesController"/> class.
    /// </summary>
    /// <param name="store">The plugin's database.</param>
    /// <param name="authorizationContext">The host authorization context.</param>
    public ChoicesController(PositionStore store, IAuthorizationContext authorizationContext)
    {
        _store = store;
        _authorizationContext = authorizationContext;
    }

    /// <summary>
    /// Checks a choice for a user with the theme ids in <paramref name="themes"/> and the font families in
    /// <paramref name="families"/>: a built-in theme or <c>own:</c> one of theirs, a bundled font or
    /// <c>own:</c> one of their families.
    /// </summary>
    /// <param name="request">The choice as sent.</param>
    /// <param name="themes">The ids of the user's own themes.</param>
    /// <param name="families">The user's own font families.</param>
    /// <returns>The choice to keep, or null when it is not one the user can make.</returns>
    public static StoredChoices? Check(ChoicesRequest? request, IReadOnlySet<string> themes, IReadOnlySet<string> families)
    {
        if (request?.Theme is not { } theme || request.Font is not { } font)
        {
            return null;
        }

        var themeKnown = Themes.Contains(theme) || (theme.StartsWith(Own, StringComparison.Ordinal) && themes.Contains(theme[Own.Length..]));
        var fontKnown = Fonts.Contains(font) || (font.StartsWith(Own, StringComparison.Ordinal) && families.Contains(font[Own.Length..]));
        return themeKnown && fontKnown ? new StoredChoices(theme, font) : null;
    }

    /// <summary>
    /// Gets the theme and font the caller has chosen.
    /// </summary>
    /// <returns>The choices, each null until the caller first chooses.</returns>
    [HttpGet]
    [Produces(MediaTypeNames.Application.Json)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<ChoicesResponse>> GetChoices()
    {
        var userId = await CallerAsync().ConfigureAwait(false);
        if (userId is null)
        {
            return Unauthorized();
        }

        var kept = _store.GetChoices(userId.Value);
        return new ChoicesResponse(kept?.Theme, kept?.Font);
    }

    /// <summary>
    /// Keeps the theme and font the caller has chosen.
    /// </summary>
    /// <param name="request">The theme and the font.</param>
    /// <returns>The choices as GET returns them; 400 for a theme or font the caller cannot choose.</returns>
    [HttpPut]
    [Consumes(MediaTypeNames.Application.Json)]
    [Produces(MediaTypeNames.Application.Json)]
    [RequestSizeLimit(4 * 1024)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<ChoicesResponse>> PutChoices([FromBody] ChoicesRequest? request)
    {
        var userId = await CallerAsync().ConfigureAwait(false);
        if (userId is null)
        {
            return Unauthorized();
        }

        var themes = _store.ListThemes(userId.Value).Select(theme => theme.Id).ToHashSet(StringComparer.Ordinal);
        var families = _store.ListFonts(userId.Value).Select(font => font.Font.Family).ToHashSet(StringComparer.Ordinal);
        if (Check(request, themes, families) is not { } choices)
        {
            return BadRequest(new RequestRefusal("invalidChoices"));
        }

        _store.SaveChoices(userId.Value, choices);
        return new ChoicesResponse(choices.Theme, choices.Font);
    }

    private async Task<Guid?> CallerAsync()
    {
        var info = await _authorizationContext.GetAuthorizationInfo(HttpContext).ConfigureAwait(false);
        return info.UserId.Equals(Guid.Empty) ? null : info.UserId;
    }

    /// <summary>
    /// The body of <see cref="PutChoices"/>.
    /// </summary>
    /// <param name="Theme">The theme chosen.</param>
    /// <param name="Font">The font chosen.</param>
    public record ChoicesRequest(
        [property: JsonPropertyName("theme")] string? Theme,
        [property: JsonPropertyName("font")] string? Font);

    /// <summary>
    /// The choices as <see cref="GetChoices"/> and <see cref="PutChoices"/> return them.
    /// </summary>
    /// <param name="Theme">The theme chosen; null until the caller first chooses.</param>
    /// <param name="Font">The font chosen; null until the caller first chooses.</param>
    public record ChoicesResponse(
        [property: JsonPropertyName("theme")] string? Theme,
        [property: JsonPropertyName("font")] string? Font);
}
