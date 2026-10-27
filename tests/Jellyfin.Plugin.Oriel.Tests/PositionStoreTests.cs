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
        var newer = new[] { PositionStore.Schema[0], "ALTER TABLE positions ADD COLUMN note TEXT" };

        Assert.Equal(2, new PositionStore(DatabasePath, newer).Migrate());

        Assert.Equal(2, ReadSchemaVersion());
        Assert.Equal(position, new PositionStore(DatabasePath, newer).Get(Reader, Book));
    }

    [Fact]
    public void RefusesADatabaseFromANewerPlugin()
    {
        new PositionStore(DatabasePath, [PositionStore.Schema[0], "ALTER TABLE positions ADD COLUMN note TEXT"]).Migrate();

        Assert.Throws<InvalidOperationException>(() => new PositionStore(DatabasePath).Migrate());
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
