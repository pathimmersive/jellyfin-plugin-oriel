using System;
using System.IO;
using System.Linq;
using Jellyfin.Plugin.Oriel.Data;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Jellyfin.Plugin.Oriel.Tests;

public sealed class StoresTests : IDisposable
{
    private static readonly Guid Reader = Guid.NewGuid();
    private static readonly Guid OtherReader = Guid.NewGuid();
    private static readonly Guid Book = Guid.NewGuid();

    private readonly string _folder = Path.Combine(Path.GetTempPath(), "oriel-store-" + Guid.NewGuid().ToString("N"));

    private string DatabasePath => Path.Combine(_folder, "data", "oriel.db");

    public void Dispose()
    {
        Pools.Release(_folder);
        if (Directory.Exists(_folder))
        {
            Directory.Delete(_folder, recursive: true);
        }
    }

    [Fact]
    public void CreatesTheDatabaseAndItsFolderAtTheCurrentSchemaVersion()
    {
        var store = new StoreSet(DatabasePath);

        Assert.Equal(OrielDatabase.Schema.Count, store.Database.Migrate());
        Assert.True(File.Exists(DatabasePath));
        Assert.Equal(OrielDatabase.Schema.Count, ReadSchemaVersion());
    }

    [Fact]
    public void ReturnsNothingForABookWithNoPosition()
    {
        Assert.Null(new StoreSet(DatabasePath).Positions.Get(Reader, Book));
    }

    [Fact]
    public void ReturnsTheSavedPositionAndReplacesItOnTheNextSave()
    {
        var store = new StoreSet(DatabasePath);
        var first = new StoredPosition("epubcfi(/6/4!/4/2/1:0)", 0.25, new DateTimeOffset(2026, 10, 27, 9, 0, 0, TimeSpan.Zero));
        var second = new StoredPosition("epubcfi(/6/8!/4/2/1:0)", 0.6, new DateTimeOffset(2026, 10, 27, 9, 5, 0, TimeSpan.Zero));

        store.Positions.Save(Reader, Book, first);
        Assert.Equal(first, store.Positions.Get(Reader, Book));
        store.Positions.Save(Reader, Book, second);
        Assert.Equal(second, store.Positions.Get(Reader, Book));
    }

    [Fact]
    public void KeepsEachUsersPositionApart()
    {
        var store = new StoreSet(DatabasePath);
        var mine = new StoredPosition("epubcfi(/6/8!/4/2/1:0)", 0.6, DateTimeOffset.UnixEpoch);

        store.Positions.Save(Reader, Book, mine);

        Assert.Null(store.Positions.Get(OtherReader, Book));
        store.Positions.Save(OtherReader, Book, mine with { Cfi = "epubcfi(/6/2!/4/2/1:0)" });
        Assert.Equal(mine, store.Positions.Get(Reader, Book));
    }

    [Fact]
    public void KeepsPositionsAcrossStoreInstances()
    {
        var position = new StoredPosition("epubcfi(/6/8!/4/2/1:0)", 0.6, DateTimeOffset.UnixEpoch);
        new StoreSet(DatabasePath).Positions.Save(Reader, Book, position);

        Assert.Equal(position, new StoreSet(DatabasePath).Positions.Get(Reader, Book));
    }

    [Fact]
    public void MigratesAnOlderSchemaForwardKeepingItsData()
    {
        var position = new StoredPosition("epubcfi(/6/8!/4/2/1:0)", 0.6, DateTimeOffset.UnixEpoch);
        new StoreSet(DatabasePath).Positions.Save(Reader, Book, position);
        string[] newer = [.. OrielDatabase.Schema, "ALTER TABLE positions ADD COLUMN note TEXT"];

        Assert.Equal(OrielDatabase.Schema.Count + 1, new StoreSet(DatabasePath, newer).Database.Migrate());

        Assert.Equal(OrielDatabase.Schema.Count + 1, ReadSchemaVersion());
        Assert.Equal(position, new StoreSet(DatabasePath, newer).Positions.Get(Reader, Book));
    }

    [Fact]
    public void RefusesADatabaseFromANewerPlugin()
    {
        new StoreSet(DatabasePath, [.. OrielDatabase.Schema, "ALTER TABLE positions ADD COLUMN note TEXT"]).Database.Migrate();

        Assert.Throws<InvalidOperationException>(() => new StoreSet(DatabasePath).Database.Migrate());
    }

