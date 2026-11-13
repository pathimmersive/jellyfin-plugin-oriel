using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
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

public sealed class LimitsTests : IDisposable
{
    private static readonly Guid Reader = Guid.NewGuid();
    private static readonly Guid OtherReader = Guid.NewGuid();
    private static readonly DateTimeOffset Now = new(2026, 11, 12, 12, 0, 0, TimeSpan.Zero);
    private static readonly BookInfo Dune = new(Guid.NewGuid(), "Dune", ["Frank Herbert"], "dune.epub");
    private static readonly BookInfo Emma = new(Guid.NewGuid(), "Emma", ["Jane Austen"], "emma.epub");

    private readonly string _folder = Path.Combine(Path.GetTempPath(), "oriel-limits-" + Guid.NewGuid().ToString("N"));
    private readonly PositionStore _store;

    public LimitsTests()
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
    public async Task RefusesABookmarkPastTheLimitWith409AndStillReturnsOneAlreadyThere()
    {
        Fill(Reader, bookmarks: PositionStore.MaxBookmarks, highlights: 0);
        var controller = new BookmarksController(_store, new FakeAuthorization(Reader), new FakeItemAccess(), new FixedTime(Now))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };

        var refused = Assert.IsType<ConflictObjectResult>((await controller.PostBookmark(Emma.ItemId, new(Cfi(0), 0.5, "One more"))).Result);
        Assert.Equal("limitReached", Assert.IsType<ConflictReason>(refused.Value).Reason);
        Assert.Equal(Cfi(0), (await controller.PostBookmark(Dune.ItemId, new(Cfi(0), 0.5, "Already here"))).Value!.Cfi);
        Assert.Equal(PositionStore.MaxBookmarks, _store.ListBookmarksForUser(Reader).Count);

