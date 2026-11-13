using System;
using System.IO;
using System.Threading.Tasks;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Oriel.Controllers;
using Jellyfin.Plugin.Oriel.Data;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Xunit;
using Choice = Jellyfin.Plugin.Oriel.Controllers.ChoicesController.ChoicesRequest;
using Theme = Jellyfin.Plugin.Oriel.Controllers.ThemesController.ThemeRequest;

namespace Jellyfin.Plugin.Oriel.Tests;

public sealed class ChoicesControllerTests : IDisposable
{
    private static readonly Guid Reader = Guid.NewGuid();
    private static readonly Guid OtherReader = Guid.NewGuid();

    private readonly string _folder = Path.Combine(Path.GetTempPath(), "oriel-choices-" + Guid.NewGuid().ToString("N"));
    private readonly PositionStore _store;

    public ChoicesControllerTests()
    {
        _store = new PositionStore(Path.Combine(_folder, "oriel.db"));
    }

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        if (Directory.Exists(_folder))
        {
            Directory.Delete(_folder, recursive: true);
        }
    }

    [Fact]
    public async Task HasNoChoiceUntilTheReaderChooses()
    {
        Assert.Equal(new ChoicesController.ChoicesResponse(null, null), (await Controller(Reader).GetChoices()).Value);
    }

    [Fact]
    public async Task KeepsABuiltInThemeAndABundledFont()
    {
        var controller = Controller(Reader);

        Assert.Equal(new ChoicesController.ChoicesResponse("sepia", "Noto Serif"), (await controller.PutChoices(new Choice("sepia", "Noto Serif"))).Value);
        Assert.Equal(new ChoicesController.ChoicesResponse("dark", "Default"), (await controller.PutChoices(new Choice("dark", "Default"))).Value);
        Assert.Equal(new ChoicesController.ChoicesResponse("dark", "Default"), (await controller.GetChoices()).Value);
    }

    [Fact]
    public async Task KeepsTheReadersOwnThemeAndFont()
    {
        var theme = await OwnTheme(Reader);
        AddFont(Reader, "Merriweather");
        var controller = Controller(Reader);

        await controller.PutChoices(new Choice($"own:{theme}", "own:Merriweather"));

        Assert.Equal(new ChoicesController.ChoicesResponse($"own:{theme}", "own:Merriweather"), (await controller.GetChoices()).Value);
    }

    [Fact]
    public async Task KeepsEachReadersChoicesTheirOwn()
    {
        var theme = await OwnTheme(Reader);
        AddFont(Reader, "Merriweather");
        await Controller(Reader).PutChoices(new Choice($"own:{theme}", "own:Merriweather"));

        Assert.Equal(new ChoicesController.ChoicesResponse(null, null), (await Controller(OtherReader).GetChoices()).Value);
        Assert.Equal("invalidChoices", Refused.Reason((await Controller(OtherReader).PutChoices(new Choice($"own:{theme}", "Default"))).Result));
        Assert.Equal("invalidChoices", Refused.Reason((await Controller(OtherReader).PutChoices(new Choice("light", "own:Merriweather"))).Result));
    }

    [Fact]
    public async Task RefusesAThemeOrFontTheReaderDoesNotHave()
    {
        var controller = Controller(Reader);
        await controller.PutChoices(new Choice("sepia", "Literata"));

        foreach (var choice in new Choice?[]
        {
            null,
            new(null, "Default"),
            new("light", null),
            new("Light", "Default"),
            new("solarized", "Default"),
            new("own:", "Default"),
            new("own:gone", "Default"),
            new("light", "Comic Sans"),
            new("light", "own:Merriweather"),
        })
        {
            Assert.Equal("invalidChoices", Refused.Reason((await controller.PutChoices(choice)).Result));
        }

        Assert.Equal(new ChoicesController.ChoicesResponse("sepia", "Literata"), (await controller.GetChoices()).Value);
    }

    [Fact]
    public async Task ReturnsUnauthorizedWithoutACaller()
    {
        Assert.IsType<UnauthorizedResult>((await Controller(Guid.Empty).GetChoices()).Result);
        Assert.IsType<UnauthorizedResult>((await Controller(Guid.Empty).PutChoices(new Choice("light", "Default"))).Result);
    }

    private async Task<string> OwnTheme(Guid reader)
    {
        var themes = new ThemesController(_store, new FakeAuthorization(reader))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };
        var kept = (await themes.PutThemes([new Theme(null, "Night Blue", "#0f1a2a", "#d7dee8", "#9fb0c4", "#7cc4ff", "#2e5a85", "#2b4466", "#14243a", "#e6edf5", "#23395a", "#6c7f96")])).Value!;
        return kept[0].Id;
    }

    private void AddFont(Guid reader, string family) =>
        _store.AddFont(reader, new FontFile("ttf", family, "Regular", 400, false), [0, 1, 0, 0], DateTimeOffset.UtcNow);

    private ChoicesController Controller(Guid caller) =>
        new(_store, new FakeAuthorization(caller))
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
