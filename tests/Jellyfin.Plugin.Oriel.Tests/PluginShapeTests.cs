using System;
using System.IO;
using System.Linq;
using System.Runtime.Versioning;
using System.Text.Json;
using Jellyfin.Plugin.Oriel.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Controller.Plugins;
using MediaBrowser.Model.Plugins;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Jellyfin.Plugin.Oriel.Tests;

public class PluginShapeTests
{
    private static readonly Type[] _pluginTypes = typeof(Plugin).Assembly.GetTypes();

    [Fact]
    public void TargetsNet10()
    {
        var attribute = typeof(Plugin).Assembly.GetCustomAttributes(typeof(TargetFrameworkAttribute), false)
            .Cast<TargetFrameworkAttribute>()
            .Single();

        Assert.Equal(".NETCoreApp,Version=v10.0", attribute.FrameworkName);
    }

    [Fact]
    public void PluginSubclassesBasePluginWithItsConfiguration()
    {
        Assert.True(typeof(BasePlugin<PluginConfiguration>).IsAssignableFrom(typeof(Plugin)));
    }

    [Fact]
    public void ServicesAreRegisteredThroughARegistrator()
    {
        var registrator = _pluginTypes.Single(t => typeof(IPluginServiceRegistrator).IsAssignableFrom(t) && !t.IsAbstract);
        var services = new ServiceCollection();

        ((IPluginServiceRegistrator)Activator.CreateInstance(registrator)!).RegisterServices(services, null!);

        Assert.Contains(services, d => d.ServiceType == typeof(ReaderAssets));
    }

    [Fact]
    public void NoTypeImplementsIHasWebPages()
    {
        Assert.DoesNotContain(_pluginTypes, t => typeof(IHasWebPages).IsAssignableFrom(t));
    }

    [Fact]
    public void WebIntegrationIsOffByDefault()
    {
        Assert.False(new PluginConfiguration().EnableWebIntegration);
    }

    [Fact]
    public void MetaJsonDeclaresTheTargetAbiAndThePluginId()
    {
        using var meta = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "meta.json")));

        Assert.Equal("12.0.0.0", meta.RootElement.GetProperty("targetAbi").GetString());
        Assert.Equal(Plugin.PluginId, meta.RootElement.GetProperty("guid").GetString());
    }
}