    [Fact]
    public void AddsBookmarksToADatabaseFromBeforeThemKeepingItsPositions()
    {
        var position = new StoredPosition("epubcfi(/6/8!/4/2/1:0)", 0.6, DateTimeOffset.UnixEpoch);
        new StoreSet(DatabasePath, [OrielDatabase.Schema[0]]).Positions.Save(Reader, Book, position);
        var store = new StoreSet(DatabasePath);

        store.Bookmarks.Add(Reader, Book, "epubcfi(/6/8!/4/2/1:0)", 0.6, "Chapter text", DateTimeOffset.UnixEpoch);

        Assert.Equal(position, store.Positions.Get(Reader, Book));
        Assert.Single(store.Bookmarks.List(Reader, Book));
    }

    [Fact]
    public void ListsBookmarksInBookOrderAndKeepsOnePerPlace()
    {
        var store = new StoreSet(DatabasePath);
        var later = store.Bookmarks.Add(Reader, Book, "epubcfi(/6/10!/4/2/1:0)", 0.7, "Later", DateTimeOffset.UnixEpoch);
        var earlier = store.Bookmarks.Add(Reader, Book, "epubcfi(/6/4!/4/2/1:0)", 0.2, "Earlier", DateTimeOffset.UnixEpoch.AddHours(1));
        var again = store.Bookmarks.Add(Reader, Book, "epubcfi(/6/10!/4/2/1:0)", 0.7, "Later, again", DateTimeOffset.UnixEpoch.AddHours(2));

        Assert.True(later.Added && earlier.Added);
        Assert.False(again.Added);
        Assert.Equal(later.Bookmark, again.Bookmark);
        Assert.Equal([earlier.Bookmark, later.Bookmark], store.Bookmarks.List(Reader, Book));
    }

    [Fact]
    public void RemovesOnlyTheUsersOwnBookmark()
    {
        var store = new StoreSet(DatabasePath);
        var mine = store.Bookmarks.Add(Reader, Book, "epubcfi(/6/4!/4/2/1:0)", 0.2, "Mine", DateTimeOffset.UnixEpoch).Bookmark;
        store.Bookmarks.Add(OtherReader, Book, "epubcfi(/6/4!/4/2/1:0)", 0.2, "Theirs", DateTimeOffset.UnixEpoch);

        Assert.False(store.Bookmarks.Remove(OtherReader, Book, mine.Id));
        Assert.Single(store.Bookmarks.List(Reader, Book));
        Assert.True(store.Bookmarks.Remove(Reader, Book, mine.Id));
        Assert.Empty(store.Bookmarks.List(Reader, Book));
        Assert.Single(store.Bookmarks.List(OtherReader, Book));
        Assert.False(store.Bookmarks.Remove(Reader, Book, mine.Id));
    }

    [Fact]
    public void AddsHighlightsToADatabaseFromBeforeThemKeepingItsBookmarks()
    {
        new StoreSet(DatabasePath, [OrielDatabase.Schema[0], OrielDatabase.Schema[1]])
            .Bookmarks.Add(Reader, Book, "epubcfi(/6/8!/4/2/1:0)", 0.6, "Chapter text", DateTimeOffset.UnixEpoch);
        var store = new StoreSet(DatabasePath);

        store.Highlights.Add(Reader, Book, "epubcfi(/6/8!/4/2,/1:0,/1:7)", 0.6, "yellow", "Chapter", DateTimeOffset.UnixEpoch);

        Assert.Single(store.Bookmarks.List(Reader, Book));
        Assert.Single(store.Highlights.List(Reader, Book));
    }

    [Fact]
    public void ListsHighlightsInBookOrderKeepsOnePerPlaceAndRecoloursOnlyTheUsersOwn()
    {
        var store = new StoreSet(DatabasePath);
        var later = store.Highlights.Add(Reader, Book, "epubcfi(/6/10!/4/2,/1:0,/1:5)", 0.7, "yellow", "Later", DateTimeOffset.UnixEpoch);
        var earlier = store.Highlights.Add(Reader, Book, "epubcfi(/6/4!/4/2,/1:0,/1:7)", 0.2, "green", "Earlier", DateTimeOffset.UnixEpoch.AddHours(1));
        var again = store.Highlights.Add(Reader, Book, "epubcfi(/6/10!/4/2,/1:0,/1:5)", 0.7, "pink", "Later, again", DateTimeOffset.UnixEpoch.AddHours(2));

        Assert.True(later.Added && earlier.Added);
        Assert.False(again.Added);
        Assert.Equal(later.Highlight, again.Highlight);
        Assert.Equal([earlier.Highlight, later.Highlight], store.Highlights.List(Reader, Book));

        Assert.Null(store.Highlights.Update(OtherReader, Book, later.Highlight.Id, "blue", null));
        Assert.Equal(later.Highlight with { Colour = "blue" }, store.Highlights.Update(Reader, Book, later.Highlight.Id, "blue", null));
        Assert.Equal("blue", store.Highlights.List(Reader, Book)[1].Colour);
    }

