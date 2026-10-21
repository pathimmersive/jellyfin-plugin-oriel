using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Jellyfin.Plugin.Oriel.Tests;

public class ReaderAssetsTests
{
    private readonly ReaderAssets _assets = new();

    [Fact]
    public void EmbedsTheBuiltReaderIncludingNestedAssets()
    {
        Assert.Contains(ReaderAssets.IndexFile, _assets.FileNames);
        Assert.Contains(_assets.FileNames, name => name.StartsWith("assets/") && name.EndsWith(".js"));
        Assert.DoesNotContain(_assets.FileNames, name => name.Contains('\\'));
    }

    [Fact]
    public void EveryListedFileOpens()
    {
        foreach (var name in _assets.FileNames)
        {
            Assert.True(_assets.TryOpen(name, out var content, out _), name);
            content.Dispose();
        }
    }

    [Theory]
    [InlineData("index.html", "text/html")]
    [InlineData(".js", "text/javascript")]
    [InlineData(".css", "text/css")]
    public void ServesContentTypesByExtension(string suffix, string expected)
    {
        var name = _assets.FileNames.First(n => n.EndsWith(suffix));
        Assert.True(_assets.TryOpen(name, out var content, out var contentType));
        content.Dispose();
        Assert.StartsWith(expected, contentType);
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
            Assert.Contains(Regex.Replace(target, "^\\./", string.Empty), _assets.FileNames);
        }
    }

    [Theory]
    [InlineData("missing.js")]
    [InlineData("../Plugin.cs")]
    [InlineData("assets/../index.html")]
    [InlineData("oriel-web/index.html")]
    [InlineData("assets\\missing.js")]
    public void UnknownPathsDoNotResolve(string path)
    {
        Assert.False(_assets.TryOpen(path, out _, out _));
    }
}
