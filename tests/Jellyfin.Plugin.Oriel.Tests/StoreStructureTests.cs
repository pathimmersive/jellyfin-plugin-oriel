using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Jellyfin.Plugin.Oriel.Data;
using MediaBrowser.Controller.Plugins;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Jellyfin.Plugin.Oriel.Tests;

public sealed class StoreStructureTests : IDisposable
{
    private static readonly string[] Stores =
        ["PositionsStore", "BookmarksStore", "HighlightsStore", "HighlightersStore", "FontsStore", "ThemesStore", "ChoicesStore"];

    // The schema as it stood when the store was split; the split changed no table.
    private static readonly string[] SchemaAtTheSplit =
    [
        "CREATE TABLE positions (\n    user_id TEXT NOT NULL,\n    item_id TEXT NOT NULL,\n    cfi TEXT NOT NULL,\n    fraction REAL NOT NULL,\n    saved_at TEXT NOT NULL,\n    PRIMARY KEY (user_id, item_id)\n)",
        "CREATE TABLE bookmarks (\n    id TEXT NOT NULL PRIMARY KEY,\n    user_id TEXT NOT NULL,\n    item_id TEXT NOT NULL,\n    cfi TEXT NOT NULL,\n    fraction REAL NOT NULL,\n    text TEXT NOT NULL,\n    created_at TEXT NOT NULL,\n    UNIQUE (user_id, item_id, cfi)\n)",
        "CREATE TABLE highlights (\n    id TEXT NOT NULL PRIMARY KEY,\n    user_id TEXT NOT NULL,\n    item_id TEXT NOT NULL,\n    cfi TEXT NOT NULL,\n    fraction REAL NOT NULL,\n    colour TEXT NOT NULL,\n    text TEXT NOT NULL,\n    created_at TEXT NOT NULL,\n    UNIQUE (user_id, item_id, cfi)\n)",
        "ALTER TABLE highlights ADD COLUMN note TEXT NOT NULL DEFAULT ''",
        "CREATE TABLE highlighters (\n    user_id TEXT NOT NULL,\n    id TEXT NOT NULL,\n    name TEXT NOT NULL,\n    colour TEXT NOT NULL,\n    position INTEGER NOT NULL,\n    PRIMARY KEY (user_id, id)\n)",
        "CREATE TABLE fonts (\n    id TEXT NOT NULL PRIMARY KEY,\n    user_id TEXT NOT NULL,\n    family TEXT NOT NULL,\n    style TEXT NOT NULL,\n    weight INTEGER NOT NULL,\n    italic INTEGER NOT NULL,\n    format TEXT NOT NULL,\n    data BLOB NOT NULL,\n    added_at TEXT NOT NULL,\n    UNIQUE (user_id, family, weight, italic)\n)",
        "CREATE TABLE themes (\n    user_id TEXT NOT NULL,\n    id TEXT NOT NULL,\n    name TEXT NOT NULL,\n    colours TEXT NOT NULL,\n    position INTEGER NOT NULL,\n    PRIMARY KEY (user_id, id)\n)",
        "CREATE TABLE choices (\n    user_id TEXT NOT NULL PRIMARY KEY,\n    theme TEXT NOT NULL,\n    font TEXT NOT NULL\n)",
    ];

    private static readonly Guid Reader = Guid.Parse("11111111111111111111111111111111");
    private static readonly Guid Book = Guid.Parse("22222222222222222222222222222222");

    private readonly string _folder = Path.Combine(Path.GetTempPath(), "oriel-structure-" + Guid.NewGuid().ToString("N"));

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
    public void ADatabaseClassAndSevenStoresReplacePositionStore()
    {
        var assembly = typeof(Plugin).Assembly;
        Assert.Null(assembly.GetType("Jellyfin.Plugin.Oriel.Data.PositionStore"));
        Assert.NotNull(assembly.GetType("Jellyfin.Plugin.Oriel.Data.OrielDatabase"));
        Assert.NotNull(assembly.GetType("Jellyfin.Plugin.Oriel.Data.ReadingRules"));
        Assert.All(Stores, store => Assert.NotNull(assembly.GetType("Jellyfin.Plugin.Oriel.Data." + store)));
    }

    [Fact]
    public void TheDatabaseAndEachStoreAreRegisteredForInjection()
    {
        var services = new ServiceCollection();
        new PluginServiceRegistrator().RegisterServices(services, null!);

        var registered = services.Where(service => service.Lifetime == ServiceLifetime.Singleton).Select(service => service.ServiceType.Name).ToHashSet();
        Assert.All([.. Stores, "OrielDatabase", "ReadingStores", "ReadingData"], name => Assert.Contains(name, registered));
    }

