namespace Jellyfin.Plugin.Oriel.Integration;

/// <summary>
/// The server's BaseUrl as the start of a path.
/// </summary>
internal static class BaseUrl
{
    /// <summary>
    /// The BaseUrl with one leading slash and none at the end, however it was written; empty for none.
    /// </summary>
    /// <param name="baseUrl">The BaseUrl, with or without its slashes; null or empty for none.</param>
    /// <returns>"/jf" for "jf", "/jf/" or " /jf "; empty for none.</returns>
    public static string Root(string? baseUrl)
    {
        var root = (baseUrl ?? string.Empty).Trim().TrimEnd('/');
        return root.Length > 0 && root[0] != '/' ? "/" + root : root;
    }
}
