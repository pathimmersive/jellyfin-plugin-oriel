using System;
using System.Threading.Tasks;
using MediaBrowser.Common.Net;
using MediaBrowser.Controller.Configuration;
using Microsoft.AspNetCore.Http;

namespace Jellyfin.Plugin.Oriel.Integration;

/// <summary>
/// Adds a strict Content-Security-Policy and two hardening headers to every response under Oriel's routes, so no
/// script inside a book can run: foliate-js renders sections in same-origin blob: frames that allow scripts, and a
/// blob: document inherits the reader's policy.
/// </summary>
public sealed class ReaderHeadersMiddleware
{
    /// <summary>
    /// The policy: scripts only from Oriel's own files, and the blob: and data: URLs the reader makes for the rest.
    /// </summary>
    public const string ContentSecurityPolicy =
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' blob:; img-src 'self' blob: data:; "
        + "font-src 'self' blob: data:; connect-src 'self' blob: data:; media-src 'self' blob: data:; worker-src 'self' blob:; "
        + "frame-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

    private readonly RequestDelegate _next;
    private readonly Func<string?> _baseUrl;

    /// <summary>
    /// Initializes a new instance of the <see cref="ReaderHeadersMiddleware"/> class.
    /// </summary>
    /// <param name="next">The rest of the pipeline.</param>
    /// <param name="configuration">The server configuration, for its BaseUrl.</param>
    public ReaderHeadersMiddleware(RequestDelegate next, IServerConfigurationManager configuration)
        : this(next, () => configuration.GetNetworkConfiguration().BaseUrl)
    {
    }

    // The BaseUrl is a parameter so the tests can set it.
    internal ReaderHeadersMiddleware(RequestDelegate next, Func<string?> baseUrl)
    {
        _next = next;
        _baseUrl = baseUrl;
    }

    /// <summary>
    /// Tells whether a path is one of Oriel's, under the server's BaseUrl.
    /// </summary>
    /// <param name="path">The request's full path, its path base included.</param>
    /// <param name="baseUrl">The BaseUrl, with or without its slashes; empty for none.</param>
    /// <returns>True for <c>{base}/Oriel</c> and anything under it.</returns>
    public static bool IsOriel(PathString path, string? baseUrl)
    {
        var root = (baseUrl ?? string.Empty).Trim().TrimEnd('/');
        if (root.Length > 0 && root[0] != '/')
        {
            root = "/" + root;
        }

        var value = path.Value ?? string.Empty;
        var prefix = root + "/Oriel";
        return value.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
            && (value.Length == prefix.Length || value[prefix.Length] == '/');
    }

    /// <summary>
    /// Serves the request, adding the headers to it when it is one of Oriel's.
    /// </summary>
    /// <param name="context">The request.</param>
    /// <returns>A task that completes when the response is written.</returns>
    public Task InvokeAsync(HttpContext context)
    {
        if (IsOriel(context.Request.PathBase.Add(context.Request.Path), _baseUrl()))
        {
            var response = context.Response;
            // Set as the response starts, so errors and redirects carry them too.
            response.OnStarting(() =>
            {
                response.Headers.ContentSecurityPolicy = ContentSecurityPolicy;
                response.Headers.XContentTypeOptions = "nosniff";
                response.Headers["Referrer-Policy"] = "same-origin";
                return Task.CompletedTask;
            });
        }

        return _next(context);
    }
}