        var other = new BookmarksController(_store, new FakeAuthorization(OtherReader), new FakeItemAccess(), new FixedTime(Now))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };
        Assert.NotNull((await other.PostBookmark(Emma.ItemId, new(Cfi(0), 0.5, "Theirs"))).Value);
    }

    [Fact]
    public async Task RefusesAHighlightPastTheLimitWith409()
    {
        Fill(Reader, bookmarks: 0, highlights: PositionStore.MaxHighlights);
        var controller = new HighlightsController(_store, new FakeAuthorization(Reader), new FakeItemAccess(), new FixedTime(Now))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };

        var refused = Assert.IsType<ConflictObjectResult>((await controller.PostHighlight(Emma.ItemId, new(Cfi(0), 0.5, "yellow", "One more"))).Result);
        Assert.Equal("limitReached", Assert.IsType<ConflictReason>(refused.Value).Reason);
        Assert.Equal(PositionStore.MaxHighlights, _store.ListHighlightsForUser(Reader).Count);
    }

    [Fact]
    public void StoresNothingWhenAnImportFailsPartWay()
    {
        var file = FileOf(Dune, positions: true, bookmarks: 3, highlights: 3);
        var catalog = new FakeCatalog(Dune) { FailAfter = 3 };

        Assert.Throws<IOException>(() => new ReadingData(_store, catalog).Import(Reader, file));

        Assert.True(catalog.Calls > 3);
        Assert.Null(_store.Get(Reader, Dune.ItemId));
        Assert.Empty(_store.ListBookmarksForUser(Reader));
        Assert.Empty(_store.ListHighlightsForUser(Reader));

        var imported = new ReadingData(_store, new FakeCatalog(Dune)).Import(Reader, file);
        Assert.Equal((1, 3, 3), (imported.Imported, imported.Bookmarks, imported.Highlights));
    }

    [Fact]
    public void ImportsTheRestAndNamesTheLimitWhenAFileGoesPastIt()
    {
        Fill(Reader, bookmarks: PositionStore.MaxBookmarks - 1, highlights: 0);
        var file = FileOf(Emma, positions: true, bookmarks: 3, highlights: 2);

        var result = new ReadingData(_store, new FakeCatalog(Dune, Emma)).Import(Reader, file);

        Assert.Equal((1, 1, 2), (result.Imported, result.Bookmarks, result.Highlights));
        Assert.Equal(["bookmarks"], result.Limited!);
        Assert.Equal(PositionStore.MaxBookmarks, _store.ListBookmarksForUser(Reader).Count);
        Assert.NotNull(_store.Get(Reader, Emma.ItemId));
    }

    [Fact]
    public async Task RefusesASecondImportWhileTheFirstRuns()
    {
        var catalog = new FakeCatalog(Dune) { Hold = new ManualResetEventSlim(false) };
        var data = new ReadingData(_store, catalog);
        var file = FileOf(Dune, positions: true, bookmarks: 1, highlights: 0);
        var first = Task.Run(() => data.Import(Reader, file));
        Assert.True(catalog.Entered.Wait(TimeSpan.FromSeconds(10)));

        Assert.Throws<ImportRunningException>(() => data.Import(Reader, file));
        var controller = new ReadingDataController(data, new FakeAuthorization(Reader), new FixedTime(Now))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { Request = { Body = new MemoryStream(ReadingData.Serialize(file)) } } },
        };
        var refused = Assert.IsType<ConflictObjectResult>((await controller.Import()).Result);
        Assert.Equal("importRunning", Assert.IsType<ConflictReason>(refused.Value).Reason);

        catalog.Hold.Set();
        Assert.Equal(1, (await first).Imported);
        Assert.Equal(0, data.Import(Reader, file).Imported);
    }

    [Fact]
    public void ExportsAndImports5000HighlightsAnd1000BookmarksWithinTenSecondsEach()
    {
        Fill(Reader, bookmarks: 1000, highlights: 5000);
        var data = new ReadingData(_store, new FakeCatalog(Dune));

        var clock = Stopwatch.StartNew();
        var bytes = ReadingData.Serialize(data.Export(Reader, Now));
        var exporting = clock.Elapsed;

        clock.Restart();
        var result = data.Import(OtherReader, ReadingData.Parse(bytes)!);
        var importing = clock.Elapsed;

        Assert.Equal((1000, 5000), (result.Bookmarks, result.Highlights));
        Assert.True(exporting < TimeSpan.FromSeconds(10), $"export took {exporting}");
        Assert.True(importing < TimeSpan.FromSeconds(10), $"import took {importing}");
    }

    private static string Cfi(int index) => $"epubcfi(/6/4!/4/2/1:{index})";

    private static ReadingDataFile FileOf(BookInfo book, bool positions, int bookmarks, int highlights)
    {
        var id = book.ItemId.ToString("N");
        return new ReadingDataFile(
            ReadingData.Format,
            ReadingData.Version,
            Now,
            positions ? [new ExportedPosition(id, book.Title, book.Authors, book.FileName, Cfi(0), 0.4, Now)] : [],
            Enumerable.Range(0, bookmarks).Select(i => (ExportedBookmark?)new ExportedBookmark(id, book.Title, book.Authors, book.FileName, Cfi(100 + i), 0.5, "Imported", Now)).ToList(),
            Enumerable.Range(0, highlights).Select(i => (ExportedHighlight?)new ExportedHighlight(id, book.Title, book.Authors, book.FileName, Cfi(200 + i), 0.5, "yellow", "Imported", Now)).ToList());
    }

    // Bookmarks and highlights for a user in Dune, written in one transaction so the test stays quick.
    private void Fill(Guid userId, int bookmarks, int highlights) =>
        _store.RunInTransaction(() =>
        {
            for (var i = 0; i < bookmarks; i++)
            {
                _store.AddBookmark(userId, Dune.ItemId, Cfi(i), 0.5, "Kept", Now);
            }

            for (var i = 0; i < highlights; i++)
            {
                _store.AddHighlight(userId, Dune.ItemId, Cfi(i), 0.5, "yellow", "Kept", Now);
            }

            return 0;
        });

    // The books a user can see; it can fail after a number of lookups, or hold the first until released.
    private sealed class FakeCatalog(params BookInfo[] visible) : IBookCatalog
    {
        public int FailAfter { get; init; } = int.MaxValue;

        public ManualResetEventSlim? Hold { get; init; }

        public ManualResetEventSlim Entered { get; } = new(false);

        public int Calls { get; private set; }

        public BookInfo? Find(Guid userId, Guid itemId)
        {
            Entered.Set();
            Hold?.Wait(TimeSpan.FromSeconds(30));
            if (++Calls > FailAfter)
            {
                throw new IOException("The library could not be read.");
            }

            return visible.FirstOrDefault(book => book.ItemId == itemId);
        }

        public IReadOnlyList<BookInfo> Books(Guid userId) => visible;
    }

    private sealed class FakeItemAccess : IItemAccess
    {
        public bool CanSee(Guid userId, Guid itemId) => true;
    }

    // AuthorizationInfo.UserId comes from its User; no user means an anonymous caller.
    private sealed class FakeAuthorization(Guid userId) : IAuthorizationContext
    {
        public Task<AuthorizationInfo> GetAuthorizationInfo(HttpContext requestContext) => Task.FromResult(Info());

        public Task<AuthorizationInfo> GetAuthorizationInfo(HttpRequest requestContext) => Task.FromResult(Info());

        private AuthorizationInfo Info() => new()
        {
            User = new User("reader", "provider", "reset") { Id = userId },
        };
    }

    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