    [Fact]
    public void AddsNotesToADatabaseFromBeforeThemKeepingItsHighlights()
    {
        // A highlight as the plugin kept it before notes, written as that schema has it.
        new StoreSet(DatabasePath, [.. OrielDatabase.Schema.Take(3)]).Database.Migrate();
        var before = new StoredHighlight(Guid.NewGuid(), "epubcfi(/6/8!/4/2,/1:0,/1:7)", 0.6, "yellow", "Chapter", DateTimeOffset.UnixEpoch);
        using (var connection = new SqliteConnection($"Data Source={DatabasePath};Pooling=False"))
        {
            connection.Open();
            using var insert = connection.CreateCommand();
            insert.CommandText = "INSERT INTO highlights (id, user_id, item_id, cfi, fraction, colour, text, created_at) VALUES ($id, $user, $item, $cfi, 0.6, 'yellow', 'Chapter', $created)";
            insert.Parameters.AddWithValue("$id", before.Id.ToString("N"));
            insert.Parameters.AddWithValue("$user", Reader.ToString("N"));
            insert.Parameters.AddWithValue("$item", Book.ToString("N"));
            insert.Parameters.AddWithValue("$cfi", before.Cfi);
            insert.Parameters.AddWithValue("$created", before.CreatedAt.ToString("O"));
            insert.ExecuteNonQuery();
        }

        var store = new StoreSet(DatabasePath);

        Assert.Equal(before, Assert.Single(store.Highlights.List(Reader, Book)));
        Assert.Equal(before with { Note = "Noted." }, store.Highlights.Update(Reader, Book, before.Id, null, "Noted."));
        Assert.Equal(before with { Note = "Noted." }, Assert.Single(store.Highlights.List(Reader, Book)));
    }

    [Fact]
    public void AddsHighlightersToADatabaseFromBeforeThemKeepingItsHighlights()
    {
        var before = new StoreSet(DatabasePath, [.. OrielDatabase.Schema.Take(4)])
            .Highlights.Add(Reader, Book, "epubcfi(/6/8!/4/2,/1:0,/1:7)", 0.6, "pink", "Chapter", DateTimeOffset.UnixEpoch, "Noted.").Highlight;
        var store = new StoreSet(DatabasePath);

        Assert.Equal(before, Assert.Single(store.Highlights.List(Reader, Book)));
        Assert.Equal(["yellow", "green", "blue", "pink"], store.Highlighters.List(Reader).Select(highlighter => highlighter.Id));
        Assert.Equal(1, store.Highlighters.List(Reader)[3].Uses);
    }

    [Fact]
    public void RemovesOnlyTheUsersOwnHighlight()
    {
        var store = new StoreSet(DatabasePath);
        var mine = store.Highlights.Add(Reader, Book, "epubcfi(/6/4!/4/2,/1:0,/1:4)", 0.2, "yellow", "Mine", DateTimeOffset.UnixEpoch).Highlight;
        store.Highlights.Add(OtherReader, Book, "epubcfi(/6/4!/4/2,/1:0,/1:4)", 0.2, "pink", "Theirs", DateTimeOffset.UnixEpoch);

        Assert.False(store.Highlights.Remove(OtherReader, Book, mine.Id));
        Assert.True(store.Highlights.Remove(Reader, Book, mine.Id));
        Assert.Empty(store.Highlights.List(Reader, Book));
        Assert.Single(store.Highlights.List(OtherReader, Book));
        Assert.False(store.Highlights.Remove(Reader, Book, mine.Id));
    }

    private int ReadSchemaVersion()
    {
        using var connection = new SqliteConnection($"Data Source={DatabasePath};Pooling=False");
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT version FROM schema_version";
        return (int)(long)command.ExecuteScalar()!;
    }
}
