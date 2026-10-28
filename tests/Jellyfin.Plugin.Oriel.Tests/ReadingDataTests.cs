using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
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

public sealed class ReadingDataTests : IDisposable
{
    private const string Cfi = "epubcfi(/6/8!/4/2/1:0)";
    private const string OtherCfi = "epubcfi(/6/10!/4/2/1:0)";

    private static readonly Guid Reader = Guid.NewGuid();
    private static readonly Guid OtherReader = Guid.NewGuid();
    private static readonly DateTimeOffset Now = new(2026, 10, 27, 12, 0, 0, TimeSpan.Zero);
    private static readonly BookInfo Dune = new(Guid.NewGuid(), "Dune", ["Frank Herbert"], "dune.epub");
    private static readonly BookInfo Emma = new(Guid.NewGuid(), "Emma", ["Jane Austen"], "emma.epub");
    private static readonly BookInfo Hidden = new(Guid.NewGuid(), "Hidden", ["Nobody"], "hidden.epub");

    private readonly string _folder = Path.Combine(Path.GetTempPath(), "oriel-data-" + Guid.NewGuid().ToString("N"));
    private readonly PositionStore _store;

    public ReadingDataTests()
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
    public void ExportsTheUsersOwnPositionsInBooksTheyCanSee()
    {
        _store.Save(Reader, Dune.ItemId, new StoredPosition(Cfi, 0.6, Now));
        _store.Save(Reader, Hidden.ItemId, new StoredPosition(Cfi, 0.2, Now));
        _store.Save(OtherReader, Emma.ItemId, new StoredPosition(OtherCfi, 0.3, Now));

        var file = Data(Dune, Emma).Export(Reader, Now.AddHours(1));

        Assert.Equal(ReadingData.Format, file.Format);
        Assert.Equal(ReadingData.Version, file.Version);
        Assert.Equal(Now.AddHours(1), file.ExportedAt);
        var entry = Assert.Single(file.Positions!);
        Assert.Equal(new ExportedPosition(Dune.ItemId.ToString("N"), "Dune", Dune.Authors, "dune.epub", Cfi, 0.6, Now), entry);
    }

    [Fact]
    public void AnExportedFileReadsBackUnchanged()
    {
        _store.Save(Reader, Dune.ItemId, new StoredPosition(Cfi, 0.6, Now.AddTicks(1234567)));
        var file = Data(Dune).Export(Reader, Now);

        var parsed = ReadingData.Parse(ReadingData.Serialize(file));

        Assert.NotNull(parsed);
        var (written, read) = (file.Positions!.Single()!, parsed.Positions!.Single()!);
        Assert.Equal(written.Authors, read.Authors);
        Assert.Equal(written with { Authors = null }, read with { Authors = null });
    }

    public static TheoryData<string, string> RejectedFiles => new()
    {
        { "not JSON", "{\"format\": \"oriel-reading-data\", \"positions\": [" },
        { "another format", "{\"format\": \"something-else\", \"version\": 1, \"positions\": []}" },
        { "no format", "{\"version\": 1, \"positions\": []}" },
        { "a newer version", "{\"format\": \"oriel-reading-data\", \"version\": 2, \"positions\": []}" },
        { "version 0", "{\"format\": \"oriel-reading-data\", \"version\": 0, \"positions\": []}" },
        { "a version that is not a number", "{\"format\": \"oriel-reading-data\", \"version\": \"1\", \"positions\": []}" },
        { "no positions", "{\"format\": \"oriel-reading-data\", \"version\": 1}" },
        { "a null position", File("null") },
        { "a position without a CFI", File("{\"fraction\": 0.5, \"savedAt\": \"2026-10-27T12:00:00Z\"}") },
        { "an empty CFI", File("{\"cfi\": \"\", \"fraction\": 0.5, \"savedAt\": \"2026-10-27T12:00:00Z\"}") },
        { "a CFI that is too long", File($"{{\"cfi\": \"{new string('a', ReadingData.MaxCfiLength + 1)}\", \"fraction\": 0.5, \"savedAt\": \"2026-10-27T12:00:00Z\"}}") },
        { "a fraction above 1", File("{\"cfi\": \"epubcfi(/6/2)\", \"fraction\": 1.5, \"savedAt\": \"2026-10-27T12:00:00Z\"}") },
        { "a fraction below 0", File("{\"cfi\": \"epubcfi(/6/2)\", \"fraction\": -0.1, \"savedAt\": \"2026-10-27T12:00:00Z\"}") },
        { "no fraction", File("{\"cfi\": \"epubcfi(/6/2)\", \"savedAt\": \"2026-10-27T12:00:00Z\"}") },
        { "no saved time", File("{\"cfi\": \"epubcfi(/6/2)\", \"fraction\": 0.5}") },
        { "a saved time that is not a time", File("{\"cfi\": \"epubcfi(/6/2)\", \"fraction\": 0.5, \"savedAt\": \"yesterday\"}") },
        { "an item id that is not an id", File("{\"itemId\": \"abc\", \"cfi\": \"epubcfi(/6/2)\", \"fraction\": 0.5, \"savedAt\": \"2026-10-27T12:00:00Z\"}") },
        { "a null author", File("{\"authors\": [null], \"cfi\": \"epubcfi(/6/2)\", \"fraction\": 0.5, \"savedAt\": \"2026-10-27T12:00:00Z\"}") },
    };

