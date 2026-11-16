using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Jellyfin.Plugin.Oriel.Data;
using Xunit;

namespace Jellyfin.Plugin.Oriel.Tests;

/// <summary>
/// Upgrades from databases a real install wrote: each <c>Fixtures/schema-N.db</c> was written by the plugin's
/// own stores at schema N (see <c>Fixtures/make-fixture.sh</c>), beside <c>schema-N.json</c>, every row as
/// read back then. Opened by today's plugin, each must migrate and read back the same.
/// </summary>
public sealed class UpgradeFixtureTests : IDisposable
{
    private static readonly Guid Reader = Guid.Parse("6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b");
    private static readonly Guid OtherReader = Guid.Parse("0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d");
    private static readonly Guid Dune = Guid.Parse("d0e1f2a3-b4c5-4d6e-8f70-81a2b3c4d5e6");
    private static readonly Guid Emma = Guid.Parse("e1f2a3b4-c5d6-4e7f-8091-a2b3c4d5e6f7");
    private static readonly DateTimeOffset Then = new(2026, 11, 15, 9, 30, 0, TimeSpan.Zero);

    private static readonly string FixturesFolder = Path.Combine(AppContext.BaseDirectory, "Fixtures");

    private readonly string _folder = Path.Combine(Path.GetTempPath(), "oriel-fixture-" + Guid.NewGuid().ToString("N"));

    public UpgradeFixtureTests()
    {
        Directory.CreateDirectory(_folder);
    }

    public static TheoryData<string> Fixtures() => new(FixtureNames());

    // The frozen fixtures, oldest schema first.
    private static IEnumerable<string> FixtureNames() =>
        Directory.GetFiles(FixturesFolder, "schema-*.db")
            .Select(path => Path.GetFileNameWithoutExtension(path))
            .OrderBy(name => int.Parse(name["schema-".Length..], System.Globalization.CultureInfo.InvariantCulture));

    public void Dispose()
    {
        Pools.Release(_folder);
        if (Directory.Exists(_folder))
        {
            Directory.Delete(_folder, recursive: true);
        }
    }

    [Theory]
    [MemberData(nameof(Fixtures))]
    public void UpgradesADatabaseARealInstallWroteKeepingEveryRow(string fixture)
    {
        var expected = File.ReadAllText(Path.Combine(FixturesFolder, fixture + ".json"));

        var store = Open(fixture, OrielDatabase.Schema);

        Assert.Equal(OrielDatabase.Schema.Count, store.Database.Migrate());
        Assert.Equal(Normal(expected), Dump(store));
    }

    [Fact]
    public void CatchesAStepThatLosesData()
    {
        // A further step that empties the notes: the comparison must notice it, or it proves nothing.
        var fixture = FixtureNames().Last();
        var expected = File.ReadAllText(Path.Combine(FixturesFolder, fixture + ".json"));

        var store = Open(fixture, [.. OrielDatabase.Schema, "UPDATE highlights SET note = ''"]);

        Assert.NotEqual(Normal(expected), Dump(store));
    }

    /// <summary>
    /// Writes a fixture at today's schema when ORIEL_WRITE_FIXTURE names a folder; otherwise does nothing.
    /// Run by <c>Fixtures/make-fixture.sh</c>, once per released schema.
    /// </summary>
    [Fact]
    public void WritesAFixtureWhenAsked()
    {
        var folder = Environment.GetEnvironmentVariable("ORIEL_WRITE_FIXTURE");
        if (string.IsNullOrEmpty(folder))
        {
            return;
        }

        var name = $"schema-{OrielDatabase.Schema.Count}";
        var path = Path.Combine(folder, name + ".db");
        if (File.Exists(path))
        {
            throw new InvalidOperationException($"{path} exists: a frozen fixture is never written over.");
        }

        var store = new StoreSet(path);
        Fill(store);
        File.WriteAllText(Path.Combine(folder, name + ".json"), Dump(store) + "\n");

        // Closing the last connection writes the log back into the file, so the .db is the whole database.
        Pools.Release(folder);
        Assert.False(File.Exists(path + "-wal"), "the write-ahead log is still beside the fixture");
    }

