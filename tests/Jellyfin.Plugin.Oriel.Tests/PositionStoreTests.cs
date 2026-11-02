using System;
using System.IO;
using Jellyfin.Plugin.Oriel.Data;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Jellyfin.Plugin.Oriel.Tests;

public sealed class PositionStoreTests : IDisposable
{
    private static readonly Guid Reader = Guid.NewGuid();
    private static readonly Guid OtherReader = Guid.NewGuid();
    private static readonly Guid Book = Guid.NewGuid();

    private readonly string _folder = Path.Combine(Path.GetTempPath(), "oriel-store-" + Guid.NewGuid().ToString("N"));

    private string DatabasePath => Path.Combine(_folder, "data", "oriel.db");

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        if (Directory.Exists(_folder))
        {
            Directory.Delete(_folder, recursive: true);
        }
    }

    [Fact]
    public void CreatesTheDatabaseAndItsFolderAtTheCurrentSchemaVersion()
    {
        var store = new PositionStore(DatabasePath);

        Assert.Equal(PositionStore.Schema.Count, store.Migrate());
        Assert.True(File.Exists(DatabasePath));
        Assert.Equal(PositionStore.Schema.Count, ReadSchemaVersion());
    }

    [Fact]
    public void ReturnsNothingForABookWithNoPosition()
    {
        Assert.Null(new PositionStore(DatabasePath).Get(Reader, Book));
    }

    [Fact]
    public void ReturnsTheSavedPositionAndReplacesItOnTheNextSave()
    {
        var store = new PositionStore(DatabasePath);
        var first = new StoredPosition("epubcfi(/6/4!/4/2/1:0)", 0.25, new DateTimeOffset(2026, 10, 27, 9, 0, 0, TimeSpan.Zero));
        var second = new StoredPosition("epubcfi(/6/8!/4/2/1:0)", 0.6, new DateTimeOffset(2026, 10, 27, 9, 5, 0, TimeSpan.Zero));

        store.Save(Reader, Book, first);
        Assert.Equal(first, store.Get(Reader, Book));
        store.Save(Reader, Book, second);
        Assert.Equal(second, store.Get(Reader, Book));
    }

    [Fact]
    public void KeepsEachUsersPositionApart()
    {
        var store = new PositionStore(DatabasePath);
        var mine = new StoredPosition("epubcfi(/6/8!/4/2/1:0)", 0.6, DateTimeOffset.UnixEpoch);

        store.Save(Reader, Book, mine);

        Assert.Null(store.Get(OtherReader, Book));
        store.Save(OtherReader, Book, mine with { Cfi = "epubcfi(/6/2!/4/2/1:0)" });
        Assert.Equal(mine, store.Get(Reader, Book));
    }

    [Fact]
    public void KeepsPositionsAcrossStoreInstances()
    {
        var position = new StoredPosition("epubcfi(/6/8!/4/2/1:0)", 0.6, DateTimeOffset.UnixEpoch);
        new PositionStore(DatabasePath).Save(Reader, Book, position);

        Assert.Equal(position, new PositionStore(DatabasePath).Get(Reader, Book));
    }

    [Fact]
    public void MigratesAnOlderSchemaForwardKeepingItsData()
    {
        var position = new StoredPosition("epubcfi(/6/8!/4/2/1:0)", 0.6, DateTimeOffset.UnixEpoch);
        new PositionStore(DatabasePath).Save(Reader, Book, position);
        string[] newer = [.. PositionStore.Schema, "ALTER TABLE positions ADD COLUMN note TEXT"];

        Assert.Equal(PositionStore.Schema.Count + 1, new PositionStore(DatabasePath, newer).Migrate());

        Assert.Equal(PositionStore.Schema.Count + 1, ReadSchemaVersion());
        Assert.Equal(position, new PositionStore(DatabasePath, newer).Get(Reader, Book));
    }

    [Fact]
    public void RefusesADatabaseFromANewerPlugin()
    {
        new PositionStore(DatabasePath, [.. PositionStore.Schema, "ALTER TABLE positions ADD COLUMN note TEXT"]).Migrate();

        Assert.Throws<InvalidOperationException>(() => new PositionStore(DatabasePath).Migrate());
    }

    [Fact]
    public void AddsBookmarksToADatabaseFromBeforeThemKeepingItsPositions()
    {
        var position = new StoredPosition("epubcfi(/6/8!/4/2/1:0)", 0.6, DateTimeOffset.UnixEpoch);
        new PositionStore(DatabasePath, [PositionStore.Schema[0]]).Save(Reader, Book, position);
        var store = new PositionStore(DatabasePath);

        store.AddBookmark(Reader, Book, "epubcfi(/6/8!/4/2/1:0)", 0.6, "Chapter text", DateTimeOffset.UnixEpoch);

        Assert.Equal(position, store.Get(Reader, Book));
        Assert.Single(store.ListBookmarks(Reader, Book));
    }

    [Fact]
    public void ListsBookmarksInBookOrderAndKeepsOnePerPlace()
    {
        var store = new PositionStore(DatabasePath);
        var later = store.AddBookmark(Reader, Book, "epubcfi(/6/10!/4/2/1:0)", 0.7, "Later", DateTimeOffset.UnixEpoch);
        var earlier = store.AddBookmark(Reader, Book, "epubcfi(/6/4!/4/2/1:0)", 0.2, "Earlier", DateTimeOffset.UnixEpoch.AddHours(1));
        var again = store.AddBookmark(Reader, Book, "epubcfi(/6/10!/4/2/1:0)", 0.7, "Later, again", DateTimeOffset.UnixEpoch.AddHours(2));

        Assert.True(later.Added && earlier.Added);
        Assert.False(again.Added);
        Assert.Equal(later.Bookmark, again.Bookmark);
        Assert.Equal([earlier.Bookmark, later.Bookmark], store.ListBookmarks(Reader, Book));
    }

    [Fact]
    public void RemovesOnlyTheUsersOwnBookmark()
    {
        var store = new PositionStore(DatabasePath);
        var mine = store.AddBookmark(Reader, Book, "epubcfi(/6/4!/4/2/1:0)", 0.2, "Mine", DateTimeOffset.UnixEpoch).Bookmark;
        store.AddBookmark(OtherReader, Book, "epubcfi(/6/4!/4/2/1:0)", 0.2, "Theirs", DateTimeOffset.UnixEpoch);

        Assert.False(store.RemoveBookmark(OtherReader, Book, mine.Id));
        Assert.Single(store.ListBookmarks(Reader, Book));
        Assert.True(store.RemoveBookmark(Reader, Book, mine.Id));
        Assert.Empty(store.ListBookmarks(Reader, Book));
        Assert.Single(store.ListBookmarks(OtherReader, Book));
        Assert.False(store.RemoveBookmark(Reader, Book, mine.Id));
    }

    [Fact]
    public void AddsHighlightsToADatabaseFromBeforeThemKeepingItsBookmarks()
    {
        new PositionStore(DatabasePath, [PositionStore.Schema[0], PositionStore.Schema[1]])
            .AddBookmark(Reader, Book, "epubcfi(/6/8!/4/2/1:0)", 0.6, "Chapter text", DateTimeOffset.UnixEpoch);
        var store = new PositionStore(DatabasePath);

        store.AddHighlight(Reader, Book, "epubcfi(/6/8!/4/2,/1:0,/1:7)", 0.6, "yellow", "Chapter", DateTimeOffset.UnixEpoch);

        Assert.Single(store.ListBookmarks(Reader, Book));
        Assert.Single(store.ListHighlights(Reader, Book));
    }

    [Fact]
    public void ListsHighlightsInBookOrderKeepsOnePerPlaceAndRecoloursOnlyTheUsersOwn()
    {
        var store = new PositionStore(DatabasePath);
        var later = store.AddHighlight(Reader, Book, "epubcfi(/6/10!/4/2,/1:0,/1:5)", 0.7, "yellow", "Later", DateTimeOffset.UnixEpoch);
        var earlier = store.AddHighlight(Reader, Book, "epubcfi(/6/4!/4/2,/1:0,/1:7)", 0.2, "green", "Earlier", DateTimeOffset.UnixEpoch.AddHours(1));
        var again = store.AddHighlight(Reader, Book, "epubcfi(/6/10!/4/2,/1:0,/1:5)", 0.7, "pink", "Later, again", DateTimeOffset.UnixEpoch.AddHours(2));

        Assert.True(later.Added && earlier.Added);
        Assert.False(again.Added);
        Assert.Equal(later.Highlight, again.Highlight);
        Assert.Equal([earlier.Highlight, later.Highlight], store.ListHighlights(Reader, Book));

        Assert.Null(store.RecolourHighlight(OtherReader, Book, later.Highlight.Id, "blue"));
        Assert.Equal(later.Highlight with { Colour = "blue" }, store.RecolourHighlight(Reader, Book, later.Highlight.Id, "blue"));
        Assert.Equal("blue", store.ListHighlights(Reader, Book)[1].Colour);
    }

    [Fact]
    public void RemovesOnlyTheUsersOwnHighlight()
    {
        var store = new PositionStore(DatabasePath);
        var mine = store.AddHighlight(Reader, Book, "epubcfi(/6/4!/4/2,/1:0,/1:4)", 0.2, "yellow", "Mine", DateTimeOffset.UnixEpoch).Highlight;
        store.AddHighlight(OtherReader, Book, "epubcfi(/6/4!/4/2,/1:0,/1:4)", 0.2, "pink", "Theirs", DateTimeOffset.UnixEpoch);

        Assert.False(store.RemoveHighlight(OtherReader, Book, mine.Id));
        Assert.True(store.RemoveHighlight(Reader, Book, mine.Id));
        Assert.Empty(store.ListHighlights(Reader, Book));
        Assert.Single(store.ListHighlights(OtherReader, Book));
        Assert.False(store.RemoveHighlight(Reader, Book, mine.Id));
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
