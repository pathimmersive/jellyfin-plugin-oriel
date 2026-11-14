using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Data.Events.Users;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Oriel.Data;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging;
using Xunit;

namespace Jellyfin.Plugin.Oriel.Tests;

public sealed class UserDeletionTests : IDisposable
{
    private const string Cfi = "epubcfi(/6/4!/4/2/1:0)";
    private const string Words = "MARKER-a-line-the-reader-highlighted";

    private static readonly Guid Gone = Guid.NewGuid();
    private static readonly Guid Kept = Guid.NewGuid();
    private static readonly Guid Book = Guid.NewGuid();
    private static readonly DateTimeOffset Now = new(2026, 11, 13, 12, 0, 0, TimeSpan.Zero);

    private readonly string _folder = Path.Combine(Path.GetTempPath(), "oriel-deletion-" + Guid.NewGuid().ToString("N"));
    private readonly PositionStore _store;
    private readonly Recorder _log = new();

    public UserDeletionTests()
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
    public async Task DeletesEverythingADeletedUserHadAndNothingOfAnyoneElse()
    {
        Fill(Gone);
        Fill(Kept);
        var before = Rows(Kept);

        await new UserDeletion(_store, _log.For<UserDeletion>()).OnEvent(new UserDeletedEventArgs(new User("gone", "provider", "reset") { Id = Gone }));

        Assert.All(PositionStore.UserTables, table => Assert.Equal(0, Rows(Gone)[table]));
        Assert.Equal(before, Rows(Kept));
        Assert.All(PositionStore.UserTables, table => Assert.True(before[table] > 0, $"{table} was not filled"));
        var line = Assert.Single(_log.Lines);
        Assert.Equal(LogLevel.Information, line.Level);
        Assert.Contains(Gone.ToString(), line.Text, StringComparison.Ordinal);
        Assert.Contains("deleted in Jellyfin", line.Text, StringComparison.Ordinal);
        Assert.Contains("1 bookmarks", line.Text, StringComparison.Ordinal);
        Assert.DoesNotContain(Words, line.Text, StringComparison.Ordinal);
        Assert.DoesNotContain(Cfi, line.Text, StringComparison.Ordinal);
    }

    [Fact]
    public async Task SweepsAwayTheDataOfUsersJellyfinNoLongerHasAtStartup()
    {
        Fill(Gone);
        Fill(Kept);

        await new PositionStoreStartup(_store, _log.For<PositionStoreStartup>(), () => [Kept, Guid.NewGuid()]).StartAsync(CancellationToken.None);

        Assert.Equal([Kept], _store.UserIds());
        Assert.Contains(_log.Lines, line => line.Level == LogLevel.Information && line.Text.Contains($"user {Gone}, no longer a Jellyfin user", StringComparison.Ordinal));
        Assert.DoesNotContain(_log.Lines, line => line.Text.Contains(Kept.ToString(), StringComparison.Ordinal));
    }

    [Fact]
    public async Task DeletesNothingWhenJellyfinListsNoUsers()
    {
        Fill(Gone);
        Fill(Kept);

        await new PositionStoreStartup(_store, _log.For<PositionStoreStartup>(), () => []).StartAsync(CancellationToken.None);

        Assert.Equal(2, _store.UserIds().Count);
        Assert.Contains(_log.Lines, line => line.Level == LogLevel.Warning && line.Text.Contains("Jellyfin listed no users", StringComparison.Ordinal));
    }

    [Fact]
    public async Task SkipsTheDeletionWithoutThrowingWhileTheStoreIsUnavailable()
    {
        File.WriteAllText(Path.Combine(Directory.CreateDirectory(_folder).FullName, "oriel.db"), "not a database, but long enough to look like a header to SQLite");
        var store = new PositionStore(Path.Combine(_folder, "oriel.db"));

        await new UserDeletion(store, _log.For<UserDeletion>()).OnEvent(new UserDeletedEventArgs(new User("gone", "provider", "reset") { Id = Gone }));
        await new PositionStoreStartup(store, _log.For<PositionStoreStartup>(), () => [Kept]).StartAsync(CancellationToken.None);

        Assert.Contains(_log.Lines, line => line.Level == LogLevel.Warning && line.Text.Contains("its store is unavailable", StringComparison.Ordinal));
    }

    // One row of every kind for a user.
    private void Fill(Guid userId)
    {
        _store.Save(userId, Book, new StoredPosition(Cfi, 0.4, Now));
        _store.AddBookmark(userId, Book, Cfi, 0.4, Words, Now);
        _store.AddHighlight(userId, Book, Cfi, 0.4, "yellow", Words, Now, Words);
        _store.ReplaceHighlighters(userId, [.. PositionStore.BuiltInHighlighters, new HighlighterEntry("mine", "Mine", "#123456")]);
        _store.AddFont(userId, new FontFile("ttf", "Charter", "Regular", 400, false), [1, 2, 3], Now);
        _store.ReplaceThemes(userId, [new ThemeEntry("t1", "Night", Enumerable.Repeat("#101010", 10).ToList())]);
        _store.SaveChoices(userId, new StoredChoices("light", "Default"));
    }

    private Dictionary<string, int> Rows(Guid userId)
    {
        SqliteConnection.ClearAllPools();
        using var connection = new SqliteConnection($"Data Source={Path.Combine(_folder, "oriel.db")}");
        connection.Open();
        return PositionStore.UserTables.ToDictionary(table => table, table =>
        {
            using var count = connection.CreateCommand();
            count.CommandText = $"SELECT COUNT(*) FROM {table} WHERE user_id = $user";
            count.Parameters.AddWithValue("$user", userId.ToString("N"));
            return (int)(long)count.ExecuteScalar()!;
        });
    }

    private sealed class Recorder : ILoggerFactory
    {
        public List<(LogLevel Level, string Text)> Lines { get; } = [];

        public ILogger<T> For<T>() => new Logger<T>(this);

        public ILogger CreateLogger(string categoryName) => new Line(this);

        public void AddProvider(ILoggerProvider provider)
        {
        }

        public void Dispose()
        {
        }

        private sealed class Line(Recorder recorder) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state)
                where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
                recorder.Lines.Add((logLevel, formatter(state, exception)));
        }
    }
}