    // Every kind of row, for two users.
    private static void Fill(StoreSet store)
    {
        var quotes = ReadingRules.BuiltInHighlighters[0].Id;
        store.Positions.Save(Reader, Dune, new StoredPosition("epubcfi(/6/8!/4/2/1:0)", 0.25, Then));
        store.Positions.Save(Reader, Emma, new StoredPosition("epubcfi(/6/12!/4/6/1:40)", 0.6, Then.AddHours(1)));
        store.Bookmarks.Add(Reader, Dune, "epubcfi(/6/8!/4/2/1:0)", 0.25, "A beginning is the time", Then);
        store.Bookmarks.Add(Reader, Dune, "epubcfi(/6/10!/4/4/1:0)", 0.3, "Fear is the mind-killer", Then.AddMinutes(5));
        store.Highlighters.Replace(Reader, [.. ReadingRules.BuiltInHighlighters, new HighlighterEntry("own-1", "Vocabulary", "#2a7ab0")]);
        store.Highlights.Add(Reader, Dune, "epubcfi(/6/8!/4/2,/1:0,/1:22)", 0.25, quotes, "A beginning is the time", Then);
        store.Highlights.Add(Reader, Dune, "epubcfi(/6/10!/4/4,/1:0,/1:22)", 0.3, "own-1", "Fear is the mind-killer", Then.AddMinutes(6), "Said to calm the mind.");
        store.Highlights.Add(Reader, Emma, "epubcfi(/6/12!/4/6,/1:40,/1:70)", 0.6, quotes, "handsome, clever, and rich", Then.AddHours(1), "Opening line.");
        store.Themes.Replace(Reader, [new ThemeEntry("own-theme", "Night Blue", ["#0b1d2a", "#e6eef5", "#9fb3c4", "#4da3ff", "#264a66", "#1c3446", "#10263a", "#e6eef5", "#1f3b52", "#5f7486"])]);
        store.Fonts.Add(Reader, new FontFile("ttf", "Charter", "Regular", 400, false), [0, 1, 0, 0, 1, 2, 3, 4], Then);
        store.Fonts.Add(Reader, new FontFile("woff2", "Charter", "Italic", 400, true), [0x77, 0x4F, 0x46, 0x32, 5, 6, 7, 8], Then.AddMinutes(1));
        store.Choices.Save(Reader, new StoredChoices("own-theme", "own:Charter"));

        store.Positions.Save(OtherReader, Dune, new StoredPosition("epubcfi(/6/14!/4/2/1:0)", 0.4, Then.AddDays(1)));
        store.Bookmarks.Add(OtherReader, Dune, "epubcfi(/6/14!/4/2/1:0)", 0.4, "The spice must flow", Then.AddDays(1));
        store.Highlights.Add(OtherReader, Dune, "epubcfi(/6/14!/4/2,/1:0,/1:19)", 0.4, quotes, "The spice must flow", Then.AddDays(1));
        store.Choices.Save(OtherReader, new StoredChoices("light", "Default"));
    }

    // Copies a fixture to this test's folder and opens it with the steps given.
    private StoreSet Open(string fixture, IReadOnlyList<string> migrations)
    {
        var path = Path.Combine(_folder, "oriel.db");
        File.Copy(Path.Combine(FixturesFolder, fixture + ".db"), path);
        return new StoreSet(path, migrations);
    }

    // Every row the two users have, through the stores, in a fixed order.
    private static string Dump(StoreSet store)
    {
        var users = new JsonObject();
        foreach (var user in new[] { Reader, OtherReader })
        {
            users[user.ToString("N")] = new JsonObject
            {
                ["positions"] = Array(store.Positions.ListForUser(user).OrderBy(row => row.Key).Select(row => new
                {
                    item = row.Key.ToString("N"), row.Value.Cfi, row.Value.Fraction, row.Value.SavedAt,
                })),
                ["bookmarks"] = Array(store.Bookmarks.ListForUser(user).OrderBy(row => row.Value.Id).Select(row => new
                {
                    item = row.Key.ToString("N"), id = row.Value.Id.ToString("N"), row.Value.Cfi, row.Value.Fraction, row.Value.Text, row.Value.CreatedAt,
                })),
                ["highlights"] = Array(store.Highlights.ListForUser(user).OrderBy(row => row.Value.Id).Select(row => new
                {
                    item = row.Key.ToString("N"), id = row.Value.Id.ToString("N"), row.Value.Cfi, row.Value.Fraction, row.Value.Colour, row.Value.Text, row.Value.Note, row.Value.CreatedAt,
                })),
                ["highlighters"] = Array(store.Highlighters.List(user).Select(row => new { row.Id, row.Name, row.Colour, row.BuiltIn, row.Uses })),
                ["themes"] = Array(store.Themes.List(user).Select(row => new { row.Id, row.Name, row.Colours })),
                ["fonts"] = Array(store.Fonts.List(user).OrderBy(row => row.Id).Select(row => new
                {
                    id = row.Id.ToString("N"), row.Font, row.AddedAt, data = Convert.ToBase64String(store.Fonts.GetData(user, row.Id)!.Value.Data),
                })),
                ["choices"] = JsonSerializer.SerializeToNode(store.Choices.Get(user)),
            };
        }

        return users.ToJsonString(new JsonSerializerOptions { WriteIndented = true });
    }

    private static JsonNode Array<T>(IEnumerable<T> rows) => JsonSerializer.SerializeToNode(rows.ToList())!;

    // The JSON as Dump writes it, whatever line endings the file came with.
    private static string Normal(string json) => JsonNode.Parse(json)!.ToJsonString(new JsonSerializerOptions { WriteIndented = true });
}
