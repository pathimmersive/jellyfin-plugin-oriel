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

namespace Jellyfin.Plugin.Oriel.Tests;

public sealed class HighlightsControllerTests : IDisposable
{
    private const string Cfi = "epubcfi(/6/8!/4/2,/1:4,/1:30)";

    private static readonly Guid Reader = Guid.NewGuid();
    private static readonly Guid OtherReader = Guid.NewGuid();
    private static readonly Guid Book = Guid.NewGuid();
    private static readonly Guid HiddenBook = Guid.NewGuid();
    private static readonly DateTimeOffset Now = new(2026, 11, 2, 12, 0, 0, TimeSpan.Zero);

    private readonly string _folder = Path.Combine(Path.GetTempPath(), "oriel-highlights-" + Guid.NewGuid().ToString("N"));
    private readonly PositionStore _store;

    public HighlightsControllerTests()
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
    public async Task AddsListsRecoloursAndRemovesAHighlightStampedWithTheServerTime()
    {
        var controller = Controller(Reader);

        var added = (await controller.PostHighlight(Book, new(Cfi, 0.6, "yellow", "a dark and stormy night"))).Value!;
        Assert.Equal((Cfi, 0.6, "yellow", "a dark and stormy night", Now), (added.Cfi, added.Fraction, added.Colour, added.Text, added.CreatedAt));
        Assert.Equal([added], (await controller.GetHighlights(Book)).Value!);

        var recoloured = (await controller.PatchHighlight(Book, Guid.Parse(added.Id), new("pink"))).Value!;
        Assert.Equal(added with { Colour = "pink" }, recoloured);
        Assert.Equal([recoloured], (await controller.GetHighlights(Book)).Value!);

        Assert.IsType<NoContentResult>(await controller.DeleteHighlight(Book, Guid.Parse(added.Id)));
        Assert.Empty((await controller.GetHighlights(Book)).Value!);
    }

    [Fact]
    public async Task ReturnsTheHighlightAlreadyAtAPlaceInTheColourAskedFor()
    {
        var controller = Controller(Reader);

        var first = (await controller.PostHighlight(Book, new(Cfi, 0.6, "yellow", "First"))).Value!;
        var second = (await controller.PostHighlight(Book, new(Cfi, 0.6, "blue", "Second"))).Value!;

        Assert.Equal(first with { Colour = "blue" }, second);
        Assert.Single((await controller.GetHighlights(Book)).Value!);
    }

    [Fact]
    public async Task KeepsEachUsersHighlightsApart()
    {
        var mine = (await Controller(Reader).PostHighlight(Book, new(Cfi, 0.6, "green", "Mine"))).Value!;

        Assert.Empty((await Controller(OtherReader).GetHighlights(Book)).Value!);
        Assert.IsType<NotFoundResult>((await Controller(OtherReader).PatchHighlight(Book, Guid.Parse(mine.Id), new("pink"))).Result);
        Assert.IsType<NotFoundResult>(await Controller(OtherReader).DeleteHighlight(Book, Guid.Parse(mine.Id)));
        Assert.Equal("green", Assert.Single((await Controller(Reader).GetHighlights(Book)).Value!).Colour);
    }

    [Fact]
    public async Task ReturnsNotFoundForABookTheCallerCannotSeeOrAHighlightTheyDoNotHave()
    {
        _store.AddHighlight(Reader, HiddenBook, Cfi, 0.6, "yellow", "Hidden", Now);
        var hidden = _store.ListHighlights(Reader, HiddenBook).Single().Id;
        var controller = Controller(Reader);

        Assert.IsType<NotFoundResult>((await controller.GetHighlights(HiddenBook)).Result);
        Assert.IsType<NotFoundResult>((await controller.PostHighlight(HiddenBook, new(Cfi, 0.2, "yellow", "Text"))).Result);
        Assert.IsType<NotFoundResult>((await controller.PatchHighlight(HiddenBook, hidden, new("pink"))).Result);
        Assert.IsType<NotFoundResult>(await controller.DeleteHighlight(HiddenBook, hidden));
        Assert.IsType<NotFoundResult>((await controller.PatchHighlight(Book, Guid.NewGuid(), new("pink"))).Result);
        Assert.IsType<NotFoundResult>(await controller.DeleteHighlight(Book, Guid.NewGuid()));
        Assert.Equal("yellow", Assert.Single(_store.ListHighlights(Reader, HiddenBook)).Colour);
    }

    [Fact]
    public async Task ReturnsUnauthorizedWithoutACaller()
    {
        var controller = Controller(Guid.Empty);

        Assert.IsType<UnauthorizedResult>((await controller.GetHighlights(Book)).Result);
        Assert.IsType<UnauthorizedResult>((await controller.PostHighlight(Book, new(Cfi, 0.6, "yellow", "Text"))).Result);
        Assert.IsType<UnauthorizedResult>((await controller.PatchHighlight(Book, Guid.NewGuid(), new("pink"))).Result);
        Assert.IsType<UnauthorizedResult>(await controller.DeleteHighlight(Book, Guid.NewGuid()));
    }

    public static TheoryData<string?, double?, string?, string?> MalformedHighlights => new()
    {
        { null, 0.5, "yellow", "Text" },
        { string.Empty, 0.5, "yellow", "Text" },
        { new string('a', PositionsController.MaxCfiLength + 1), 0.5, "yellow", "Text" },
        { Cfi, null, "yellow", "Text" },
        { Cfi, -0.01, "yellow", "Text" },
        { Cfi, 1.01, "yellow", "Text" },
        { Cfi, double.NaN, "yellow", "Text" },
        { Cfi, 0.5, null, "Text" },
        { Cfi, 0.5, "purple", "Text" },
        { Cfi, 0.5, "Yellow", "Text" },
        { Cfi, 0.5, "yellow", null },
        { Cfi, 0.5, "yellow", new string('a', HighlightsController.MaxTextLength + 1) },
    };

    [Theory]
    [MemberData(nameof(MalformedHighlights))]
    public async Task RejectsAMalformedHighlightAndStoresNothing(string? cfi, double? fraction, string? colour, string? text)
    {
        Assert.IsType<BadRequestResult>((await Controller(Reader).PostHighlight(Book, new(cfi, fraction, colour, text))).Result);
        Assert.Empty(_store.ListHighlights(Reader, Book));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("purple")]
    public async Task RejectsAnUnknownColourAndLeavesTheHighlightAsItWas(string? colour)
    {
        var controller = Controller(Reader);
        var added = (await controller.PostHighlight(Book, new(Cfi, 0.6, "yellow", "Text"))).Value!;

        Assert.IsType<BadRequestResult>((await controller.PatchHighlight(Book, Guid.Parse(added.Id), new(colour))).Result);
        Assert.Equal([added], (await controller.GetHighlights(Book)).Value!);
    }

    private HighlightsController Controller(Guid caller) =>
        new(_store, new FakeAuthorization(caller), new FakeItemAccess([Book]), new FixedTime(Now))
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

    private sealed class FakeItemAccess(HashSet<Guid> visible) : IItemAccess
    {
        public bool CanSee(Guid userId, Guid itemId) => visible.Contains(itemId);
    }

    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