    [Theory]
    [MemberData(nameof(RejectedFiles))]
    public void RejectsAFileThatCannotBeImported(string reason, string json)
    {
        Assert.True(ReadingData.Parse(Encoding.UTF8.GetBytes(json)) is null, reason);
    }

    [Fact]
    public void KeepsWhicheverPositionWasSavedLast()
    {
        _store.Save(Reader, Dune.ItemId, new StoredPosition(Cfi, 0.6, Now));
        _store.Save(Reader, Emma.ItemId, new StoredPosition(Cfi, 0.6, Now));
        var data = Data(Dune, Emma);

        var result = data.Import(Reader, Import(
            Entry(Dune, OtherCfi, Now.AddMinutes(-1)),
            Entry(Emma, OtherCfi, Now.AddMinutes(1))));

        Assert.Equal((1, 1), (result.Imported, result.Kept));
        Assert.Equal(Cfi, _store.Get(Reader, Dune.ItemId)!.Cfi);
        Assert.Equal(new StoredPosition(OtherCfi, 0.4, Now.AddMinutes(1)), _store.Get(Reader, Emma.ItemId));
    }

    [Fact]
    public void ImportingTheSameFileTwiceChangesNothing()
    {
        var data = Data(Dune);
        var file = Import(Entry(Dune, Cfi, Now));

        Assert.Equal(1, data.Import(Reader, file).Imported);
        var again = data.Import(Reader, file);

        Assert.Equal((0, 1), (again.Imported, again.Kept));
        Assert.Equal(new StoredPosition(Cfi, 0.4, Now), _store.Get(Reader, Dune.ItemId));
    }

    [Fact]
    public void ImportsOnlyForTheCaller()
    {
        Data(Dune).Import(Reader, Import(Entry(Dune, Cfi, Now)));

        Assert.Null(_store.Get(OtherReader, Dune.ItemId));
    }

    [Fact]
    public void MatchesAnUnknownIdByTitleAndAuthorsIgnoringCaseAndOrder()
    {
        var anthology = new BookInfo(Guid.NewGuid(), "Tales", ["B. Writer", "A. Writer"], "tales.epub");
        var entry = Entry(anthology, Cfi, Now) with { ItemId = Guid.NewGuid().ToString(), Title = " tales ", Authors = ["a. writer", "B. WRITER"], FileName = null };

        var result = Data(Dune, anthology).Import(Reader, Import(entry));

        Assert.Equal(1, result.Imported);
        Assert.NotNull(_store.Get(Reader, anthology.ItemId));
    }

    [Fact]
    public void MatchesByFileNameWhenTitleAndAuthorsDoNot()
    {
        var entry = Entry(Dune, Cfi, Now) with { ItemId = null, Title = "Dune (Special Edition)", FileName = "DUNE.epub" };

        Assert.Equal(1, Data(Dune).Import(Reader, Import(entry)).Imported);
        Assert.NotNull(_store.Get(Reader, Dune.ItemId));
    }

    [Fact]
    public void ATitleMatchNeedsTheSameAuthors()
    {
        var entry = Entry(Dune, Cfi, Now) with { ItemId = null, Authors = ["Brian Herbert"], FileName = null };

        var result = Data(Dune).Import(Reader, Import(entry));

        Assert.Equal(0, result.Imported);
        Assert.Single(result.Unmatched);
    }

    [Fact]
    public void UsesFileNameWhenTheTitleMatchesMoreThanOneBook()
    {
        var copy = Dune with { ItemId = Guid.NewGuid(), FileName = "dune-copy.epub" };
        var entry = Entry(Dune, Cfi, Now) with { ItemId = null, FileName = "dune-copy.epub" };

        Assert.Equal(1, Data(Dune, copy).Import(Reader, Import(entry)).Imported);
        Assert.NotNull(_store.Get(Reader, copy.ItemId));
        Assert.Null(_store.Get(Reader, Dune.ItemId));
    }

