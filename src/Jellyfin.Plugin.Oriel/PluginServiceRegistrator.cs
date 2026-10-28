using System;
using System.IO;
using Jellyfin.Plugin.Oriel.Data;
using Jellyfin.Plugin.Oriel.Integration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Jellyfin.Plugin.Oriel;

/// <summary>
/// Registers the plugin's services with the host container.
/// </summary>
public class PluginServiceRegistrator : IPluginServiceRegistrator
{
    /// <summary>
    /// The position database's file name in the plugin's data folder.
    /// </summary>
    public const string DatabaseFileName = "oriel.db";

    /// <inheritdoc />
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddSingleton<ReaderAssets>();
        serviceCollection.AddSingleton<FileTransformationBridge>();
        serviceCollection.AddHostedService<WebIntegrationService>();

        serviceCollection.TryAddSingleton(TimeProvider.System);
        serviceCollection.AddSingleton<IItemAccess, LibraryItemAccess>();
        serviceCollection.AddSingleton(services => new PositionStore(Path.Combine(DataFolder(services), DatabaseFileName)));
        serviceCollection.AddHostedService<PositionStoreStartup>();
        serviceCollection.AddSingleton<IBookCatalog, LibraryBookCatalog>();
        serviceCollection.AddSingleton<ReadingData>();
    }

    // The plugin's data folder: the one Jellyfin gave the plugin, or the same
    // rule BasePlugin uses (the plugins folder joined with the assembly name).
    private static string DataFolder(IServiceProvider services) =>
        Plugin.Instance?.DataFolderPath
        ?? Path.Combine(services.GetRequiredService<IApplicationPaths>().PluginsPath, typeof(Plugin).Assembly.GetName().Name!);
}
