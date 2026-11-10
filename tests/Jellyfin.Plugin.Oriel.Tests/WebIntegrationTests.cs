using System.Linq;
using Jellyfin.Plugin.Oriel.Configuration;
using Jellyfin.Plugin.Oriel.Integration;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Jellyfin.Plugin.Oriel.Tests;

public class WebIntegrationTests
{
    [Fact]
    public void IsOnForAFreshInstall()
    {
        Assert.True(new PluginConfiguration().EnableWebIntegration);
    }

    [Fact]
    public void KeepsASavedSetting()
    {
        var saved = new System.Xml.Serialization.XmlSerializer(typeof(PluginConfiguration));
        using var text = new System.IO.StringReader("<PluginConfiguration><EnableWebIntegration>false</EnableWebIntegration></PluginConfiguration>");

        Assert.False(((PluginConfiguration)saved.Deserialize(text)!).EnableWebIntegration);
    }

    [Fact]
    public void TheRegistratorAddsTheMiddlewareAndNothingElseForJellyfinWeb()
    {
        var services = new ServiceCollection();

        new PluginServiceRegistrator().RegisterServices(services, null!);

        Assert.Single(services, d => d.ServiceType == typeof(IStartupFilter) && d.ImplementationType == typeof(WebPageStartupFilter));
        Assert.DoesNotContain(services, d => (d.ImplementationType?.FullName ?? string.Empty).Contains("FileTransformation", System.StringComparison.Ordinal));
        Assert.DoesNotContain(typeof(Plugin).Assembly.GetTypes(), type => type.FullName!.Contains("FileTransformation", System.StringComparison.Ordinal) || type.Name == "TransformCallbacks");
    }

    [Fact]
    public void ReaderAssetsServeTheLauncher()
    {
        Assert.True(new ReaderAssets().TryOpen(WebPatches.LauncherPath, out var content, out var contentType));
        content.Dispose();
        Assert.StartsWith("text/javascript", contentType);
    }
}
