using System;
using System.Net.Mime;
using System.Threading.Tasks;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Oriel.Controllers;

/// <summary>
/// Serves the reader page at /Oriel/ and the endpoint that identifies the caller.
/// </summary>
[ApiController]
[Route("Oriel")]
public class ReaderAssetsController : ControllerBase
{
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
            return Redirect("Oriel/");
        }

        return GetAsset(ReaderAssets.IndexFile);
    }

    /// <summary>
    /// Serves one reader asset. Anonymous, like the page that references it.
    /// </summary>
    /// <param name="fileName">The asset file name.</param>
    /// <returns>The asset.</returns>
    [HttpGet("{fileName}")]
    [AllowAnonymous]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public ActionResult GetAsset([FromRoute] string fileName)
    {
        if (!_assets.TryOpen(fileName, out var content, out var contentType))
        {
            return NotFound();
        }

        return File(content, contentType);
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
        var info = await _authorizationContext.GetAuthorizationInfo(HttpContext).ConfigureAwait(false);
        if (info.UserId.Equals(Guid.Empty))
        {
            return Unauthorized();
        }

        return new MeResponse(info.UserId);
    }

    /// <summary>
    /// The body of <see cref="GetMe"/>.
    /// </summary>
    /// <param name="UserId">The caller's user id.</param>
    public record MeResponse(Guid UserId);
}
