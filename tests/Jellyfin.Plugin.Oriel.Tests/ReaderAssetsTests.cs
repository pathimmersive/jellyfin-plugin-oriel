using System;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Oriel.Controllers;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
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
    [InlineData("manifest.webmanifest", "application/manifest+json")]
    [InlineData("apple-touch-icon.png", "image/png")]
    [InlineData("favicon.svg", "image/svg+xml")]
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

    [Fact]
    public void KeepsBuiltFilesNamedByTheirContentForAYear()
    {
        var hashed = _assets.FileNames.Where(name => Regex.IsMatch(name, @"^assets/[^/]+-[A-Za-z0-9_-]{8}\.(js|css|woff2)$")).ToList();
        Assert.Contains(hashed, name => name.StartsWith("assets/index-", System.StringComparison.Ordinal));
        foreach (var name in hashed)
        {
            Assert.Equal("public, max-age=31536000, immutable", Serve(name).CacheControl);
        }
    }

    [Theory]
    [InlineData(ReaderAssets.IndexFile)]
    [InlineData("data.html")]
    [InlineData("manifest.webmanifest")]
    [InlineData("assets/vendor/pdfjs/pdf.worker.mjs")]
    [InlineData("assets/vendor/pdfjs/cmaps/Adobe-Japan1-0.bcmap")]
    public void RevalidatesFilesWhoseNamesStayTheSame(string path)
    {
        var first = Serve(path);
        Assert.Equal("no-cache", first.CacheControl);
        Assert.NotNull(first.ETag);
        Assert.Equal(first.ETag, Serve(path).ETag);
    }

    [Fact]
    public void SendsTheReaderRouteWithoutItsSlashToTheSlashKeepingTheQuery()
    {
        // The page's asset references are relative, so they resolve only under /Oriel/.
        var bare = Controller(Guid.Empty, "/Oriel", "?id=abc");
        var redirect = Assert.IsType<RedirectResult>(bare.GetReader());
        Assert.Equal("Oriel/?id=abc", redirect.Url);

        var page = Assert.IsType<FileStreamResult>(Controller(Guid.Empty, "/Oriel/", "?id=abc").GetReader());
        page.FileStream.Dispose();
        Assert.Equal("text/html", page.ContentType.Split(';')[0]);
    }

    [Fact]
    public void AnswersAFileTheReaderDoesNotHaveWith404()
    {
        Assert.IsType<NotFoundResult>(Controller(Guid.Empty).GetAsset("assets/missing.js"));
    }

    [Fact]
    public async Task NamesTheSignedInCallerAndRefusesAnyoneElse()
    {
        var reader = Guid.NewGuid();

        Assert.Equal(reader, (await Controller(reader).GetMe()).Value!.UserId);
        Assert.IsType<UnauthorizedResult>((await Controller(Guid.Empty).GetMe()).Result);
    }

    private ReaderAssetsController Controller(Guid caller, string path = "/Oriel/", string query = "")
    {
        var context = new DefaultHttpContext();
        context.Request.Path = path;
        context.Request.QueryString = new QueryString(query);
        return new ReaderAssetsController(_assets, new FakeAuthorization(caller)) { ControllerContext = new ControllerContext { HttpContext = context } };
    }

    // Serves one asset as the reader route does; gives its Cache-Control and its entity tag.
    private (string CacheControl, string? ETag) Serve(string path)
    {
        var controller = new ReaderAssetsController(_assets, null!) { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
        var result = Assert.IsType<FileStreamResult>(controller.GetAsset(path));
        result.FileStream.Dispose();
        return (controller.Response.Headers.CacheControl.ToString(), result.EntityTag?.Tag.Value);
    }

    // AuthorizationInfo.UserId comes from its User; no user means an anonymous caller.
    private sealed class FakeAuthorization(Guid userId) : IAuthorizationContext
    {
        public Task<AuthorizationInfo> GetAuthorizationInfo(HttpContext requestContext) => Task.FromResult(Info());

        public Task<AuthorizationInfo> GetAuthorizationInfo(HttpRequest requestContext) => Task.FromResult(Info());

        private AuthorizationInfo Info() => new()
        {
            User = userId.Equals(Guid.Empty) ? null : new User("reader", "provider", "reset") { Id = userId },
        };
    }
}