    [Fact]
    public void ReportsABookItCannotMatchUnambiguouslyAndGuessesNothing()
    {
        var copy = Dune with { ItemId = Guid.NewGuid() };
        var ambiguous = Entry(Dune, Cfi, Now) with { ItemId = null };
        var missing = new ExportedPosition(Guid.NewGuid().ToString("N"), "Missing", ["Nobody"], "missing.epub", Cfi, 0.1, Now);

        var result = Data(Dune, copy).Import(Reader, Import(ambiguous, missing));

        Assert.Equal((0, 0), (result.Imported, result.Kept));
        Assert.Equal(["Dune", "Missing"], result.Unmatched.Select(book => book.Title));
        Assert.Equal(["Nobody"], result.Unmatched[1].Authors);
        Assert.Null(_store.Get(Reader, Dune.ItemId));
        Assert.Null(_store.Get(Reader, copy.ItemId));
    }

    [Fact]
    public void DoesNotImportIntoABookTheUserCannotSee()
    {
        var result = Data(Dune).Import(Reader, Import(Entry(Hidden, Cfi, Now)));

        Assert.Single(result.Unmatched);
        Assert.Null(_store.Get(Reader, Hidden.ItemId));
    }

    [Fact]
    public async Task ServesTheExportAsADownload()
    {
        _store.Save(Reader, Dune.ItemId, new StoredPosition(Cfi, 0.6, Now));

        var result = Assert.IsType<FileContentResult>(await Controller(Reader).Export());

        Assert.Equal("oriel-reading-data-2026-10-27.json", result.FileDownloadName);
        Assert.Equal("application/json", result.ContentType);
        Assert.Equal(Cfi, ReadingData.Parse(result.FileContents)!.Positions!.Single()!.Cfi);
    }

    [Fact]
    public async Task ImportsAPostedFile()
    {
        var file = ReadingData.Serialize(Import(Entry(Dune, Cfi, Now)));

        var result = (await Controller(Reader, file).Import()).Value;

        Assert.NotNull(result);
        Assert.Equal((1, 0, 0), (result.Imported, result.Kept, result.Unmatched.Count));
        Assert.NotNull(_store.Get(Reader, Dune.ItemId));
    }

    [Fact]
    public async Task RejectsAMalformedOrOversizedFileAndStoresNothing()
    {
        var tooLarge = Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(ReadingData.Serialize(Import(Entry(Dune, Cfi, Now))))
            .Replace("\"title\"", "\"padding\": \"" + new string(' ', ReadingDataController.MaxImportBytes) + "\", \"title\"", StringComparison.Ordinal));

        Assert.IsType<BadRequestResult>((await Controller(Reader, "{\"format\":"u8.ToArray()).Import()).Result);
        Assert.IsType<BadRequestResult>((await Controller(Reader, tooLarge).Import()).Result);
        Assert.Null(_store.Get(Reader, Dune.ItemId));
    }

    [Fact]
    public async Task ReturnsUnauthorizedWithoutACaller()
    {
        Assert.IsType<UnauthorizedResult>(await Controller(Guid.Empty).Export());
        Assert.IsType<UnauthorizedResult>((await Controller(Guid.Empty, ReadingData.Serialize(Import())).Import()).Result);
    }

    private static string File(string position) =>
        $"{{\"format\": \"oriel-reading-data\", \"version\": 1, \"positions\": [{position}]}}";

    private static ExportedPosition Entry(BookInfo book, string cfi, DateTimeOffset savedAt) =>
        new(book.ItemId.ToString("N"), book.Title, book.Authors, book.FileName, cfi, 0.4, savedAt);

    private static ReadingDataFile Import(params ExportedPosition[] positions) =>
        new(ReadingData.Format, ReadingData.Version, Now, positions);

    private ReadingData Data(params BookInfo[] visible) => new(_store, new FakeCatalog(visible));

    private ReadingDataController Controller(Guid caller, byte[]? body = null)
    {
        var context = new DefaultHttpContext();
        context.Request.Body = new MemoryStream(body ?? []);
        return new(Data(Dune, Emma), new FakeAuthorization(caller), new FixedTime(Now))
        {
            ControllerContext = new ControllerContext { HttpContext = context },
        };
    }

    private sealed class FakeCatalog(IReadOnlyList<BookInfo> visible) : IBookCatalog
    {
        public BookInfo? Find(Guid userId, Guid itemId) => visible.FirstOrDefault(book => book.ItemId == itemId);

        public IReadOnlyList<BookInfo> Books(Guid userId) => visible;
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

    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
