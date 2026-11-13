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

public sealed class BookmarksControllerTests : IDisposable
{
    private const string Cfi = "epubcfi(/6/8!/4/2/1:0)";

    private static readonly Guid Reader = Guid.NewGuid();
    private static readonly Guid OtherReader = Guid.NewGuid();
    private static readonly Guid Book = Guid.NewGuid();
    private static readonly Guid HiddenBook = Guid.NewGuid();
    private static readonly DateTimeOffset Now = new(2026, 11, 2, 12, 0, 0, TimeSpan.Zero);

    private readonly string _folder = Path.Combine(Path.GetTempPath(), "oriel-bookmarks-" + Guid.NewGuid().ToString("N"));
    private readonly PositionStore _store;

    public BookmarksControllerTests()
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
    public async Task AddsListsAndRemovesABookmarkStampedWithTheServerTime()
    {
        var controller = Controller(Reader);

        var added = (await controller.PostBookmark(Book, new(Cfi, 0.6, "It was a dark and stormy night"))).Value!;
        Assert.Equal((Cfi, 0.6, "It was a dark and stormy night", Now), (added.Cfi, added.Fraction, added.Text, added.CreatedAt));
        Assert.Equal([added], (await controller.GetBookmarks(Book)).Value!);

        Assert.IsType<NoContentResult>(await controller.DeleteBookmark(Book, Guid.Parse(added.Id)));
        Assert.Empty((await controller.GetBookmarks(Book)).Value!);
    }

    [Fact]
    public async Task ReturnsTheBookmarkAlreadyAtAPlaceRatherThanAddingAnother()
    {
        var controller = Controller(Reader);

        var first = (await controller.PostBookmark(Book, new(Cfi, 0.6, "First"))).Value!;
        var second = (await controller.PostBookmark(Book, new(Cfi, 0.6, "Second"))).Value!;

        Assert.Equal(first, second);
        Assert.Single((await controller.GetBookmarks(Book)).Value!);
    }

    [Fact]
    public async Task KeepsEachUsersBookmarksApart()
    {
        var mine = (await Controller(Reader).PostBookmark(Book, new(Cfi, 0.6, "Mine"))).Value!;

        Assert.Empty((await Controller(OtherReader).GetBookmarks(Book)).Value!);
        Assert.IsType<NotFoundResult>(await Controller(OtherReader).DeleteBookmark(Book, Guid.Parse(mine.Id)));
        Assert.Single((await Controller(Reader).GetBookmarks(Book)).Value!);
    }

    [Fact]
    public async Task ReturnsNotFoundForABookTheCallerCannotSeeOrABookmarkTheyDoNotHave()
    {
        _store.AddBookmark(Reader, HiddenBook, Cfi, 0.6, "Hidden", Now);
        var controller = Controller(Reader);

        Assert.IsType<NotFoundResult>((await controller.GetBookmarks(HiddenBook)).Result);
        Assert.IsType<NotFoundResult>((await controller.PostBookmark(HiddenBook, new(Cfi, 0.2, "Page"))).Result);
        Assert.IsType<NotFoundResult>(await controller.DeleteBookmark(HiddenBook, _store.ListBookmarks(Reader, HiddenBook).Single().Id));
        Assert.IsType<NotFoundResult>(await controller.DeleteBookmark(Book, Guid.NewGuid()));
        Assert.Single(_store.ListBookmarks(Reader, HiddenBook));
    }

    [Fact]
    public async Task ReturnsUnauthorizedWithoutACaller()
    {
        var controller = Controller(Guid.Empty);

        Assert.IsType<UnauthorizedResult>((await controller.GetBookmarks(Book)).Result);
        Assert.IsType<UnauthorizedResult>((await controller.PostBookmark(Book, new(Cfi, 0.6, "Page"))).Result);
        Assert.IsType<UnauthorizedResult>(await controller.DeleteBookmark(Book, Guid.NewGuid()));
    }

    public static TheoryData<string?, double?, string?> MalformedBookmarks => new()
    {
        { null, 0.5, "Page" },
        { string.Empty, 0.5, "Page" },
        { new string('a', PositionsController.MaxCfiLength + 1), 0.5, "Page" },
        { Cfi, null, "Page" },
        { Cfi, -0.01, "Page" },
        { Cfi, 1.01, "Page" },
        { Cfi, double.NaN, "Page" },
        { Cfi, 0.5, null },
        { Cfi, 0.5, new string('a', BookmarksController.MaxTextLength + 1) },
    };

    [Theory]
    [MemberData(nameof(MalformedBookmarks))]
    public async Task RejectsAMalformedBookmarkAndStoresNothing(string? cfi, double? fraction, string? text)
    {
        var expected = cfi is not { Length: > 0 and <= PositionsController.MaxCfiLength } ? "invalidCfi"
            : fraction is not (>= 0 and <= 1) ? "invalidFraction"
            : "invalidText";
        Assert.Equal(expected, Refused.Reason((await Controller(Reader).PostBookmark(Book, new(cfi, fraction, text))).Result));
        Assert.Empty(_store.ListBookmarks(Reader, Book));
    }

    private BookmarksController Controller(Guid caller) =>
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