    [Fact]
    public void NothingInTheDataLayerRefersToTheControllers()
    {
        var data = Path.Combine(SourceRoot(), "src", "Jellyfin.Plugin.Oriel", "Data");
        var offenders = Directory.GetFiles(data, "*.cs")
            .Where(file => File.ReadAllText(file).Contains("Controllers", StringComparison.Ordinal))
            .Select(Path.GetFileName)
            .ToList();
        Assert.Empty(offenders);
    }

    [Fact]
    public void EachControllerIsGivenOnlyTheStoresItUses()
    {
        var controllers = typeof(Plugin).Assembly.GetTypes()
            .Where(type => typeof(ControllerBase).IsAssignableFrom(type) && !type.IsAbstract);
        var given = controllers.ToDictionary(
            type => type.Name,
            type => type.GetConstructors().SelectMany(constructor => constructor.GetParameters()).Select(parameter => parameter.ParameterType).ToHashSet());

        Assert.All(given.Values, types => Assert.DoesNotContain(typeof(OrielDatabase), types));
        Assert.All(given.Values, types => Assert.DoesNotContain(typeof(ReadingStores), types));
        Assert.Equal([typeof(PositionsStore)], Kinds(given["PositionsController"]));
        Assert.Equal([typeof(BookmarksStore)], Kinds(given["BookmarksController"]));
        Assert.Equal([typeof(HighlightersStore), typeof(HighlightsStore)], Kinds(given["HighlightsController"]));
        Assert.Equal([typeof(HighlightersStore)], Kinds(given["HighlightersController"]));
        Assert.Equal([typeof(FontsStore)], Kinds(given["FontsController"]));
        Assert.Equal([typeof(ThemesStore)], Kinds(given["ThemesController"]));
        Assert.Equal([typeof(ChoicesStore), typeof(FontsStore), typeof(ThemesStore)], Kinds(given["ChoicesController"]));
    }

    [Fact]
    public void TheDatabaseRunsInWalModeAndWaitsFiveSecondsForALock()
    {
        var database = new OrielDatabase(DatabasePath);
        database.Migrate();

        using var connection = database.OpenConnection();
        Assert.Equal("wal", Pragma(connection, "journal_mode"));
        Assert.Equal("5000", Pragma(connection, "busy_timeout"));
    }

    [Fact]
    public async Task EightWritersForOneUserAllSucceed()
    {
        var stores = new StoreSet(DatabasePath);
        stores.Database.Migrate();
        var own = new HighlighterEntry("mine", "Mine", "#123456");

        var writers = Enumerable.Range(0, 8).Select(writer => Task.Run(() =>
        {
            var written = new List<string>();
            for (var round = 0; round < 25; round++)
            {
                var cfi = $"epubcfi(/6/{(writer * 100) + round})";
                switch (writer % 4)
                {
                    case 0:
                        stores.Positions.Save(Reader, Guid.NewGuid(), new StoredPosition(cfi, 0.5, DateTimeOffset.UnixEpoch));
                        break;
                    case 1:
                        stores.Bookmarks.Add(Reader, Book, cfi, 0.5, "Page", DateTimeOffset.UnixEpoch);
                        break;
                    case 2:
                        stores.Highlights.Add(Reader, Book, cfi, 0.5, round % 2 == 0 ? "mine" : "pink", "Words", DateTimeOffset.UnixEpoch);
                        break;
                    default:
                        stores.Highlighters.Replace(Reader, round % 2 == 0 ? [.. ReadingRules.BuiltInHighlighters, own] : ReadingRules.BuiltInHighlighters);
                        break;
                }

                written.Add(cfi);
            }

            return (writer, written);
        })).ToList();

        var results = await Task.WhenAll(writers);

        var bookmarks = stores.Bookmarks.List(Reader, Book).Select(bookmark => bookmark.Cfi).ToHashSet();
        var highlights = stores.Highlights.List(Reader, Book).Select(highlight => highlight.Cfi).ToHashSet();
        Assert.Equal(50, stores.Positions.ListForUser(Reader).Count);
        Assert.All(results.Where(result => result.writer % 4 == 1).SelectMany(result => result.written), cfi => Assert.Contains(cfi, bookmarks));
        Assert.All(results.Where(result => result.writer % 4 == 2).SelectMany(result => result.written), cfi => Assert.Contains(cfi, highlights));
        Assert.Equal(50, highlights.Count);
    }

