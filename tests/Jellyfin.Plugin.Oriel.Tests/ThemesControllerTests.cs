using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Oriel.Controllers;
using Jellyfin.Plugin.Oriel.Data;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Xunit;
using Entry = Jellyfin.Plugin.Oriel.Controllers.ThemesController.ThemeRequest;

namespace Jellyfin.Plugin.Oriel.Tests;

public sealed class ThemesControllerTests : IDisposable
{
    private static readonly Guid Reader = Guid.NewGuid();
    private static readonly Guid OtherReader = Guid.NewGuid();

    private readonly string _folder = Path.Combine(Path.GetTempPath(), "oriel-themes-" + Guid.NewGuid().ToString("N"));
    private readonly PositionStore _store;

    public ThemesControllerTests()
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

    // Night Blue, as the canvas draws it.
    private static Entry NightBlue(string? id = null, string name = "Night Blue") =>
        new(id, name, "#0f1a2a", "#D7DEE8", "#9fb0c4", "#7cc4ff", "#2e5a85", "#2b4466", "#14243a", "#e6edf5", "#23395a", "#6c7f96");

    [Fact]
    public async Task ListsNoThemesForAReaderWhoHasMadeNone()
    {
        Assert.Empty((await Controller(Reader).GetThemes()).Value!);
    }

    [Fact]
    public async Task AddsEditsAndDeletesThemes()
    {
        var controller = Controller(Reader);

        var added = (await controller.PutThemes([NightBlue(name: "  Night Blue "), NightBlue(name: "Paper")])).Value!;

        Assert.Equal(["Night Blue", "Paper"], added.Select(theme => theme.Name));
        Assert.Equal(
            ("#0f1a2a", "#d7dee8", "#9fb0c4", "#7cc4ff", "#2e5a85", "#2b4466", "#14243a", "#e6edf5", "#23395a", "#6c7f96"),
            (added[0].Background, added[0].Text, added[0].Secondary, added[0].Accent, added[0].Selection, added[0].Separator, added[0].Controls, added[0].ControlsText, added[0].Buttons, added[0].Grayed));
        Assert.Equal(32, added[0].Id.Length);
        Assert.NotEqual(added[0].Id, added[1].Id);
        Assert.Equal(added, (await controller.GetThemes()).Value!);

        var edited = (await controller.PutThemes([NightBlue(added[1].Id, "Paper") with { Background = "#f7f3ea" }])).Value!;

        Assert.Equal([(added[1].Id, "Paper", "#f7f3ea")], edited.Select(theme => (theme.Id, theme.Name, theme.Background)));
        Assert.Equal(edited, (await controller.GetThemes()).Value!);
    }

    [Fact]
    public async Task KeepsEachReadersThemesTheirOwn()
    {
        var mine = (await Controller(Reader).PutThemes([NightBlue()])).Value!;

        Assert.Empty((await Controller(OtherReader).GetThemes()).Value!);
        Assert.IsType<BadRequestResult>((await Controller(OtherReader).PutThemes([NightBlue(mine[0].Id)])).Result);
        Assert.Equal(mine, (await Controller(Reader).GetThemes()).Value!);
    }

    [Fact]
    public async Task RefusesAMalformedList()
    {
        var controller = Controller(Reader);
        var kept = (await controller.PutThemes([NightBlue()])).Value!;
        var id = kept[0].Id;

        foreach (var list in new List<Entry?>[]
        {
            [null],
            [NightBlue(name: " ")],
            [NightBlue(name: new string('a', 41))],
            [NightBlue() with { Accent = null }],
            [NightBlue() with { Grayed = "#6c7f9" }],
            [NightBlue() with { Selection = "rgba(0,0,0,.3)" }],
            [NightBlue("not-mine")],
            [NightBlue(id), NightBlue(id)],
            [.. Enumerable.Range(0, 13).Select(_ => (Entry?)NightBlue())],
        })
        {
            Assert.IsType<BadRequestResult>((await controller.PutThemes(list)).Result);
        }

        Assert.IsType<BadRequestResult>((await controller.PutThemes(null)).Result);
        Assert.Equal(kept, (await controller.GetThemes()).Value!);
        Assert.Equal(12, (await controller.PutThemes([.. Enumerable.Range(0, 12).Select(_ => (Entry?)NightBlue())])).Value!.Count);
    }

    [Fact]
    public async Task ReturnsUnauthorizedWithoutACaller()
    {
        Assert.IsType<UnauthorizedResult>((await Controller(Guid.Empty).GetThemes()).Result);
        Assert.IsType<UnauthorizedResult>((await Controller(Guid.Empty).PutThemes([NightBlue()])).Result);
    }

    private ThemesController Controller(Guid caller) =>
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
