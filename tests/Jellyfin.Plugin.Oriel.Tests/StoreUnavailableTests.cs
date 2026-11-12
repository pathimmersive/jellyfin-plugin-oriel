using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Plugin.Oriel.Controllers;
using Jellyfin.Plugin.Oriel.Data;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging;
using Xunit;

namespace Jellyfin.Plugin.Oriel.Tests;

public sealed class StoreUnavailableTests : IDisposable
{
    private static readonly Guid Reader = Guid.NewGuid();
    private static readonly Guid Book = Guid.NewGuid();

    private readonly string _folder = Path.Combine(Path.GetTempPath(), "oriel-unavailable-" + Guid.NewGuid().ToString("N"));

    public StoreUnavailableTests()
    {
        Directory.CreateDirectory(_folder);
    }

    private string DatabasePath => Path.Combine(_folder, "oriel.db");

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        if (Directory.Exists(_folder))
        {
            Directory.Delete(_folder, recursive: true);
        }
    }

    [Fact]
    public async Task StartsPastACorruptFileLeavingItUnchanged()
    {
        var corrupt = Enumerable.Range(0, 4096).Select(i => (byte)(i * 7)).ToArray();
        File.WriteAllBytes(DatabasePath, corrupt);
        var store = new PositionStore(DatabasePath);

        var logged = await Start(store);

        Assert.Contains(logged, entry => entry.Level == LogLevel.Critical && entry.Message.Contains(DatabasePath, StringComparison.Ordinal));
        Assert.Equal(corrupt, File.ReadAllBytes(DatabasePath));
        Assert.Equal([DatabasePath], Directory.GetFiles(_folder));
        Assert.Throws<StoreUnavailableException>(() => store.Get(Reader, Book));
        Assert.Equal(corrupt, File.ReadAllBytes(DatabasePath));
    }

    [Fact]
    public async Task StartsPastAFolderThatCannotBeCreated()
    {
        var blocker = Path.Combine(_folder, "plugin");
        File.WriteAllText(blocker, "a file where the plugin's folder should be");
        var store = new PositionStore(Path.Combine(blocker, "oriel.db"));

        var logged = await Start(store);

        Assert.Contains(logged, entry => entry.Level == LogLevel.Critical);
        Assert.Throws<StoreUnavailableException>(() => store.ListFonts(Reader));
        Assert.Equal("a file where the plugin's folder should be", File.ReadAllText(blocker));
    }

    [Fact]
    public async Task StartsPastADatabaseFromANewerOrielLeavingItUnchangedByteForByte()
    {
        string[] newer = [.. PositionStore.Schema, "CREATE TABLE future (x INTEGER)"];
        new PositionStore(DatabasePath, newer).Migrate();
        SqliteConnection.ClearAllPools();
        var before = File.ReadAllBytes(DatabasePath);
        var store = new PositionStore(DatabasePath);

        var logged = await Start(store);

        Assert.Contains(logged, entry => entry.Level == LogLevel.Critical && entry.Message.Contains("newer than this plugin", StringComparison.Ordinal));
        Assert.Throws<StoreUnavailableException>(() => store.Save(Reader, Book, new StoredPosition("epubcfi(/6/2!/4/2/1:0)", 0.1, DateTimeOffset.UtcNow)));
        SqliteConnection.ClearAllPools();
        Assert.Equal(before, File.ReadAllBytes(DatabasePath));
        Assert.Equal([DatabasePath], Directory.GetFiles(_folder));
    }

    [Fact]
    public async Task OpensOnceTheFileIsFixedWithoutARestart()
    {
        File.WriteAllText(DatabasePath, "not a database, but long enough to look like a header for SQLite to read");
        var store = new PositionStore(DatabasePath);
        await Start(store);
        Assert.Throws<StoreUnavailableException>(() => store.Get(Reader, Book));

        SqliteConnection.ClearAllPools();
        File.Delete(DatabasePath);

        Assert.Null(store.Get(Reader, Book));
    }

    [Fact]
    public async Task LogsTheSchemaVersionWhenTheStoreOpens()
    {
        var logged = await Start(new PositionStore(DatabasePath));

        Assert.DoesNotContain(logged, entry => entry.Level >= LogLevel.Error);
        Assert.Contains(logged, entry => entry.Level == LogLevel.Information && entry.Message.Contains($"schema version {PositionStore.Schema.Count}", StringComparison.Ordinal));
    }

    [Fact]
    public void AnswersAnUnavailableStoreWith503()
    {
        var context = Failed(new StoreUnavailableException());

        new StoreUnavailableAttribute().OnException(context);

        Assert.True(context.ExceptionHandled);
        var result = Assert.IsType<ObjectResult>(context.Result);
        Assert.Equal(StatusCodes.Status503ServiceUnavailable, result.StatusCode);
        Assert.Equal("storeUnavailable", Assert.IsType<StoreUnavailableAttribute.Unavailable>(result.Value).Reason);
    }

    [Fact]
    public void LeavesAnyOtherFailureAlone()
    {
        var context = Failed(new InvalidOperationException());

        new StoreUnavailableAttribute().OnException(context);

        Assert.False(context.ExceptionHandled);
        Assert.Null(context.Result);
    }

    [Fact]
    public void EveryControllerThatUsesTheStoreAnswers503WhileItIsUnavailable()
    {
        var usesStore = typeof(Plugin).Assembly.GetTypes()
            .Where(type => typeof(ControllerBase).IsAssignableFrom(type) && !type.IsAbstract)
            .Where(type => type.GetConstructors().Any(constructor => constructor.GetParameters()
                .Any(parameter => parameter.ParameterType == typeof(PositionStore) || parameter.ParameterType == typeof(ReadingData))))
            .ToList();

        Assert.Equal(8, usesStore.Count);
        Assert.All(usesStore, type => Assert.True(type.IsDefined(typeof(StoreUnavailableAttribute), inherit: true), $"{type.Name} has no [StoreUnavailable]"));
    }

    private static ExceptionContext Failed(Exception exception) =>
        new(new ActionContext(new DefaultHttpContext(), new RouteData(), new ActionDescriptor()), new List<IFilterMetadata>())
        {
            Exception = exception,
        };

    private static async Task<List<(LogLevel Level, string Message)>> Start(PositionStore store)
    {
        var logger = new RecordingLogger();
        var start = new PositionStoreStartup(store, logger).StartAsync(CancellationToken.None);
        await start;
        Assert.True(start.IsCompletedSuccessfully);
        return logger.Entries;
    }

    private sealed class RecordingLogger : ILogger<PositionStoreStartup>
    {
        public List<(LogLevel Level, string Message)> Entries { get; } = [];

        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            Entries.Add((logLevel, formatter(state, exception)));
    }
}
