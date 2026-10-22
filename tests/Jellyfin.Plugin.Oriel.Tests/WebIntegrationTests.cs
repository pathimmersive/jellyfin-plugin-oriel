using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Jellyfin.Plugin.Oriel.Configuration;
using Jellyfin.Plugin.FileTransformation;
using Jellyfin.Plugin.Oriel.Integration;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.Oriel.Tests;

[Collection(nameof(FakeFileTransformation))]
public class WebIntegrationTests : IDisposable
{
    public WebIntegrationTests() => PluginInterface.Reset();

    public void Dispose() => PluginInterface.Reset();

    private static FileTransformationBridge Installed() => new(() => [typeof(PluginInterface).Assembly]);

    private static FileTransformationBridge Missing() => new(() => [typeof(object).Assembly]);

    private static WebIntegrationService Service(FileTransformationBridge bridge) => new(bridge, NullLogger<WebIntegrationService>.Instance);

    [Fact]
    public void WithoutFileTransformationNothingIsRegistered()
    {
        Assert.False(Missing().IsAvailable);
        Assert.False(Missing().Register(Guid.NewGuid(), "^index\\.html$", nameof(TransformCallbacks.Index)));

        Service(Missing()).Apply(new PluginConfiguration { EnableWebIntegration = true });

        Assert.Empty(PluginInterface.Registered);
    }

    [Fact]
    public void RegistersBothPatchesOnlyWhenEnabled()
    {
        var service = Service(Installed());

        service.Apply(new PluginConfiguration { EnableWebIntegration = false });
        Assert.Empty(PluginInterface.Registered);

        service.Apply(new PluginConfiguration { EnableWebIntegration = true });
        var payloads = PluginInterface.Registered.Values.ToList();
        Assert.Equal(2, payloads.Count);
        Assert.Contains(payloads, p => p["fileNamePattern"] == "^index\\.html$" && p["callbackMethod"] == nameof(TransformCallbacks.Index));
        Assert.Contains(payloads, p => p["fileNamePattern"] == "^config\\.json$" && p["callbackMethod"] == nameof(TransformCallbacks.Config));
        Assert.All(payloads, p => Assert.Equal(typeof(TransformCallbacks).FullName, p["callbackClass"]));
        Assert.All(payloads, p => Assert.Equal(typeof(TransformCallbacks).Assembly.FullName, p["callbackAssembly"]));
    }

    [Fact]
    public void TurningItOffRemovesTheRegistrations()
    {
        var service = Service(Installed());
        service.Apply(new PluginConfiguration { EnableWebIntegration = true });

        service.Apply(new PluginConfiguration { EnableWebIntegration = false });

        Assert.Empty(PluginInterface.Registered);
        Assert.Equal(2, PluginInterface.Removed.Count);
    }

    [Fact]
    public void ARegistrationFailureLeavesThePluginRunning()
    {
        PluginInterface.Fail = true;

        Service(Installed()).Apply(new PluginConfiguration { EnableWebIntegration = true });

        Assert.Empty(PluginInterface.Registered);
    }

    [Fact]
    public void TheCallbacksMatchWhatFileTransformationInvokes()
    {
        // File Transformation calls a public static method with one parameter and takes a string back.
        foreach (var name in new[] { nameof(TransformCallbacks.Index), nameof(TransformCallbacks.Config) })
        {
            var method = typeof(TransformCallbacks).GetMethod(name)!;
            Assert.True(method.IsStatic && method.IsPublic);
            Assert.Equal(typeof(string), method.ReturnType);
            Assert.Equal(typeof(TransformInput), Assert.Single(method.GetParameters()).ParameterType);
        }
    }

    [Fact]
    public void ReaderAssetsServeTheLauncher()
    {
        Assert.True(new ReaderAssets().TryOpen(WebPatches.LauncherPath, out var content, out var contentType));
        content.Dispose();
        Assert.StartsWith("text/javascript", contentType);
    }
}

[CollectionDefinition(nameof(FakeFileTransformation), DisableParallelization = true)]
public class FakeFileTransformation;
