using System;
using System.Net.Mime;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;

namespace Jellyfin.Plugin.Oriel.Controllers;

/// <summary>
/// Serves the reader page at /Oriel/ and the endpoint that identifies the caller.
/// </summary>
[ApiController]
[Refusals]
[Route("Oriel")]
public partial class ReaderAssetsController : ControllerBase
{
    // One tag for every file of this build: a new build of the plugin gives every file a new one.
    private static readonly EntityTagHeaderValue BuildTag = new($"\"{typeof(ReaderAssets).Assembly.ManifestModule.ModuleVersionId:N}\"");

    private readonly ReaderAssets _assets;
    private readonly IAuthorizationContext _authorizationContext;

    /// <summary>
    /// Initializes a new instance of the <see cref="ReaderAssetsController"/> class.
    /// </summary>
    /// <param name="assets">The embedded reader assets.</param>
    /// <param name="authorizationContext">The host authorization context.</param>
    public ReaderAssetsController(ReaderAssets assets, IAuthorizationContext authorizationContext)
    {
        _assets = assets;
        _authorizationContext = authorizationContext;
    }

    /// <summary>
    /// Serves the reader page. Anonymous, because a browser navigation cannot attach an Authorization header.
    /// </summary>
    /// <returns>The reader page.</returns>
    [HttpGet("")]
    [AllowAnonymous]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status302Found)]
    public ActionResult GetReader()
    {
        // The page's asset references are relative, so they only resolve under the trailing slash.
        // A relative Location keeps any configured BaseUrl.
        if (!(Request.Path.Value ?? string.Empty).EndsWith('/'))
        {
            return Redirect("Oriel/" + Request.QueryString);
        }

        return GetAsset(ReaderAssets.IndexFile);
    }

    /// <summary>
    /// Serves one reader asset. Anonymous, like the page that references it.
    /// </summary>
    /// <param name="path">The asset path under the reader route.</param>
    /// <returns>The asset.</returns>
    [HttpGet("{**path}")]
    [AllowAnonymous]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public ActionResult GetAsset([FromRoute] string path)
    {
        if (!_assets.TryOpen(path, out var content, out var contentType))
        {
            return NotFound();
        }

        // The build names its scripts, styles and fonts by their content, so a browser can keep them; the
        // page, the manifest, the icons and the PDF files keep their names, so a browser asks again each time.
        if (ContentNamed().IsMatch(path))
        {
            Response.Headers.CacheControl = "public, max-age=31536000, immutable";
            return File(content, contentType);
        }

        Response.Headers.CacheControl = "no-cache";
        return File(content, contentType, lastModified: null, entityTag: BuildTag);
    }

    /// <summary>
    /// Returns the id of the authenticated caller.
    /// </summary>
    /// <returns>The caller's user id.</returns>
    [HttpGet("Me")]
    [Authorize]
    [Produces(MediaTypeNames.Application.Json)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<MeResponse>> GetMe()
    {
        var caller = await _authorizationContext.CallerAsync(HttpContext).ConfigureAwait(false);
        if (caller is not { } userId)
        {
            return Unauthorized();
        }

        return new MeResponse(userId);
    }

    /// <summary>
    /// The body of <see cref="GetMe"/>.
    /// </summary>
    /// <param name="UserId">The caller's user id.</param>
    public record MeResponse(Guid UserId);

    [GeneratedRegex(@"^assets/[^/]+-[A-Za-z0-9_-]{8}\.(js|css|woff2)$")]
    private static partial Regex ContentNamed();
}
