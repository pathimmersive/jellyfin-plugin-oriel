using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Oriel.Controllers;
using Jellyfin.Plugin.Oriel.Data;
using Jellyfin.Plugin.Oriel.Integration;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Xunit;

namespace Jellyfin.Plugin.Oriel.Tests;

public sealed class LoggingTests : IDisposable
{
    // Strings a reader could put in a request or a file; none of them may reach a log line.
    private const string MarkerCfi = "epubcfi(/6/4!/4/2/1:7)[markercfi]";
    private const string MarkerText = "MARKER-TEXT-a-line-from-the-book";
    private const string MarkerNote = "MARKER-NOTE-a-private-thought";
    private const string MarkerFileName = "MARKER-FILE-secret-diary.epub";
    private const string MarkerTitle = "MARKER-TITLE-My Secret Book";
    private const string MarkerWord = "MARKERWORD";

    private static readonly Guid Reader = Guid.NewGuid();
    private static readonly DateTimeOffset Now = new(2026, 11, 13, 12, 0, 0, TimeSpan.Zero);
    private static readonly BookInfo Book = new(Guid.NewGuid(), MarkerTitle, ["Nobody"], MarkerFileName);

    private readonly string _folder = Path.Combine(Path.GetTempPath(), "oriel-logging-" + Guid.NewGuid().ToString("N"));
    private readonly Recorder _log = new();

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        if (Directory.Exists(_folder))
        {
            Directory.Delete(_folder, recursive: true);
        }
    }

    public static TheoryData<string, LogLevel> Reasons => new()
    {
        { "invalidCfi", LogLevel.Debug },
        { "unknownHighlighter", LogLevel.Debug },
        { "invalidWord", LogLevel.Debug },
        { "malformedRequest", LogLevel.Debug },
        { "notAFont", LogLevel.Warning },
        { "uploadsOff", LogLevel.Warning },
        { "tooLarge", LogLevel.Warning },
        { "notAnExport", LogLevel.Warning },
        { "newerVersion", LogLevel.Warning },
        { "malformed", LogLevel.Warning },
        { "limitReached", LogLevel.Warning },
        { "importRunning", LogLevel.Warning },
    };

    [Theory]
    [MemberData(nameof(Reasons))]
    public void LogsARefusalAtItsLevelWithTheRouteTemplateAndNotThePath(string reason, LogLevel level)
    {
        var context = Refusal(new BadRequestObjectResult(new RequestRefusal(reason)), $"/Oriel/Dictionary?word={MarkerWord}");

        new RefusalsAttribute().OnResultExecuting(context);

        var line = Assert.Single(_log.Lines);
        Assert.Equal(level, line.Level);
        Assert.Contains("Oriel/Dictionary", line.Text, StringComparison.Ordinal);
        Assert.Contains(reason, line.Text, StringComparison.Ordinal);
        Assert.DoesNotContain(MarkerWord, line.Text, StringComparison.Ordinal);
    }

    [Fact]
    public void TurnsTheFrameworksUnreadableBodyRefusalIntoMalformedRequest()
    {
        var context = Refusal(new BadRequestObjectResult(new ValidationProblemDetails()), "/Oriel/Positions/x");

        new RefusalsAttribute().OnResultExecuting(context);

        Assert.Equal("malformedRequest", Refused.Reason(context.Result));
        Assert.Equal(LogLevel.Debug, Assert.Single(_log.Lines).Level);
    }

    [Fact]
    public void LogsNothingForAnAnswerThatIsNotARefusal()
    {
        foreach (var answer in new IActionResult[] { new OkObjectResult(new { cfi = MarkerCfi }), new NotFoundResult(), new UnauthorizedResult(), new NoContentResult() })
        {
            new RefusalsAttribute().OnResultExecuting(Refusal(answer, "/Oriel/Positions/x"));
        }

        Assert.Empty(_log.Lines);
    }

    [Fact]
    public void EveryOrielControllerNamesAndLogsItsRefusals()
    {
        var controllers = typeof(Plugin).Assembly.GetTypes().Where(type => typeof(ControllerBase).IsAssignableFrom(type) && !type.IsAbstract).ToList();

        Assert.NotEmpty(controllers);
        Assert.All(controllers, type => Assert.True(type.IsDefined(typeof(RefusalsAttribute), inherit: true), $"{type.Name} has no [Refusals]"));
    }

    [Fact]
    public async Task LogsAnImportAndAnExportWithCountsAndNoReadersWords()
    {
        var store = new PositionStore(Path.Combine(_folder, "oriel.db"));
        var file = new ReadingDataFile(
            ReadingData.Format,
            ReadingData.Version,
            Now,
            [new ExportedPosition(Book.ItemId.ToString("N"), MarkerTitle, ["Nobody"], MarkerFileName, MarkerCfi, 0.4, Now)],
            [new ExportedBookmark(Book.ItemId.ToString("N"), MarkerTitle, ["Nobody"], MarkerFileName, MarkerCfi + "b", 0.5, MarkerText, Now)],
            [new ExportedHighlight(Book.ItemId.ToString("N"), MarkerTitle, ["Nobody"], MarkerFileName, MarkerCfi + "h", 0.5, "yellow", MarkerText, Now, MarkerNote)]);

        var imported = await Data(store, file).Import();
        Assert.Equal(1, imported.Value!.Imported);
        await Data(store).Export();

        var info = _log.Lines.Where(line => line.Level == LogLevel.Information).Select(line => line.Text).ToList();
        Assert.Contains(info, text => text.Contains($"imported reading data for user {Reader}", StringComparison.Ordinal)
            && text.Contains("1 positions imported", StringComparison.Ordinal) && text.Contains("1 bookmarks, 1 highlights", StringComparison.Ordinal));
        Assert.Contains(info, text => text.Contains($"exported reading data for user {Reader}: 1 positions, 1 bookmarks, 1 highlights", StringComparison.Ordinal));
        AssertNoMarkers();
    }

    [Fact]
    public async Task LogsAnImportThatFailsPartWayAtWarning()
    {
        var store = new PositionStore(Path.Combine(_folder, "oriel.db"));
        var file = new ReadingDataFile(ReadingData.Format, ReadingData.Version, Now, [new ExportedPosition(Book.ItemId.ToString("N"), MarkerTitle, ["Nobody"], MarkerFileName, MarkerCfi, 0.4, Now)]);

        await Assert.ThrowsAsync<IOException>(() => Data(store, file, failing: true).Import());

        var line = Assert.Single(_log.Lines);
        Assert.Equal(LogLevel.Warning, line.Level);
        Assert.Contains("failed part way (IOException) and stored nothing", line.Text, StringComparison.Ordinal);
        AssertNoMarkers();
    }

    [Theory]
    [InlineData("{\"format\": \"something-else\", \"version\": 1, \"positions\": []}", "notAnExport")]
    [InlineData("{\"format\": \"oriel-reading-data\", \"version\": 99, \"positions\": []}", "newerVersion")]
    [InlineData("{\"format\": \"oriel-reading-data\", \"positions\": [", "malformed")]
    [InlineData("{\"format\": \"oriel-reading-data\", \"version\": 6, \"positions\": [{\"cfi\": \"x\", \"fraction\": 7}]}", "malformed")]
    public void SaysWhyAnImportFileIsRefused(string json, string reason)
    {
        Assert.Null(ReadingData.Parse(Encoding.UTF8.GetBytes(json), out var why));
        Assert.Equal(reason, why);
    }

    [Fact]
    public async Task LogsEachMigrationStepOnceAndNothingWhenTheStoreIsCurrent()
    {
        var path = Path.Combine(_folder, "oriel.db");
        await new PositionStoreStartup(new PositionStore(path), _log.For<PositionStoreStartup>()).StartAsync(CancellationToken.None);

        var steps = _log.Lines.Where(line => line.Text.Contains("moved from schema version", StringComparison.Ordinal)).ToList();
        Assert.Equal(PositionStore.Schema.Count, steps.Count);
        Assert.All(steps, line => Assert.Equal(LogLevel.Information, line.Level));
        Assert.Contains(steps, line => line.Text.EndsWith($"from schema version 0 to 1", StringComparison.Ordinal));

        _log.Lines.Clear();
        await new PositionStoreStartup(new PositionStore(path), _log.For<PositionStoreStartup>()).StartAsync(CancellationToken.None);
        Assert.DoesNotContain(_log.Lines, line => line.Text.Contains("moved from schema version", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task LogsAJellyfinWebChangeOnceForEachFileAndContent(bool placeFound)
    {
        var middleware = new WebPageMiddleware(
            context =>
            {
                context.Response.ContentType = "text/html";
                return context.Response.Body.WriteAsync(Encoding.UTF8.GetBytes("<!DOCTYPE html><html><head></head><body></body></html>")).AsTask();
            },
            _log.For<WebPageMiddleware>(),
            () => true,
            () => string.Empty,
            (_, text) => placeFound ? text + "<!-- oriel -->" : null);

        for (var i = 0; i < 3; i++)
        {
            var context = new DefaultHttpContext();
            context.Request.Method = "GET";
            context.Request.Path = "/web/index.html";
            context.Response.Body = new MemoryStream();
            await middleware.InvokeAsync(context);
        }

        var line = Assert.Single(_log.Lines);
        Assert.Equal(placeFound ? LogLevel.Information : LogLevel.Warning, line.Level);
        Assert.Contains("jellyfin-web's Index", line.Text, StringComparison.Ordinal);
    }

    private void AssertNoMarkers()
    {
        foreach (var marker in new[] { MarkerCfi, "markercfi", MarkerText, MarkerNote, MarkerFileName, MarkerTitle, MarkerWord })
        {
            Assert.DoesNotContain(_log.Lines, line => line.Text.Contains(marker, StringComparison.Ordinal));
        }
    }

    private ResultExecutingContext Refusal(IActionResult result, string pathAndQuery)
    {
        var services = new ServiceCollection().AddSingleton<ILoggerFactory>(_log).BuildServiceProvider();
        var http = new DefaultHttpContext { RequestServices = services };
        var parts = pathAndQuery.Split('?', 2);
        http.Request.Path = parts[0];
        http.Request.QueryString = parts.Length > 1 ? new QueryString("?" + parts[1]) : QueryString.Empty;
        var action = new ActionDescriptor { AttributeRouteInfo = new AttributeRouteInfo { Template = "Oriel/Dictionary" } };
        return new ResultExecutingContext(new ActionContext(http, new RouteData(), action), new List<IFilterMetadata>(), result, controller: new object());
    }

    private ReadingDataController Data(PositionStore store, ReadingDataFile? body = null, bool failing = false)
    {
        var context = new DefaultHttpContext();
        context.Request.Body = new MemoryStream(body is null ? [] : ReadingData.Serialize(body));
        var data = new ReadingData(store, new Catalog(failing), () => new Configuration.PluginConfiguration { EnableFontUploads = true });
        return new ReadingDataController(data, new Authorization(), new FixedTime(), _log.For<ReadingDataController>())
        {
            ControllerContext = new ControllerContext { HttpContext = context },
        };
    }

    // Records every log line, from any category, at every level.
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

    private sealed class Catalog(bool failing) : IBookCatalog
    {
        public BookInfo? Find(Guid userId, Guid itemId) => failing ? throw new IOException("The library could not be read.") : itemId == Book.ItemId ? Book : null;

        public IReadOnlyList<BookInfo> Books(Guid userId) => [Book];
    }

    private sealed class Authorization : IAuthorizationContext
    {
        public Task<AuthorizationInfo> GetAuthorizationInfo(HttpContext requestContext) => Task.FromResult(Info());

        public Task<AuthorizationInfo> GetAuthorizationInfo(HttpRequest requestContext) => Task.FromResult(Info());

        private static AuthorizationInfo Info() => new() { User = new User("reader", "provider", "reset") { Id = Reader } };
    }

    private sealed class FixedTime : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => Now;
    }
}
