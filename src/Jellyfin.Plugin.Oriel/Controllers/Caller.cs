using System;
using System.Threading.Tasks;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Http;

namespace Jellyfin.Plugin.Oriel.Controllers;

/// <summary>
/// Who is calling: the one lookup every controller makes before it answers.
/// </summary>
internal static class Caller
{
    /// <summary>
    /// Gets the signed-in user making the request.
    /// </summary>
    /// <param name="authorizationContext">Jellyfin's authorization context.</param>
    /// <param name="httpContext">The request.</param>
    /// <returns>The caller's user id, or null when the request carries no user.</returns>
    public static async Task<Guid?> CallerAsync(this IAuthorizationContext authorizationContext, HttpContext httpContext)
    {
        var info = await authorizationContext.GetAuthorizationInfo(httpContext).ConfigureAwait(false);
        return info.UserId.Equals(Guid.Empty) ? null : info.UserId;
    }
}
