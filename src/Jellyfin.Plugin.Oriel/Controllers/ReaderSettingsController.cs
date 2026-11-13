using System;
using System.Net.Mime;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using Jellyfin.Plugin.Oriel.Configuration;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.Oriel.Controllers;

/// <summary>
/// Gives the reader what the admin has set for every reader.
/// </summary>
[ApiController]
[Route("Oriel/ReaderSettings")]
[Authorize]
public class ReaderSettingsController : ControllerBase
{
    private readonly IAuthorizationContext _authorizationContext;
    private readonly Func<PluginConfiguration?> _configuration;

    /// <summary>
    /// Initializes a new instance of the <see cref="ReaderSettingsController"/> class.
    /// </summary>
    /// <param name="authorizationContext">The host authorization context.</param>
    [ActivatorUtilitiesConstructor]
    public ReaderSettingsController(IAuthorizationContext authorizationContext)
        : this(authorizationContext, () => Plugin.Instance?.Configuration)
    {
    }

    /// <summary>
    /// Initializes a new instance of the <see cref="ReaderSettingsController"/> class with a given configuration.
    /// </summary>
    /// <param name="authorizationContext">The host authorization context.</param>
    /// <param name="configuration">The plugin's settings as they are now.</param>
    public ReaderSettingsController(IAuthorizationContext authorizationContext, Func<PluginConfiguration?> configuration)
    {
        _authorizationContext = authorizationContext;
        _configuration = configuration;
    }

    /// <summary>
    /// The translation address the reader may open: the setting when it is an https address, else empty.
    /// </summary>
    /// <param name="configured">The setting.</param>
    /// <returns>The address with {text} where the text goes, or empty when Translate is off.</returns>
    public static string TranslateUrlFor(string? configured)
    {
        var address = configured?.Trim() ?? string.Empty;
        return Uri.TryCreate(address.Replace("{text}", "text", StringComparison.Ordinal), UriKind.Absolute, out var uri)
            && uri.Scheme == Uri.UriSchemeHttps
            ? address
            : string.Empty;
    }

    /// <summary>
    /// Gets the settings every reader follows.
    /// </summary>
    /// <returns>The settings.</returns>
    [HttpGet]
    [Produces(MediaTypeNames.Application.Json)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<ReaderSettingsResponse>> GetReaderSettings()
    {
        var info = await _authorizationContext.GetAuthorizationInfo(HttpContext).ConfigureAwait(false);
        if (info.UserId.Equals(Guid.Empty))
        {
            return Unauthorized();
        }

        var configuration = _configuration() ?? new PluginConfiguration();
        return new ReaderSettingsResponse(TranslateUrlFor(configuration.TranslateUrl), configuration.EnableFontUploads);
    }

    /// <summary>
    /// The settings as <see cref="GetReaderSettings"/> returns them.
    /// </summary>
    /// <param name="TranslateUrl">The translation address with {text} where the text goes; empty when Translate is off.</param>
    /// <param name="FontUploads">Whether readers may add their own fonts.</param>
    public record ReaderSettingsResponse(
        [property: JsonPropertyName("translateUrl")] string TranslateUrl,
        [property: JsonPropertyName("fontUploads")] bool FontUploads);
}
