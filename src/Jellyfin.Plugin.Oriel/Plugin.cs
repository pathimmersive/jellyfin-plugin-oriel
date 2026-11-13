using System;
using System.Collections.Generic;
using Jellyfin.Plugin.Oriel.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.Oriel;

/// <summary>
/// The Oriel plugin entry point.
/// </summary>
public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    /// <summary>
    /// The settings page's name: the Dashboard opens it at <c>configurationpage?name=oriel</c>.
    /// </summary>
    public const string SettingsPageName = "oriel";

    /// <summary>
    /// The settings page and its script, the plugin's only pages in the Dashboard. The reader stays at /Oriel/.
    /// </summary>
    public static readonly IReadOnlyList<PluginPageInfo> Pages =
    [
        new PluginPageInfo
        {
            Name = SettingsPageName,
            DisplayName = "Oriel",
            EmbeddedResourcePath = "oriel-settings/settingsPage.html",
        },
        new PluginPageInfo
        {
            Name = SettingsPageName + ".js",
            EmbeddedResourcePath = "oriel-settings/settingsPage.js",
        },
    ];

    /// <summary>
    /// The plugin id, also written to meta.json by the build.
    /// </summary>
    public const string PluginId = "2c488ea7-0cae-4499-a2a7-6bae27b4e8f6";

    /// <summary>
    /// Initializes a new instance of the <see cref="Plugin"/> class.
    /// </summary>
    /// <param name="applicationPaths">The host application paths.</param>
    /// <param name="xmlSerializer">The host XML serializer.</param>
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
    }

    /// <summary>
    /// Gets the loaded plugin instance.
    /// </summary>
    public static Plugin? Instance { get; private set; }

    /// <inheritdoc />
    public override string Name => "Oriel";

    /// <inheritdoc />
    public override Guid Id => Guid.Parse(PluginId);

    /// <inheritdoc />
    public override string Description => "An e-book reader hosted on the Jellyfin server.";

    /// <inheritdoc />
    public IEnumerable<PluginPageInfo> GetPages() => Pages;
}
