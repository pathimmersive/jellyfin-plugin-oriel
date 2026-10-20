using System;
using Jellyfin.Plugin.Oriel.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.Oriel;

/// <summary>
/// The Oriel plugin entry point.
/// </summary>
public class Plugin : BasePlugin<PluginConfiguration>
{
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
}
