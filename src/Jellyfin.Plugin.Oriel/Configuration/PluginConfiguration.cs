using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.Oriel.Configuration;

/// <summary>
/// Server-wide plugin settings.
/// </summary>
public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>
    /// Gets or sets a value indicating whether the optional jellyfin-web integration is on.
    /// Off by default so a jellyfin-web change can only break the integration, never the reader.
    /// </summary>
    public bool EnableWebIntegration { get; set; }
}
