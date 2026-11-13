using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using MediaBrowser.Common.Net;
using MediaBrowser.Controller.Configuration;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Net.Http.Headers;

namespace Jellyfin.Plugin.Oriel.Integration;

/// <summary>
/// Changes jellyfin-web's index page and config.json as they are served, while the integration is on:
/// the launcher's script tag in the page and Oriel's player in config.json. Nothing is written on disk.
/// </summary>
public sealed partial class WebPageMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<WebPageMiddleware> _logger;
    private readonly Func<bool> _enabled;
    private readonly Func<string?> _baseUrl;
    private readonly Func<WebFile, string, string?> _change;
    private readonly System.Collections.Concurrent.ConcurrentDictionary<(WebFile File, int Length, int Hash), bool> _logged = new();

    /// <summary>
    /// Initializes a new instance of the <see cref="WebPageMiddleware"/> class.
    /// </summary>
    /// <param name="next">The rest of the pipeline.</param>
    /// <param name="logger">The logger.</param>
    /// <param name="configuration">The server configuration, for its BaseUrl.</param>
    public WebPageMiddleware(RequestDelegate next, ILogger<WebPageMiddleware> logger, IServerConfigurationManager configuration)
        : this(next, logger, () => Plugin.Instance?.Configuration.EnableWebIntegration == true, () => configuration.GetNetworkConfiguration().BaseUrl, Patch)
    {
    }

    // Whether the integration is on, the BaseUrl and the change are parameters so the tests can set them.
    internal WebPageMiddleware(RequestDelegate next, ILogger<WebPageMiddleware> logger, Func<bool> enabled, Func<string?> baseUrl, Func<WebFile, string, string?> change)
    {
        _next = next;
        _logger = logger;
        _enabled = enabled;
        _baseUrl = baseUrl;
        _change = change;
    }

    /// <summary>
    /// The files this middleware changes.
    /// </summary>
    public enum WebFile
    {
        /// <summary>None of them.</summary>
        None,

        /// <summary>The index page.</summary>
        Index,

        /// <summary>config.json.</summary>
        Config,
    }

    /// <summary>
    /// Tells which of jellyfin-web's files a path asks for, under the server's BaseUrl.
    /// </summary>
    /// <param name="path">The request's full path, its path base included.</param>
    /// <param name="baseUrl">The BaseUrl, with or without its slashes; empty for none.</param>
    /// <returns>The file, or <see cref="WebFile.None"/>.</returns>
    public static WebFile FileOf(PathString path, string? baseUrl)
    {
        var root = (baseUrl ?? string.Empty).Trim().TrimEnd('/');
        if (root.Length > 0 && root[0] != '/')
        {
            root = "/" + root;
        }

        var value = path.Value ?? string.Empty;
        bool Is(string end) => string.Equals(value, root + end, StringComparison.OrdinalIgnoreCase);
        if (Is("/web") || Is("/web/") || Is("/web/index.html"))
        {
            return WebFile.Index;
        }

        return Is("/web/config.json") ? WebFile.Config : WebFile.None;
    }

    /// <summary>
    /// Serves the request, changing the index page or config.json when it asks for one and the integration is on.
    /// </summary>
    /// <param name="context">The request.</param>
    /// <returns>A task that completes when the response is written.</returns>
    public async Task InvokeAsync(HttpContext context)
    {
        var request = context.Request;
        var head = HttpMethods.IsHead(request.Method);
        var file = head || HttpMethods.IsGet(request.Method) ? FileOf(request.PathBase.Add(request.Path), _baseUrl()) : WebFile.None;
        if (file == WebFile.None || !_enabled())
        {
            await _next(context).ConfigureAwait(false);
            return;
        }

        // The stock file is asked for whole, uncompressed and unconditional: the client's
        // validators describe the changed file, which only this middleware can answer for.
        var clientTag = request.Headers.IfNoneMatch.ToString();
        foreach (var name in new[] { HeaderNames.AcceptEncoding, HeaderNames.IfNoneMatch, HeaderNames.IfModifiedSince, HeaderNames.Range, HeaderNames.IfRange })
        {
            request.Headers.Remove(name);
        }

        // A HEAD runs as a GET, so its headers describe the file a GET would get.
        if (head)
        {
            request.Method = HttpMethods.Get;
        }

        var response = context.Response;
        var client = response.Body;
        byte[] stock;
        using (var buffer = new MemoryStream())
        {
            response.Body = buffer;
            try
            {
                await _next(context).ConfigureAwait(false);
            }
            finally
            {
                response.Body = client;
                if (head)
                {
                    request.Method = HttpMethods.Head;
                }
            }

            stock = buffer.ToArray();
        }

        var sent = stock;
        // Only a whole, plain file of the expected type is changed; anything else goes on as it came.
        var type = file == WebFile.Index ? "text/html" : "application/json";
        if (response.StatusCode == StatusCodes.Status200OK
            && response.ContentType?.StartsWith(type, StringComparison.OrdinalIgnoreCase) == true
            && !response.Headers.ContainsKey(HeaderNames.ContentEncoding))
        {
            sent = Change(file, stock);
            response.Headers.Remove(HeaderNames.LastModified);
            response.Headers.ETag = ETagOf(sent);
            if (clientTag.Split(',').Select(tag => tag.Trim()).Any(tag => tag == response.Headers.ETag.ToString() || tag == "*"))
            {
                response.StatusCode = StatusCodes.Status304NotModified;
                response.ContentLength = null;
                return;
            }
        }

        response.ContentLength = sent.Length;
        if (!head)
        {
            await client.WriteAsync(sent).ConfigureAwait(false);
        }
    }

    /// <summary>
    /// Gets the entity tag of a file as sent: a quoted prefix of its SHA-256.
    /// </summary>
    /// <param name="sent">The file as sent.</param>
    /// <returns>The entity tag.</returns>
    public static string ETagOf(byte[] sent) => "\"" + Convert.ToHexStringLower(SHA256.HashData(sent))[..16] + "\"";

    /// <summary>
    /// The change Oriel makes to a file: the launcher's tag in the index page, its player in config.json.
    /// </summary>
    /// <param name="file">The file.</param>
    /// <param name="text">The stock file.</param>
    /// <returns>The changed file, or null to leave it as it is.</returns>
    public static string? Patch(WebFile file, string text) =>
        file == WebFile.Index ? WebPatches.PatchIndex(text) : WebPatches.PatchConfig(text);

    private byte[] Change(WebFile file, byte[] stock)
    {
        try
        {
            var changed = _change(file, Encoding.UTF8.GetString(stock));

            // Each file and content is logged once, not on every request that serves it.
            if (_logged.TryAdd((file, stock.Length, StockHash(stock)), true))
            {
                if (changed is null)
                {
                    LogNothingToChange(_logger, file);
                }
                else
                {
                    LogChanged(_logger, file);
                }
            }

            return changed is null ? stock : Encoding.UTF8.GetBytes(changed);
        }
        catch (Exception exception)
        {
            // A fault can only cost the integration, never jellyfin-web.
            LogChangeFailed(_logger, file, exception);
            return stock;
        }
    }

    private static int StockHash(byte[] stock)
    {
        var hash = default(HashCode);
        hash.AddBytes(stock);
        return hash.ToHashCode();
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "Oriel changed jellyfin-web's {File} so that Play and Resume on a book open Oriel")]
    private static partial void LogChanged(ILogger logger, WebFile file);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Oriel found no place to change in jellyfin-web's {File}; serving it unchanged, so Play opens Jellyfin's own reader")]
    private static partial void LogNothingToChange(ILogger logger, WebFile file);

    [LoggerMessage(Level = LogLevel.Error, Message = "Changing jellyfin-web's {File} for Oriel failed; serving it unchanged")]
    private static partial void LogChangeFailed(ILogger logger, WebFile file, Exception exception);
}
