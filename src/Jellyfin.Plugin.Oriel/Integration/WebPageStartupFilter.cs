using System;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;

namespace Jellyfin.Plugin.Oriel.Integration;

/// <summary>
/// Puts Oriel's middleware ahead of the rest of Jellyfin's pipeline: <see cref="ReaderHeadersMiddleware"/>, which adds
/// the reader's security headers, and <see cref="WebPageMiddleware"/>, which sees jellyfin-web's files as they are served.
/// </summary>
public sealed class WebPageStartupFilter : IStartupFilter
{
    /// <inheritdoc />
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
    {
        app.UseMiddleware<ReaderHeadersMiddleware>();
        app.UseMiddleware<WebPageMiddleware>();
        next(app);
    };
}