    [Fact]
    public void ADatabaseWrittenBeforeTheSplitMigratesFromItsOwnStepsAndReadsTheSame()
    {
        Assert.Equal(SchemaAtTheSplit, OrielDatabase.Schema.Take(SchemaAtTheSplit.Length).Select(step => step.ReplaceLineEndings("\n")));

        Directory.CreateDirectory(_folder);
        using (var connection = new SqliteConnection($"Data Source={DatabasePath};Pooling=False"))
        {
            connection.Open();
            foreach (var sql in SchemaAtTheSplit.Append("CREATE TABLE schema_version (version INTEGER NOT NULL)").Append($"INSERT INTO schema_version (version) VALUES ({SchemaAtTheSplit.Length})")
                .Append("INSERT INTO positions VALUES ('11111111111111111111111111111111', '22222222222222222222222222222222', 'epubcfi(/6/4)', 0.25, '2026-11-14T09:00:00.0000000+00:00')")
                .Append("INSERT INTO bookmarks VALUES ('33333333333333333333333333333333', '11111111111111111111111111111111', '22222222222222222222222222222222', 'epubcfi(/6/4)', 0.25, 'It was a bright cold day', '2026-11-14T09:00:00.0000000+00:00')")
                .Append("INSERT INTO highlights VALUES ('44444444444444444444444444444444', '11111111111111111111111111111111', '22222222222222222222222222222222', 'epubcfi(/6/4,/1:0,/1:9)', 0.25, 'mine', 'It was a', '2026-11-14T09:00:00.0000000+00:00', 'a note')")
                .Append("INSERT INTO highlighters VALUES ('11111111111111111111111111111111', 'mine', 'Mine', '#123456', 0)")
                .Append("INSERT INTO fonts VALUES ('55555555555555555555555555555555', '11111111111111111111111111111111', 'Charter', 'Regular', 400, 0, 'ttf', x'010203', '2026-11-14T09:00:00.0000000+00:00')")
                .Append("INSERT INTO themes VALUES ('11111111111111111111111111111111', 't1', 'Night', '#101010 #101010 #101010 #101010 #101010 #101010 #101010 #101010 #101010 #101010', 0)")
                .Append("INSERT INTO choices VALUES ('11111111111111111111111111111111', 'own:t1', 'own:Charter')"))
            {
                using var command = connection.CreateCommand();
                command.CommandText = sql;
                command.ExecuteNonQuery();
            }
        }

        var stores = new StoreSet(DatabasePath);
        var steps = 0;
        Assert.Equal(OrielDatabase.Schema.Count, stores.Database.Migrate((_, _) => steps++));
        Assert.Equal(OrielDatabase.Schema.Count - SchemaAtTheSplit.Length, steps);

        var at = new DateTimeOffset(2026, 11, 14, 9, 0, 0, TimeSpan.Zero);
        Assert.Equal(new StoredPosition("epubcfi(/6/4)", 0.25, at), stores.Positions.Get(Reader, Book));
        Assert.Equal(new StoredBookmark(Guid.Parse("33333333333333333333333333333333"), "epubcfi(/6/4)", 0.25, "It was a bright cold day", at), Assert.Single(stores.Bookmarks.List(Reader, Book)));
        Assert.Equal(new StoredHighlight(Guid.Parse("44444444444444444444444444444444"), "epubcfi(/6/4,/1:0,/1:9)", 0.25, "mine", "It was a", at, "a note"), Assert.Single(stores.Highlights.List(Reader, Book)));
        Assert.Equal(new StoredHighlighter("mine", "Mine", "#123456", false, 1), Assert.Single(stores.Highlighters.List(Reader)));
        Assert.Equal(new StoredFont(Guid.Parse("55555555555555555555555555555555"), new FontFile("ttf", "Charter", "Regular", 400, false), at), Assert.Single(stores.Fonts.List(Reader)));
        Assert.Equal([1, 2, 3], stores.Fonts.GetData(Reader, Guid.Parse("55555555555555555555555555555555"))!.Value.Data);
        var theme = Assert.Single(stores.Themes.List(Reader));
        Assert.Equal(("t1", "Night"), (theme.Id, theme.Name));
        Assert.Equal(Enumerable.Repeat("#101010", 10), theme.Colours);
        Assert.Equal(new StoredChoices("own:t1", "own:Charter"), stores.Choices.Get(Reader));
    }

    // The store types among a constructor's parameters, by name.
    private static List<Type> Kinds(HashSet<Type> types) =>
        types.Where(type => type.Name.EndsWith("Store", StringComparison.Ordinal) && type.Namespace == typeof(OrielDatabase).Namespace).OrderBy(type => type.Name, StringComparer.Ordinal).ToList();

    private static string Pragma(SqliteConnection connection, string name)
    {
        using var command = connection.CreateCommand();
        command.CommandText = $"PRAGMA {name}";
        return Convert.ToString(command.ExecuteScalar(), System.Globalization.CultureInfo.InvariantCulture)!;
    }

    // The repository root: the nearest folder above the test binaries holding src/Jellyfin.Plugin.Oriel.
    private static string SourceRoot()
    {
        for (var folder = new DirectoryInfo(AppContext.BaseDirectory); folder is not null; folder = folder.Parent)
        {
            if (Directory.Exists(Path.Combine(folder.FullName, "src", "Jellyfin.Plugin.Oriel")))
            {
                return folder.FullName;
            }
        }

        throw new InvalidOperationException("The repository root was not found above " + AppContext.BaseDirectory);
    }
}
