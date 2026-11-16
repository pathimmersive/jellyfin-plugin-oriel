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
    private readonly ChoicesStore _choices;
    private readonly ThemesStore _themes;
    private readonly FontsStore _fonts;
    private readonly IAuthorizationContext _authorizationContext;

    /// <summary>
    /// Initializes a new instance of the <see cref="ChoicesController"/> class.
    /// </summary>
    /// <param name="choices">The choices store.</param>
    /// <param name="themes">The themes store, for the user's own themes a choice may name.</param>
    /// <param name="fonts">The fonts store, for the user's own families a choice may name.</param>
    /// <param name="authorizationContext">The host authorization context.</param>
    public ChoicesController(ChoicesStore choices, ThemesStore themes, FontsStore fonts, IAuthorizationContext authorizationContext)
    {
        _choices = choices;
        _themes = themes;
        _fonts = fonts;
        _authorizationContext = authorizationContext;
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
        var userId = await _authorizationContext.CallerAsync(HttpContext).ConfigureAwait(false);
        if (userId is null)
        {
            return Unauthorized();
        }

        var kept = _choices.Get(userId.Value);
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
        var userId = await _authorizationContext.CallerAsync(HttpContext).ConfigureAwait(false);
        if (userId is null)
        {
            return Unauthorized();
        }

        var themes = _themes.List(userId.Value).Select(theme => theme.Id).ToHashSet(StringComparer.Ordinal);
        var families = _fonts.List(userId.Value).Select(font => font.Font.Family).ToHashSet(StringComparer.Ordinal);
        if (ReadingRules.CheckChoices(request?.Theme, request?.Font, themes, families) is not { } choices)
        {
            return BadRequest(new RequestRefusal("invalidChoices"));
        }

        _choices.Save(userId.Value, choices);
        return new ChoicesResponse(choices.Theme, choices.Font);
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
