using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Oriel.Configuration;
using Jellyfin.Plugin.Oriel.Controllers;
using Jellyfin.Plugin.Oriel.Data;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using SQLitePCL;
using Xunit;

namespace Jellyfin.Plugin.Oriel.Tests;

/// <summary>
/// The fonts' files are in a table of their own, so what does not need a file does not read one.
/// </summary>
public sealed class FontFilesTests : IDisposable
{
    // The steps before the files had a table of their own.
    private const int Before = 8;

    private const int FiveMegabytes = 5 * 1000 * 1000;

    private static readonly Guid Reader = Guid.NewGuid();
    private static readonly Guid OtherReader = Guid.NewGuid();
    private static readonly DateTimeOffset Now = new(2026, 11, 24, 12, 0, 0, TimeSpan.Zero);

    private readonly string _folder = Path.Combine(Path.GetTempPath(), "oriel-font-files-" + Guid.NewGuid().ToString("N"));

    private string DatabasePath => Path.Combine(_folder, "oriel.db");

    public void Dispose()
    {
        Pools.Release(_folder);
        if (Directory.Exists(_folder))
        {
            Directory.Delete(_folder, recursive: true);
        }
    }

    [Fact]
    public void ListingFontsReadsNoStoredFile()
    {
        var store = Filled();

        AssertReadsNoFile(store, () => Assert.Equal(ReadingRules.MaxFonts - 1, store.Fonts.List(Reader).Count));
    }

    [Fact]
    public void SavingAChoiceReadsNoStoredFile()
    {
        var store = Filled();
        var choices = new ChoicesController(store.Choices, store.Themes, store.Fonts, new FakeAuthorization(Reader))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };

        AssertReadsNoFile(store, () => Assert.NotNull(choices.PutChoices(new("light", "own:Family 3")).GetAwaiter().GetResult()));

