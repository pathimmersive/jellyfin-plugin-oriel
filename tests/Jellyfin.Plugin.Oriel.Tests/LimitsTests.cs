using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Oriel.Configuration;
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
    private readonly StoreSet _store;

    public LimitsTests()
    {
        _store = new StoreSet(Path.Combine(_folder, "oriel.db"));
    }

    public void Dispose()
    {
        Pools.Release(_folder);
        if (Directory.Exists(_folder))
        {
            Directory.Delete(_folder, recursive: true);
        }
    }

    [Fact]
    public async Task RefusesABookmarkPastTheLimitWith409AndStillReturnsOneAlreadyThere()
    {
        Fill(Reader, bookmarks: ReadingRules.MaxBookmarks, highlights: 0);
        var controller = new BookmarksController(_store.Bookmarks, new FakeAuthorization(Reader), new FakeItemAccess(), new FixedTime(Now))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };

        var refused = Assert.IsType<ConflictObjectResult>((await controller.PostBookmark(Emma.ItemId, new(Cfi(0), 0.5, "One more"))).Result);
        Assert.Equal("limitReached", Assert.IsType<RequestRefusal>(refused.Value).Reason);
        Assert.Equal(Cfi(0), (await controller.PostBookmark(Dune.ItemId, new(Cfi(0), 0.5, "Already here"))).Value!.Cfi);
        Assert.Equal(ReadingRules.MaxBookmarks, _store.Bookmarks.ListForUser(Reader).Count);

        var other = new BookmarksController(_store.Bookmarks, new FakeAuthorization(OtherReader), new FakeItemAccess(), new FixedTime(Now))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };
        Assert.NotNull((await other.PostBookmark(Emma.ItemId, new(Cfi(0), 0.5, "Theirs"))).Value);
    }

    [Fact]
    public async Task RefusesAHighlightPastTheLimitWith409()
    {
        Fill(Reader, bookmarks: 0, highlights: ReadingRules.MaxHighlights);
        var controller = new HighlightsController(_store.Highlights, _store.Highlighters, new FakeAuthorization(Reader), new FakeItemAccess(), new FixedTime(Now))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };

        var refused = Assert.IsType<ConflictObjectResult>((await controller.PostHighlight(Emma.ItemId, new(Cfi(0), 0.5, "yellow", "One more"))).Result);
        Assert.Equal("limitReached", Assert.IsType<RequestRefusal>(refused.Value).Reason);
        Assert.Equal(ReadingRules.MaxHighlights, _store.Highlights.ListForUser(Reader).Count);
    }

    [Fact]
    public void ReportsTheErrorThatStoppedTheWorkWhenSqliteHasAlreadyRolledBack()
    {
        // After some errors (a full disk, an I/O error) SQLite ends the transaction itself.
        var stopped = Assert.Throws<InvalidOperationException>(() => _store.Database.RunInTransaction<int>(() =>
        {
            using var connection = _store.Database.Open();
            using var rollback = connection.CreateCommand();
            rollback.CommandText = "ROLLBACK";
            rollback.ExecuteNonQuery();
            throw new InvalidOperationException("The work failed.");
        }));

        Assert.Equal("The work failed.", stopped.Message);
    }

    [Fact]
    public void StoresNothingWhenAnImportFailsPartWay()
    {
        // Dune's position and bookmarks are written before Emma's highlights, whose lookup fails.
        var file = FileOf(Dune, positions: true, bookmarks: 3, highlights: 0) with
        {
            Highlights = FileOf(Emma, positions: false, bookmarks: 0, highlights: 3).Highlights,
        };
        var catalog = new FakeCatalog(Dune, Emma) { FailAfter = 1 };

        Assert.Throws<IOException>(() => new ReadingData(_store.Database, _store.All, catalog).Import(Reader, file));

        Assert.Equal(2, catalog.Calls);
        Assert.Null(_store.Positions.Get(Reader, Dune.ItemId));
        Assert.Empty(_store.Bookmarks.ListForUser(Reader));
        Assert.Empty(_store.Highlights.ListForUser(Reader));

        var imported = new ReadingData(_store.Database, _store.All, new FakeCatalog(Dune, Emma)).Import(Reader, file);
        Assert.Equal((1, 3, 3), (imported.Imported, imported.Bookmarks, imported.Highlights));
    }

    [Fact]
    public void ImportsTheRestAndNamesTheLimitWhenAFileGoesPastIt()
    {
        Fill(Reader, bookmarks: ReadingRules.MaxBookmarks - 1, highlights: 0);
        var file = FileOf(Emma, positions: true, bookmarks: 3, highlights: 2);

        var result = new ReadingData(_store.Database, _store.All, new FakeCatalog(Dune, Emma)).Import(Reader, file);

        Assert.Equal((1, 1, 2), (result.Imported, result.Bookmarks, result.Highlights));
        Assert.Equal(["bookmarks"], result.Limited!);
        Assert.Equal(ReadingRules.MaxBookmarks, _store.Bookmarks.ListForUser(Reader).Count);
        Assert.NotNull(_store.Positions.Get(Reader, Emma.ItemId));
    }

    [Fact]
    public void ImportsHighlightsUpToTheLimitAndNamesIt()
    {
        Fill(Reader, bookmarks: 0, highlights: ReadingRules.MaxHighlights - 1);
        var file = FileOf(Emma, positions: false, bookmarks: 0, highlights: 3);

        var result = new ReadingData(_store.Database, _store.All, new FakeCatalog(Dune, Emma)).Import(Reader, file);

        Assert.Equal(1, result.Highlights);
        Assert.Equal(["highlights"], result.Limited!);
        Assert.Equal(ReadingRules.MaxHighlights, _store.Highlights.ListForUser(Reader).Count);
    }

    [Fact]
    public void ImportsFontsUntilTheUserHasTheMostAllowed()
    {
        for (var i = 0; i < ReadingRules.MaxFonts - 1; i++)
        {
            _store.Fonts.Add(Reader, new FontFile("ttf", $"Kept {i}", "Regular", 400, false), [0, 1, 0, 0], Now);
        }

        var file = FontsFile(("Charter", 400, 0), ("Literata", 400, 0), ("Atkinson", 400, 0));

        var result = Uploading().Import(Reader, file);

        Assert.Equal(1, result.Fonts);
        Assert.Equal(ReadingRules.MaxFonts, _store.Fonts.List(Reader).Count);
        Assert.Contains(_store.Fonts.List(Reader), font => font.Font.Family == "Charter");
    }

    [Fact]
    public void SkipsAFontPastTheQuotaAndImportsTheSmallerOnesAfterIt()
    {
        // Room for about 1,000 more bytes: the first font in the file is larger, the second is small.
        var small = FontsControllerTests.TrueType("Small", "Regular", 400, false).Length;
        _store.Fonts.Add(Reader, new FontFile("ttf", "Kept", "Regular", 400, false), new byte[ReadingRules.MaxFontBytes - small - 100], Now);
        var file = FontsFile(("Large", 400, 5_000), ("Small", 400, 0));

        var result = Uploading().Import(Reader, file);

        Assert.Equal(1, result.Fonts);
        Assert.Equal(["Kept", "Small"], _store.Fonts.List(Reader).Select(font => font.Font.Family).Order().ToArray());
    }

    [Fact]
    public void RunsWorkInsideATransactionAsPartOfIt()
    {
        // The inner call joins the outer transaction: when the outer fails, the inner write goes too.
        Assert.Throws<InvalidOperationException>(() => _store.Database.RunInTransaction<int>(() =>
        {
            _store.Database.RunInTransaction(() =>
            {
                _store.Positions.Save(Reader, Dune.ItemId, new StoredPosition(Cfi(0), 0.5, Now));
                return 0;
            });
            throw new InvalidOperationException("The outer work failed.");
        }));

        Assert.Null(_store.Positions.Get(Reader, Dune.ItemId));
    }

    [Fact]
    public async Task RefusesASecondImportWhileTheFirstRuns()
    {
        var catalog = new FakeCatalog(Dune) { Hold = new ManualResetEventSlim(false) };
        var data = new ReadingData(_store.Database, _store.All, catalog);
        var file = FileOf(Dune, positions: true, bookmarks: 1, highlights: 0);
        var first = Task.Run(() => data.Import(Reader, file));
        Assert.True(catalog.Entered.Wait(TimeSpan.FromSeconds(10)));

        Assert.Throws<ImportRunningException>(() => data.Import(Reader, file));
        var controller = new ReadingDataController(data, new FakeAuthorization(Reader), new FixedTime(Now))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { Request = { Body = new MemoryStream(ReadingFiles.Serialize(file)) } } },
        };
        var refused = Assert.IsType<ConflictObjectResult>((await controller.Import()).Result);
        Assert.Equal("importRunning", Assert.IsType<RequestRefusal>(refused.Value).Reason);

        catalog.Hold.Set();
        Assert.Equal(1, (await first).Imported);
        Assert.Equal(0, data.Import(Reader, file).Imported);
    }

    [Fact]
    public void ExportsAndImports5000HighlightsAnd1000BookmarksWithinTenSecondsEach()
    {
        Fill(Reader, bookmarks: 1000, highlights: 5000);
        var data = new ReadingData(_store.Database, _store.All, new FakeCatalog(Dune));

        var clock = Stopwatch.StartNew();
        var bytes = ReadingFiles.Serialize(data.Export(Reader, Now));
        var exporting = clock.Elapsed;

        clock.Restart();
        var result = data.Import(OtherReader, ReadingFiles.Parse(bytes)!);
        var importing = clock.Elapsed;

        Assert.Equal((1000, 5000), (result.Bookmarks, result.Highlights));
        Assert.True(exporting < TimeSpan.FromSeconds(10), $"export took {exporting}");
        Assert.True(importing < TimeSpan.FromSeconds(10), $"import took {importing}");
    }

    [Fact]
    public void ImportsAFullFileMatchedByTitleAndAuthorsAgainstALargeLibraryWithinFiveSeconds()
    {
        // A file from another server: its ids are unknown here, so every entry is matched by title and authors.
        var library = Enumerable.Range(0, 5000).Select(i => new BookInfo(Guid.NewGuid(), $"Book {i}", [$"Author {i}", "Editor"], $"book-{i}.epub")).ToArray();
        var elsewhere = library.Select(_ => Guid.NewGuid().ToString("N")).ToArray();
        var file = new ReadingDataFile(
            ReadingData.Format,
            ReadingData.Version,
            Now,
            [],
            Enumerable.Range(0, ReadingRules.MaxBookmarks).Select(i => (ExportedBookmark?)new ExportedBookmark(
                elsewhere[i % 5000], $"book {i % 5000}", ["editor", $"author {i % 5000}"], null, Cfi(i), 0.5, "Imported", Now)).ToList(),
            Enumerable.Range(0, ReadingRules.MaxHighlights).Select(i => (ExportedHighlight?)new ExportedHighlight(
                elsewhere[i % 5000], $"Book {i % 5000}", [$"Author {i % 5000}", "Editor"], null, Cfi(i), 0.5, "yellow", "Imported", Now)).ToList());
        var data = new ReadingData(_store.Database, _store.All, new FakeCatalog(library));

        var clock = Stopwatch.StartNew();
        var result = data.Import(Reader, file);
        var importing = clock.Elapsed;

        Assert.Equal((ReadingRules.MaxBookmarks, ReadingRules.MaxHighlights), (result.Bookmarks, result.Highlights));
        Assert.Empty(result.Unmatched);
        Assert.Equal(4, _store.Highlights.List(Reader, library[1234].ItemId).Count);
        Assert.True(importing < TimeSpan.FromSeconds(5), $"import took {importing}");
    }

    [Fact]
    public async Task LetsAnotherUserSaveWhileAnImportMatchesItsBooks()
    {
        var catalog = new FakeCatalog(Dune, Emma) { Hold = new ManualResetEventSlim(false) };
        var data = new ReadingData(_store.Database, _store.All, catalog);
        var importing = Task.Run(() => data.Import(Reader, FileOf(Dune, positions: true, bookmarks: 1, highlights: 1)));
        Assert.True(catalog.Entered.Wait(TimeSpan.FromSeconds(10)));

        var clock = Stopwatch.StartNew();
        var failed = Record.Exception(() => _store.Positions.Save(OtherReader, Emma.ItemId, new StoredPosition(Cfi(0), 0.3, Now)));
        var saving = clock.Elapsed;
        catalog.Hold.Set();

        Assert.Null(failed);
        Assert.True(saving < TimeSpan.FromSeconds(1), $"the save waited {saving}");
        Assert.Equal(0.3, _store.Positions.Get(OtherReader, Emma.ItemId)!.Fraction);
        Assert.Equal((1, 1, 1), ((await importing).Imported, (await importing).Bookmarks, (await importing).Highlights));
    }

    [Fact]
    public async Task RefusesAnotherUsersImportWhileOneRuns()
    {
        // An import holds the database's write lock, so a second one, of anyone's, is turned away at once.
        var catalog = new FakeCatalog(Dune) { Hold = new ManualResetEventSlim(false) };
        var data = new ReadingData(_store.Database, _store.All, catalog);
        var file = FileOf(Dune, positions: true, bookmarks: 1, highlights: 0);
        var first = Task.Run(() => data.Import(Reader, file));
        Assert.True(catalog.Entered.Wait(TimeSpan.FromSeconds(10)));

        Assert.Throws<ImportRunningException>(() => data.Import(OtherReader, file));

        catalog.Hold.Set();
        Assert.Equal(1, (await first).Imported);
        Assert.Equal(1, data.Import(OtherReader, file).Imported);
    }

    [Theory]
    [InlineData("positions", ReadingData.MaxPositions)]
    [InlineData("bookmarks", ReadingRules.MaxBookmarks)]
    [InlineData("highlights", ReadingRules.MaxHighlights)]
    [InlineData("highlighters", ReadingRules.MaxHighlighters)]
    [InlineData("themes", ReadingRules.MaxThemes)]
    [InlineData("fonts", ReadingRules.MaxFonts)]
    public void RefusesAFileHoldingMoreThanAnyUserCanHave(string list, int limit)
    {
        Assert.NotNull(ReadingFiles.Parse(ReadingFiles.Serialize(Holding(list, limit))));

        Assert.Null(ReadingFiles.Parse(ReadingFiles.Serialize(Holding(list, limit + 1)), out var reason));
        Assert.Equal("malformed", reason);
    }

    // A file holding the number of entries given in one list, each of them valid.
    private static ReadingDataFile Holding(string list, int count)
    {
        var id = Dune.ItemId.ToString("N");
        var file = new ReadingDataFile(ReadingData.Format, ReadingData.Version, Now, []);
        return list switch
        {
            "positions" => file with { Positions = Enumerable.Range(0, count).Select(i => (ExportedPosition?)new ExportedPosition(id, "Dune", [], "dune.epub", Cfi(i), 0.4, Now)).ToList() },
            "bookmarks" => FileOf(Dune, positions: false, bookmarks: count, highlights: 0),
            "highlights" => FileOf(Dune, positions: false, bookmarks: 0, highlights: count),
            "highlighters" => file with { Highlighters = Enumerable.Range(0, count).Select(i => (ExportedHighlighter?)new ExportedHighlighter($"own{i}", $"Own {i}", "#123456")).ToList() },
            "themes" => file with { Themes = Enumerable.Range(0, count).Select(i => (ExportedTheme?)new ExportedTheme($"t{i}", $"Theme {i}", "#101010", "#202020", "#303030", "#404040", "#505050", "#606060", "#707070", "#808080", "#909090", "#a0a0a0")).ToList() },
            _ => FontsFile(Enumerable.Range(0, count).Select(i => ($"Family {i}", 400, 0)).ToArray()),
        };
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

    // An import that may add fonts, as one does while an admin allows uploads.
    private ReadingData Uploading() =>
        new(_store.Database, _store.All, new FakeCatalog(Dune, Emma), () => new PluginConfiguration { EnableFontUploads = true });

    // A file holding only fonts: each a TrueType file of the family and weight, padded by the bytes given.
    private static ReadingDataFile FontsFile(params (string Family, int Weight, int Padding)[] fonts) =>
        new(
            ReadingData.Format,
            ReadingData.Version,
            Now,
            [],
            Fonts: fonts.Select(font => (ExportedFont?)new ExportedFont(
                font.Family, "Regular", font.Weight, false, "ttf", FontsControllerTests.TrueType(font.Family, "Regular", font.Weight, false, font.Padding))).ToList());

    // Bookmarks and highlights for a user in Dune, written in one transaction so the test stays quick.
    private void Fill(Guid userId, int bookmarks, int highlights) =>
        _store.Database.RunInTransaction(() =>
        {
            for (var i = 0; i < bookmarks; i++)
            {
                _store.Bookmarks.Add(userId, Dune.ItemId, Cfi(i), 0.5, "Kept", Now);
            }

            for (var i = 0; i < highlights; i++)
            {
                _store.Highlights.Add(userId, Dune.ItemId, Cfi(i), 0.5, "yellow", "Kept", Now);
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
