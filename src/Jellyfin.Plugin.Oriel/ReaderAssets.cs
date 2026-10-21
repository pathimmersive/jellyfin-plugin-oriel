using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace Jellyfin.Plugin.Oriel;

/// <summary>
/// The built reader web app, embedded in the plugin assembly.
/// </summary>
public class ReaderAssets
{
    /// <summary>
    /// The file served for the reader route itself.
    /// </summary>
    public const string IndexFile = "index.html";

    private const string ResourcePrefix = "oriel-web/";

    private static readonly Dictionary<string, string> _contentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        [".html"] = "text/html; charset=utf-8",
        [".js"] = "text/javascript; charset=utf-8",
        [".mjs"] = "text/javascript; charset=utf-8",
        [".css"] = "text/css; charset=utf-8",
        [".json"] = "application/json; charset=utf-8",
        [".svg"] = "image/svg+xml",
        [".png"] = "image/png",
        [".woff2"] = "font/woff2",
        [".map"] = "application/json; charset=utf-8",
    };

    private readonly Dictionary<string, string> _resources;

    /// <summary>
    /// Initializes a new instance of the <see cref="ReaderAssets"/> class.
    /// </summary>
    public ReaderAssets()
    {
        // Resource names carry the path under dist/, with '\' when built on Windows.
        _resources = typeof(ReaderAssets).Assembly.GetManifestResourceNames()
            .Where(name => name.StartsWith(ResourcePrefix, StringComparison.Ordinal))
            .ToDictionary(name => name[ResourcePrefix.Length..].Replace('\\', '/'), name => name, StringComparer.Ordinal);
    }

    /// <summary>
    /// Gets the paths of the files that can be served, relative to the reader route.
    /// </summary>
    public IEnumerable<string> FileNames => _resources.Keys;

    /// <summary>
    /// Opens an embedded file by its path. Only paths in <see cref="FileNames"/> resolve,
    /// so a request path can never reach other resources.
    /// </summary>
    /// <param name="path">The path from the request, relative to the reader route.</param>
    /// <param name="content">The file content.</param>
    /// <param name="contentType">The file's content type.</param>
    /// <returns>Whether the file exists.</returns>
    public bool TryOpen(string path, out Stream content, out string contentType)
    {
        content = Stream.Null;
        contentType = string.Empty;
        if (!_resources.TryGetValue(path, out var resourceName))
        {
            return false;
        }

        var stream = typeof(ReaderAssets).Assembly.GetManifestResourceStream(resourceName);
        if (stream is null)
        {
            return false;
        }

        content = stream;
        contentType = _contentTypes.GetValueOrDefault(Path.GetExtension(path), "application/octet-stream");
        return true;
    }
}