        Assert.Equal("own:Family 3", store.Choices.Get(Reader)!.Font);
    }

    [Fact]
    public void ImportingAFontReadsNoStoredFile()
    {
        var store = Filled();
        var font = new ExportedFont("Imported", "Regular", 400, false, "ttf", FontsControllerTests.TrueType("Imported", "Regular", 400, false, 0));
        var file = new ReadingDataFile(ReadingData.Format, ReadingData.Version, Now, [], Fonts: [font]);
        var data = new ReadingData(store.Database, store.All, new NoBooks(), () => new PluginConfiguration { EnableFontUploads = true });

        AssertReadsNoFile(store, () => Assert.Equal(1, data.Import(Reader, file).Fonts));
    }

    [Fact]
    public void ReadingAFileIsSeen()
    {
        // The checks above prove nothing unless reading one file is seen.
        var store = new StoreSet(DatabasePath);
        var added = store.Fonts.Add(Reader, Face("Family"), new byte[FiveMegabytes], Now).Font!;

        Assert.NotEmpty(Reads(store, () => Assert.NotNull(store.Fonts.GetData(Reader, added.Id))).Files);
    }

    [Fact]
    public void TheStepThatMovesTheFilesKeepsEveryFontByteForByte()
    {
        var random = new Random(133);
        var fonts = new List<(Guid Id, Guid User, FontFile Font, byte[] Data)>();
        foreach (var (user, size) in new[] { (Reader, FiveMegabytes), (Reader, 1), (Reader, 4096), (OtherReader, 70_000) })
        {
            var data = new byte[size];
            random.NextBytes(data);
            fonts.Add((Guid.NewGuid(), user, new FontFile("woff2", $"Family {size}", "Bold Italic", 700, true), data));
        }

        WriteBefore(fonts);

        var store = new StoreSet(DatabasePath);
        Assert.Equal(OrielDatabase.Schema.Count, store.Database.Migrate());

        foreach (var user in new[] { Reader, OtherReader })
        {
            var own = fonts.Where(font => font.User == user).ToList();
            Assert.Equal(
                own.Select(font => new StoredFont(font.Id, font.Font, Now)).OrderBy(font => font.Id),
                store.Fonts.List(user).OrderBy(font => font.Id));
            Assert.All(own, font =>
            {
                var read = store.Fonts.GetData(user, font.Id)!.Value;
                Assert.Equal("woff2", read.Format);
                Assert.Equal(font.Data, read.Data);
            });
        }

        Assert.Equal(["id", "user_id", "family", "style", "weight", "italic", "format", "added_at", "size"], Column("SELECT name FROM pragma_table_info('fonts') ORDER BY cid"));
        Assert.Equal(["font_id", "data"], Column("SELECT name FROM pragma_table_info('font_files') ORDER BY cid"));
        Assert.Equal(fonts.Sum(font => (long)font.Data.Length).ToString(CultureInfo.InvariantCulture), Assert.Single(Column("SELECT SUM(size) FROM fonts")));

        // The user's room still counts the files they had before.
        var rest = ReadingRules.MaxFontBytes - store.Fonts.List(Reader).Sum(font => (long)store.Fonts.GetData(Reader, font.Id)!.Value.Data.Length);
        Assert.Equal(FontAdded.QuotaFull, store.Fonts.Add(Reader, Face("Too much"), new byte[rest + 1], Now).Result);
        Assert.Equal(FontAdded.Added, store.Fonts.Add(Reader, Face("Just fits"), new byte[rest], Now).Result);
    }

    [Fact]
    public void AStepThatFailsPartWayLeavesTheDatabaseAsItWas()
    {
        var id = Guid.NewGuid();
        WriteBefore([(id, Reader, Face("Kept"), [1, 2, 3])]);
        string[] failing = [.. OrielDatabase.Schema.Take(Before), OrielDatabase.Schema[Before] + ";\nINSERT INTO no_such_table VALUES (1)"];

        Assert.Throws<SqliteException>(() => new StoreSet(DatabasePath, failing).Database.Migrate());

        Assert.Equal([Before.ToString(CultureInfo.InvariantCulture)], Column("SELECT version FROM schema_version"));
        Assert.Equal(["010203"], Column("SELECT hex(data) FROM fonts"));
        Assert.Empty(Column("SELECT name FROM sqlite_master WHERE name LIKE 'font!_%' ESCAPE '!'"));

        var store = new StoreSet(DatabasePath);
        Assert.Equal([1, 2, 3], store.Fonts.GetData(Reader, id)!.Value.Data);
    }

    [Fact]
    public void NoFileIsLeftBehind()
    {
        var store = new StoreSet(DatabasePath);
        store.Fonts.Add(Reader, Face("Charter"), [1], Now);
        store.Fonts.Add(Reader, Face("Charter") with { Weight = 700 }, [2], Now);
        store.Fonts.Add(Reader, Face("Literata"), [3], Now);
        store.Fonts.Add(OtherReader, Face("Charter"), [4], Now);

        Assert.Equal(FontAdded.Added, store.Fonts.Add(Reader, Face("Literata"), [5], Now).Result);
        Assert.Equal(["01", "02", "04", "05"], Files());

        // A file there is no room for leaves the one it would have replaced.
        Assert.Equal(FontAdded.QuotaFull, store.Fonts.Add(Reader, Face("Literata"), new byte[ReadingRules.MaxFontBytes + 1], Now).Result);
        Assert.Equal(["01", "02", "04", "05"], Files());

        Assert.Equal(2, store.Fonts.RemoveFamily(Reader, "Charter"));
        Assert.Equal(["04", "05"], Files());

        Assert.Equal(1, store.Database.DeleteUser(Reader)["fonts"]);
        Assert.Equal(["04"], Files());
        Assert.Equal([4], store.Fonts.GetData(OtherReader, Assert.Single(store.Fonts.List(OtherReader)).Id)!.Value.Data);
    }

    private static FontFile Face(string family) => new("ttf", family, "Regular", 400, false);

    // A store in which the reader has room for one more font, and 95 MB of them.
    private StoreSet Filled()
    {
        var store = new StoreSet(DatabasePath);
        store.Database.RunInTransaction(() =>
        {
            for (var i = 0; i < ReadingRules.MaxFonts - 1; i++)
            {
                Assert.Equal(FontAdded.Added, store.Fonts.Add(Reader, Face($"Family {i}"), new byte[FiveMegabytes], Now).Result);
            }

            return 0;
        });
        return store;
    }

    // One stored file of 5 MB is over 1,200 pages.
    private void AssertReadsNoFile(StoreSet store, Action work)
    {
        var (pages, files) = Reads(store, work);
        Assert.True(pages < 100, $"{pages} pages were read");
        Assert.Empty(files);
    }

    // What the work read, on a connection that has read nothing before: the pages that came through SQLite's
    // cache, which finds a walk along a file's pages to what follows it, and the tables whose data column a
    // statement named, which finds a file read whole, since SQLite reads that past its cache.
    private (int Pages, IReadOnlyList<string> Files) Reads(StoreSet store, Action work)
    {
        Pools.Release(_folder);
        var files = new List<string>();
        strdelegate_authorizer watch = (_, action, table, column, _, _) =>
        {
            if (action == raw.SQLITE_READ && column == "data")
            {
                files.Add(table);
            }

            return raw.SQLITE_OK;
        };
        return store.Database.RunInTransaction(() =>
        {
            using var lent = store.Database.Open();
            using var command = lent.CreateCommand();
            var handle = command.Connection!.Handle!;
            raw.sqlite3_set_authorizer(handle, watch, null);
            raw.sqlite3_db_status(handle, raw.SQLITE_DBSTATUS_CACHE_MISS, out var before, out _, 0);
            try
            {
                work();
            }
            finally
            {
                raw.sqlite3_set_authorizer(handle, (strdelegate_authorizer?)null, null);
            }

            raw.sqlite3_db_status(handle, raw.SQLITE_DBSTATUS_CACHE_MISS, out var after, out _, 0);
            return (after - before, (IReadOnlyList<string>)files);
        });
    }

    private List<string> Files() => Column("SELECT hex(data) FROM font_files ORDER BY data");

    private List<string> Column(string sql)
    {
        using var connection = new SqliteConnection($"Data Source={DatabasePath};Pooling=False");
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        using var reader = command.ExecuteReader();
        var values = new List<string>();
        while (reader.Read())
        {
            values.Add(reader.GetString(0));
        }

        return values;
    }

    // A database as the plugin left it before the files had a table of their own.
    private void WriteBefore(IEnumerable<(Guid Id, Guid User, FontFile Font, byte[] Data)> fonts)
    {
        new OrielDatabase(DatabasePath, OrielDatabase.Schema.Take(Before).ToList()).Migrate();
        using var connection = new SqliteConnection($"Data Source={DatabasePath};Pooling=False");
        connection.Open();
        foreach (var (id, user, font, data) in fonts)
        {
            using var insert = connection.CreateCommand();
            insert.CommandText = "INSERT INTO fonts (id, user_id, family, style, weight, italic, format, data, added_at) VALUES ($id, $user, $family, $style, $weight, $italic, $format, $data, $added)";
            insert.Parameters.AddWithValue("$id", OrielDatabase.Key(id));
            insert.Parameters.AddWithValue("$user", OrielDatabase.Key(user));
            insert.Parameters.AddWithValue("$family", font.Family);
            insert.Parameters.AddWithValue("$style", font.Style);
            insert.Parameters.AddWithValue("$weight", font.Weight);
            insert.Parameters.AddWithValue("$italic", font.Italic ? 1 : 0);
            insert.Parameters.AddWithValue("$format", font.Format);
            insert.Parameters.AddWithValue("$data", data);
            insert.Parameters.AddWithValue("$added", OrielDatabase.Time(Now));
            insert.ExecuteNonQuery();
        }
    }

    private sealed class NoBooks : IBookCatalog
    {
        public BookInfo? Find(Guid userId, Guid itemId) => null;

        public IReadOnlyList<BookInfo> Books(Guid userId) => [];
    }

    private sealed class FakeAuthorization(Guid userId) : IAuthorizationContext
    {
        public Task<AuthorizationInfo> GetAuthorizationInfo(HttpContext requestContext) => Task.FromResult(Info());

        public Task<AuthorizationInfo> GetAuthorizationInfo(HttpRequest requestContext) => Task.FromResult(Info());

        private AuthorizationInfo Info() => new() { User = new User("reader", "provider", "reset") { Id = userId } };
    }
}
