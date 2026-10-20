using System.Collections.Generic;
using System.IO;

namespace Jellyfin.Plugin.Oriel;

/// <summary>
/// The reader page and its assets, embedded in the plugin assembly.
/// </summary>
public class ReaderAssets
{
    /// <summary>
    /// The file served for the reader route itself.
    /// </summary>
    public const string IndexFile = "index.html";

    private static readonly Dictionary<string, string> _contentTypes = new()
    {
        [IndexFile] = "text/html; charset=utf-8",
        ["reader.css"] = "text/css; charset=utf-8",
    };

    /// <summary>
    /// Gets the names of the files that can be served.
    /// </summary>
    public IEnumerable<string> FileNames => _contentTypes.Keys;

    /// <summary>
    /// Opens an embedded file by name. Only names in <see cref="FileNames"/> resolve,
    /// so a request path can never reach other resources.
    /// </summary>
    /// <param name="fileName">The file name from the request.</param>
    /// <param name="content">The file content.</param>
    /// <param name="contentType">The file's content type.</param>
    /// <returns>Whether the file exists.</returns>
    public bool TryOpen(string fileName, out Stream content, out string contentType)
    {
        content = Stream.Null;
        if (!_contentTypes.TryGetValue(fileName, out contentType!))
        {
            return false;
        }

        var stream = typeof(ReaderAssets).Assembly.GetManifestResourceStream($"{typeof(ReaderAssets).Namespace}.Web.{fileName}");
        if (stream is null)
        {
            return false;
        }

        content = stream;
        return true;
    }
}
