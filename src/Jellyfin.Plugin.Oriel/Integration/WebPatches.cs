using System;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Jellyfin.Plugin.Oriel.Integration;

/// <summary>
/// The two changes the integration makes to jellyfin-web as it is served:
/// a script tag for the launcher in index.html, and the launcher's player in config.json.
/// </summary>
public static class WebPatches
{
    /// <summary>
    /// The window property the launcher defines and config.json names.
    /// </summary>
    public const string PlayerName = "OrielBookPlayer";

    /// <summary>
    /// The launcher's path under the reader route.
    /// </summary>
    public const string LauncherPath = "integration/launcher.js";

    // Relative to {base}/web/, so it resolves under any configured BaseUrl.
    private const string LauncherTag = "<script src=\"../Oriel/" + LauncherPath + "\"></script>";

    /// <summary>
    /// Adds the launcher to index.html as a classic script, which runs before
    /// jellyfin-web's deferred bundles.
    /// </summary>
    /// <param name="html">The served index.html.</param>
    /// <returns>The patched page, or null to leave it unchanged.</returns>
    public static string? PatchIndex(string html)
    {
        if (html.Contains(LauncherTag, StringComparison.Ordinal))
        {
            return null;
        }

        var head = html.IndexOf("</head>", StringComparison.OrdinalIgnoreCase);
        return head < 0 ? null : html.Insert(head, LauncherTag);
    }

    /// <summary>
    /// Adds the launcher's player to the plugins jellyfin-web loads at startup.
    /// </summary>
    /// <param name="json">The served config.json.</param>
    /// <returns>The patched config, or null to leave it unchanged.</returns>
    public static string? PatchConfig(string json)
    {
        JsonNode? root;
        try
        {
            root = JsonNode.Parse(json);
        }
        catch (JsonException)
        {
            return null;
        }

        if (root?["plugins"] is not JsonArray plugins)
        {
            return null;
        }

        if (plugins.Any(plugin => plugin is JsonValue value && value.TryGetValue<string>(out var name) && name == PlayerName))
        {
            return null;
        }

        plugins.Add(PlayerName);
        return root.ToJsonString(new JsonSerializerOptions { WriteIndented = true });
    }
}
