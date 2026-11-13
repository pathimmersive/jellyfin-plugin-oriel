using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.Oriel.Configuration;

/// <summary>
/// Server-wide plugin settings.
/// </summary>
public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>
    /// Gets or sets a value indicating whether the jellyfin-web integration is on: Play and Resume on a book open Oriel.
    /// On by default; a jellyfin-web change can only break the integration, never the reader.
    /// </summary>
    public bool EnableWebIntegration { get; set; } = true;

    /// <summary>
    /// Gets or sets the address the reader's Translate opens, with {text} where the selected text goes.
    /// Google Translate's by default; empty, or not an https address, and the reader offers no Translate.
    /// </summary>
    public string? TranslateUrl { get; set; } = "https://translate.google.com/?sl=auto&op=translate&text={text}";

    /// <summary>
    /// Gets or sets a value indicating whether readers may add their own fonts, by upload or in an imported file.
    /// Off by default; fonts already added keep working while it is off.
    /// </summary>
    public bool EnableFontUploads { get; set; }
}
