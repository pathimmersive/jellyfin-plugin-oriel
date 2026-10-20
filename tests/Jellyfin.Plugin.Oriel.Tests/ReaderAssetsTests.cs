using System.IO;
using System.Text.RegularExpressions;
using Xunit;

namespace Jellyfin.Plugin.Oriel.Tests;

public class ReaderAssetsTests
{
    private readonly ReaderAssets _assets = new();

    [Fact]
    public void EveryListedFileIsEmbedded()
    {
        foreach (var name in _assets.FileNames)
        {
            Assert.True(_assets.TryOpen(name, out var content, out _), name);
            content.Dispose();
        }
    }

    [Fact]
    public void IndexIsHtml()
    {
        Assert.True(_assets.TryOpen(ReaderAssets.IndexFile, out var content, out var contentType));
        content.Dispose();
        Assert.StartsWith("text/html", contentType);
    }

    [Fact]
    public void IndexReferencesOnlyRelativeAssetsThatExist()
    {
        Assert.True(_assets.TryOpen(ReaderAssets.IndexFile, out var content, out _));
        using var reader = new StreamReader(content);
        var html = reader.ReadToEnd();

        var references = Regex.Matches(html, "(?:src|href)=\"([^\"]*)\"");
        Assert.NotEmpty(references);
        foreach (Match reference in references)
        {
            var target = reference.Groups[1].Value;
            Assert.DoesNotMatch("^/|://", target);
            Assert.Contains(target, _assets.FileNames);
        }
    }

    [Theory]
    [InlineData("missing.js")]
    [InlineData("../Plugin.cs")]
    [InlineData("Jellyfin.Plugin.Oriel.Web.index.html")]
    public void UnknownNamesDoNotResolve(string name)
    {
        Assert.False(_assets.TryOpen(name, out _, out _));
    }
}
