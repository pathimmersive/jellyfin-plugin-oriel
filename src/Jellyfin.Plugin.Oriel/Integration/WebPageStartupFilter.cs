using System;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;

namespace Jellyfin.Plugin.Oriel.Integration;

/// <summary>
/// Puts <see cref="WebPageMiddleware"/> ahead of the rest of Jellyfin's pipeline, so it sees jellyfin-web's files as they are served.
/// </summary>
public sealed class WebPageStartupFilter : IStartupFilter
{
    /// <inheritdoc />
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
    {
        app.UseMiddleware<WebPageMiddleware>();
        next(app);
    };
}
