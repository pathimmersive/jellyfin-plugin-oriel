using System.Linq;
using System.Text.Json.Nodes;
using Jellyfin.Plugin.Oriel.Integration;
using Xunit;

namespace Jellyfin.Plugin.Oriel.Tests;

public class WebPatchesTests
{
    private const string Index = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><script defer=\"defer\" src=\"main.jellyfin.bundle.js\"></script></head><body></body></html>";

    private const string Config = "{\"multiserver\":false,\"plugins\":[\"bookPlayer/plugin\",\"pdfPlayer/plugin\"]}";

    [Fact]
    public void IndexGetsOneClassicLauncherScriptInTheHead()
    {
        var patched = WebPatches.PatchIndex(Index);

        Assert.NotNull(patched);
        Assert.Contains("<script src=\"../Oriel/integration/launcher.js\"></script></head>", patched);
        Assert.Equal(Index, patched.Replace("<script src=\"../Oriel/integration/launcher.js\"></script>", string.Empty));
    }

    [Fact]
    public void IndexIsLeftAloneWhenAlreadyPatchedOrWithoutAHead()
    {
        Assert.Null(WebPatches.PatchIndex(WebPatches.PatchIndex(Index)!));
        Assert.Null(WebPatches.PatchIndex("<html><body></body></html>"));
    }

    [Fact]
    public void ConfigListsThePlayerAfterTheStockPlugins()
    {
        var patched = WebPatches.PatchConfig(Config);

        Assert.NotNull(patched);
        var root = JsonNode.Parse(patched)!;
        Assert.Equal(["bookPlayer/plugin", "pdfPlayer/plugin", WebPatches.PlayerName], root["plugins"]!.AsArray().Select(node => node!.GetValue<string>()));
        Assert.False(root["multiserver"]!.GetValue<bool>());
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("{\"themes\":[]}")]
    [InlineData("{\"plugins\":{}}")]
    [InlineData("{\"plugins\":[\"OrielBookPlayer\"]}")]
    public void ConfigIsLeftAloneWithoutAPluginsListOrWhenAlreadyListed(string json)
    {
        Assert.Null(WebPatches.PatchConfig(json));
    }
}
