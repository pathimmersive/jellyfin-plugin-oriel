using System;
using System.Threading.Tasks;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Oriel.Configuration;
using Jellyfin.Plugin.Oriel.Controllers;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Xunit;

namespace Jellyfin.Plugin.Oriel.Tests;

public sealed class ReaderSettingsControllerTests
{
    private const string Google = "https://translate.google.com/?sl=auto&op=translate&text={text}";

    [Fact]
    public async Task GivesGoogleTranslatesAddressByDefault()
    {
        Assert.Equal(Google, new PluginConfiguration().TranslateUrl);
        Assert.Equal(Google, (await Controller(Guid.NewGuid(), new PluginConfiguration()).GetReaderSettings()).Value!.TranslateUrl);
        Assert.Equal(Google, (await Controller(Guid.NewGuid(), null).GetReaderSettings()).Value!.TranslateUrl);
    }

    [Theory]
    [InlineData("https://www.deepl.com/translator#auto/en/{text}", "https://www.deepl.com/translator#auto/en/{text}")]
    [InlineData("  http://translate.example.lan/?q={text}  ", "http://translate.example.lan/?q={text}")]
    [InlineData("", "")]
    [InlineData("   ", "")]
    [InlineData(null, "")]
    [InlineData("javascript:alert({text})", "")]
    [InlineData("translate.google.com/?text={text}", "")]
    [InlineData("ftp://example.com/{text}", "")]
    public async Task GivesTheAdminsAddressOnlyWhenItIsHttpOrHttps(string? configured, string expected)
    {
        var configuration = new PluginConfiguration { TranslateUrl = configured };

        Assert.Equal(expected, (await Controller(Guid.NewGuid(), configuration).GetReaderSettings()).Value!.TranslateUrl);
    }

    [Fact]
    public async Task SaysWhetherFontUploadsAreOnOffByDefault()
    {
        Assert.False((await Controller(Guid.NewGuid(), new PluginConfiguration()).GetReaderSettings()).Value!.FontUploads);
        Assert.False((await Controller(Guid.NewGuid(), null).GetReaderSettings()).Value!.FontUploads);
        Assert.True((await Controller(Guid.NewGuid(), new PluginConfiguration { EnableFontUploads = true }).GetReaderSettings()).Value!.FontUploads);
    }

    [Fact]
    public async Task ReturnsUnauthorizedWithoutACaller()
    {
        Assert.IsType<UnauthorizedResult>((await Controller(Guid.Empty, new PluginConfiguration()).GetReaderSettings()).Result);
    }

    private static ReaderSettingsController Controller(Guid caller, PluginConfiguration? configuration) =>
        new(new FakeAuthorization(caller), () => configuration)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };

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
