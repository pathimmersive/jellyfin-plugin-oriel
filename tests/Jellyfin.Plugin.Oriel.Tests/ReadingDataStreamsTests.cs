using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Oriel.Configuration;
using Jellyfin.Plugin.Oriel.Controllers;
using Jellyfin.Plugin.Oriel.Data;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Xunit;

namespace Jellyfin.Plugin.Oriel.Tests;

/// <summary>
/// An import is read and an export written as a stream, on a server as well as on their own.
/// </summary>
public sealed class ReadingDataStreamsTests : IDisposable
{
    private const string Cfi = "epubcfi(/6/8!/4/2/1:0)";
    private const long Megabyte = 1024 * 1024;

    private static readonly Guid Reader = Guid.NewGuid();
    private static readonly Guid OtherReader = Guid.NewGuid();
    private static readonly DateTimeOffset Now = new(2026, 11, 24, 12, 0, 0, TimeSpan.Zero);
    private static readonly BookInfo Dune = new(Guid.NewGuid(), "Dune", ["Frank Herbert"], "dune.epub");

    private readonly string _folder = Path.Combine(Path.GetTempPath(), "oriel-streams-" + Guid.NewGuid().ToString("N"));
    private readonly StoreSet _store;

    public ReadingDataStreamsTests()
    {
        _store = new StoreSet(Path.Combine(_folder, "oriel.db"));
    }

    public void Dispose()
    {
        Pools.Release(_folder);
        if (Directory.Exists(_folder))
        {
            Directory.Delete(_folder, recursive: true);
        }
    }

    // The fonts in the file are 100 MB, and each is an array to store: 100 MB an import cannot do without.
    // Held whole, the file's 133 MB and what it grew through made an import of it allocate 561 MB; it
    // now allocates up to 124 MB. One more copy of the fonts would pass the bound.
    [Fact]
    public void ImportsAFullFileOfFontsWithoutHoldingTheFile()
    {
        var body = ReadingFiles.Serialize(new ReadingDataFile(ReadingData.Format, ReadingData.Version, Now, [], Fonts: FullFonts().ToList()));
        Assert.InRange(body.Length, 130 * Megabyte, ReadingDataController.MaxImportBytes);
        var controller = Controller(Reader, new MemoryStream(body));

        var (result, allocated) = Measure(() => controller.Import());

        Assert.True(allocated < 150 * Megabyte, $"importing allocated {allocated / Megabyte} MB");
        Assert.Equal(ReadingRules.MaxFonts, result.Value!.Fonts);
    }

    // Each font is read from the store into an array: 100 MB an export cannot do without, 5 MB of it at a time.
    // Held whole, the file made an export of it allocate 737 MB; it now allocates up to 108 MB.
    // One more copy of the fonts would pass the bound.
    [Fact]
    public void ExportsAFullSetOfFontsWithoutHoldingTheFile()
    {
        AddFullFonts();
        var body = new Counted();
        var controller = Controller(Reader, Stream.Null, body);

        var (_, allocated) = Measure(() => controller.Export());

        Assert.True(allocated < 150 * Megabyte, $"exporting allocated {allocated / Megabyte} MB");
        Assert.InRange(body.Length, 130 * Megabyte, ReadingDataController.MaxImportBytes);
    }

    [Theory]
    [InlineData(' ')]
    [InlineData('x')]
    public async Task ABodyIsReadNoFurtherThanTheLimit(char filler)
    {
        var body = new Endless((byte)filler);

        Assert.Equal("tooLarge", Refused.Reason((await Controller(Reader, body).Import()).Result));
        Assert.InRange(body.Read, ReadingDataController.MaxImportBytes + 1L, ReadingDataController.MaxImportBytes + Megabyte);
    }

    [Fact]
    public async Task ABodyThatSaysItIsPastTheLimitIsNotRead()
    {
        var body = new Endless((byte)' ');
        var controller = Controller(Reader, body);
        controller.Request.ContentLength = ReadingDataController.MaxImportBytes + 1L;

        Assert.Equal("tooLarge", Refused.Reason((await controller.Import()).Result));
        Assert.Equal(0, body.Read);
    }

    [Theory]
    [InlineData(true, ' ')]
    [InlineData(false, ' ')]
    [InlineData(false, 'x')]
    public async Task AServerRefusesABodyPastTheLimitAsTooLarge(bool saysItsLength, char filler)
    {
        // Well past the limit, so that a server's own limit on a body is passed as well.
        await using var server = await Server.Start(Data());
        using var client = new TcpClient();
        await client.ConnectAsync(IPAddress.Loopback, server.Client.BaseAddress!.Port);
        var stream = client.GetStream();
        var length = ReadingDataController.MaxImportBytes + (20 * Megabyte);
        var says = saysItsLength ? $"Content-Length: {length}" : "Transfer-Encoding: chunked";
        await stream.WriteAsync(Encoding.ASCII.GetBytes($"POST /Oriel/Import HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n{says}\r\n\r\n"));
        var sending = Task.Run(async () =>
        {
            var megabyte = Enumerable.Repeat((byte)filler, (int)Megabyte).ToArray();
            for (var sent = 0L; sent < length; sent += Megabyte)
            {
                await stream.WriteAsync(saysItsLength ? [] : "100000\r\n"u8.ToArray());
                await stream.WriteAsync(megabyte);
                await stream.WriteAsync(saysItsLength ? [] : "\r\n"u8.ToArray());
            }
        });

        var answer = new StringBuilder();
        var buffer = new byte[4096];
        while (!answer.ToString().Contains('}', StringComparison.Ordinal) && await stream.ReadAsync(buffer) is var read and > 0)
        {
            answer.Append(Encoding.ASCII.GetString(buffer, 0, read));
        }

        Assert.StartsWith("HTTP/1.1 400 ", answer.ToString(), StringComparison.Ordinal);
        Assert.Contains("{\"reason\":\"tooLarge\"}", answer.ToString(), StringComparison.Ordinal);
        client.Close();
        await Record.ExceptionAsync(() => sending);
    }

    [Theory]
    [InlineData("{\"format\": \"oriel-reading-data\", \"positions\": [", "malformed")]
    [InlineData("not JSON", "malformed")]
    [InlineData("", "malformed")]
    [InlineData("{\"format\": \"oriel-reading-data\", \"version\": 6, \"positions\": []} and more", "malformed")]
    [InlineData("{\"format\": \"something-else\"}", "notAnExport")]
    [InlineData("{\"format\": \"oriel-reading-data\", \"version\": 7, \"positions\": []}", "newerVersion")]
    public async Task AServerRefusesABodyItCannotImportWithItsReason(string body, string reason)
    {
        await using var server = await Server.Start(Data());
        var refused = (HttpStatusCode.BadRequest, $"{{\"reason\":\"{reason}\"}}");

        Assert.Equal(refused, await server.Import(new ByteArrayContent(Encoding.UTF8.GetBytes(body))));
        Assert.Equal(refused, await server.Import(new StreamContent(new OneWay(Encoding.UTF8.GetBytes(body)))));
    }

    [Fact]
    public async Task AnExportFromAServerImportsIntoItUnchanged()
    {
        _store.Positions.Save(Reader, Dune.ItemId, new StoredPosition(Cfi, 0.6, Now));
        _store.Highlights.Add(Reader, Dune.ItemId, Cfi, 0.6, "yellow", "Words & \u2014 \u00e9", Now);
        AddFullFonts();
        await using var server = await Server.Start(Data());

        using var response = await server.Client.GetAsync("Oriel/Export");
        var body = await response.Content.ReadAsByteArrayAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType!.ToString());
        Assert.Equal(
            "attachment; filename=oriel-reading-data-2026-11-24.json; filename*=UTF-8''oriel-reading-data-2026-11-24.json",
            response.Content.Headers.ContentDisposition!.ToString());
        Assert.Equal("no-store", response.Headers.CacheControl!.ToString());
        Assert.True(ExportedBefore().AsSpan().SequenceEqual(body), "the export is not the same bytes as when it was written whole");

        server.Caller = OtherReader;
        var (status, result) = await server.Import(new ByteArrayContent(body));

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Contains("\"imported\":1,\"kept\":0,\"unmatched\":[],\"bookmarks\":0,\"highlights\":1,\"highlighters\":0,\"themes\":0,\"fonts\":20,", result, StringComparison.Ordinal);
        Assert.Equal("Words & \u2014 \u00e9", Assert.Single(_store.Highlights.List(OtherReader, Dune.ItemId)).Text);
        var stored = _store.Fonts.List(OtherReader).ToDictionary(font => font.Font.Family, font => font.Id);
        Assert.All(FullFonts(), font =>
            Assert.True(font!.Data.AsSpan().SequenceEqual(_store.Fonts.GetData(OtherReader, stored[font.Family!])!.Value.Data), $"{font.Family} changed"));
    }

    [Fact]
    public async Task AClientThatStopsSendingStoresNothingAndTheNextImportRuns()
    {
        await using var server = await Server.Start(Data());
        var position = new ExportedPosition(Dune.ItemId.ToString("N"), "Dune", [], null, Cfi, 0.4, Now);
        var body = ReadingFiles.Serialize(new ReadingDataFile(ReadingData.Format, ReadingData.Version, Now, [position], Fonts: FullFonts().Take(1).ToList()));
        using (var client = new TcpClient())
        {
            await client.ConnectAsync(IPAddress.Loopback, server.Client.BaseAddress!.Port);
            var stream = client.GetStream();
            await stream.WriteAsync(Encoding.ASCII.GetBytes(
                $"POST /Oriel/Import HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {body.Length}\r\n\r\n"));
            await stream.WriteAsync(body.AsMemory(0, body.Length / 2));
            await server.Entered(1);
            client.Client.LingerState = new LingerOption(true, 0);
        }

        await server.Left(1);
        Assert.Empty(_store.Positions.ListForUser(Reader));
        Assert.Empty(_store.Fonts.List(Reader));
        Assert.Equal(HttpStatusCode.OK, (await server.Import(new ByteArrayContent(body))).Status);
        Assert.Single(_store.Positions.ListForUser(Reader));
        Assert.Single(_store.Fonts.List(Reader));
    }

    [Fact]
    public async Task AClientThatStopsReadingLeavesTheNextExportAndImportToRun()
    {
        AddFullFonts();
        await using var server = await Server.Start(Data());
        using (var client = new TcpClient { ReceiveBufferSize = 4096 })
        {
            await client.ConnectAsync(IPAddress.Loopback, server.Client.BaseAddress!.Port);
            var stream = client.GetStream();
            await stream.WriteAsync("GET /Oriel/Export HTTP/1.1\r\nHost: localhost\r\n\r\n"u8.ToArray());
            await stream.ReadExactlyAsync(new byte[1024]);
            Assert.Equal(0, server.Done);
            client.Client.LingerState = new LingerOption(true, 0);
        }

        await server.Left(1);
        using var response = await server.Client.GetAsync("Oriel/Export");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsByteArrayAsync();
        server.Caller = OtherReader;
        Assert.Equal(HttpStatusCode.OK, (await server.Import(new ByteArrayContent(body))).Status);
    }

    [Fact]
    public async Task AnExportReadsAFontOnlyWhenItWritesIt()
    {
        AddFullFonts();
        var removed = false;
        var body = new Counted();
        body.Written = () =>
        {
            // Once the first font is written, the last one listed goes.
            if (!removed && body.Length > 4 * Megabyte)
            {
                removed = true;
                _store.Fonts.RemoveFamily(Reader, _store.Fonts.List(Reader)[^1].Font.Family);
            }
        };

        await Controller(Reader, Stream.Null, body).Export();

        Assert.True(removed);
        Assert.InRange(body.Length, 125 * Megabyte, 130 * Megabyte);
    }

    [Fact]
    public async Task AnExportStopsWhenItsCallerHasGone()
    {
        AddFullFonts();
        using var gone = new CancellationTokenSource();
        var body = new Counted { Written = gone.Cancel };
        var controller = Controller(Reader, Stream.Null, body);
        controller.HttpContext.RequestAborted = gone.Token;

        await controller.Export();

        Assert.InRange(body.Length, 1, 10 * Megabyte);
    }

    [Fact]
    public async Task AStoreThatFailsOnceTheDownloadHasBegunEndsTheConnection()
    {
        AddFullFonts();
        await using var server = await Server.Start(Data());
        using var response = await server.Client.GetAsync("Oriel/Export", HttpCompletionOption.ResponseHeadersRead);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using (var connection = _store.Database.Open())
        {
            using var drop = connection.CreateCommand();
            drop.CommandText = "DROP TABLE font_files";
            drop.ExecuteNonQuery();
        }

        await Assert.ThrowsAnyAsync<IOException>(async () =>
        {
            await using var body = await response.Content.ReadAsStreamAsync();
            await body.CopyToAsync(Stream.Null);
        });
    }

    [Fact]
    public void AnAnswerThatHasBegunIsNotTurnedIntoA503()
    {
        static ExceptionContext Failing(bool begun)
        {
            var context = new DefaultHttpContext();
            context.Features.Set<IHttpResponseFeature>(new Begun(begun));
            return new(new ActionContext(context, new RouteData(), new ActionDescriptor()), []) { Exception = new StoreUnavailableException("It cannot be opened.") };
        }

        var before = Failing(begun: false);
        new StoreUnavailableAttribute().OnException(before);
        Assert.True(before.ExceptionHandled);

        var after = Failing(begun: true);
        new StoreUnavailableAttribute().OnException(after);
        Assert.False(after.ExceptionHandled);
        Assert.Null(after.Result);
    }

    [Fact]
    public async Task AStoreThatFailsBeforeTheDownloadBeginsLeavesNoDownloadHeaders()
    {
        var removing = Controller(Reader, Stream.Null, new Counted { Written = () => throw new StoreUnavailableException("It cannot be opened.") });

        await Assert.ThrowsAsync<StoreUnavailableException>(() => removing.Export());

        Assert.Equal(string.Empty, removing.Response.Headers.ContentDisposition.ToString());
    }

    // What the work allocated. All of it runs on this thread, since no stream given to it waits.
    private static (T Result, long Allocated) Measure<T>(Func<Task<T>> work)
    {
        var before = GC.GetAllocatedBytesForCurrentThread();
        var task = work();
        var allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        Assert.True(task.IsCompleted, "the work went to another thread, so what it allocated is not known");
        return (task.GetAwaiter().GetResult(), allocated);
    }

    // As many fonts as a user may have, as large as they may be together.
    private static IEnumerable<ExportedFont?> FullFonts()
    {
        var random = new Random(134);
        for (var i = 0; i < ReadingRules.MaxFonts; i++)
        {
            var small = FontsControllerTests.TrueType($"Family {i}", "Regular", 400, false, 4).Length - 4;
            var data = FontsControllerTests.TrueType($"Family {i}", "Regular", 400, false, (ReadingRules.MaxFontFileBytes - small - 8) / 4 * 4);
            random.NextBytes(data.AsSpan(data.Length - 1024));
            yield return new ExportedFont($"Family {i}", "Regular", 400, false, "ttf", data);
        }
    }

    private static readonly JsonSerializerOptions Indented = new() { WriteIndented = true };

    // The export as it was when it was written whole.
    private byte[] ExportedBefore() => JsonSerializer.SerializeToUtf8Bytes(Data().Export(Reader, Now), Indented);

    private void AddFullFonts()
    {
        foreach (var font in FullFonts())
        {
            Assert.Equal(FontAdded.Added, _store.Fonts.Add(Reader, FontFile.Read(font!.Data)!, font.Data!, Now).Result);
        }
    }

    private ReadingData Data() => new(_store.Database, _store.All, new Catalog(), () => new PluginConfiguration { EnableFontUploads = true });

    private ReadingDataController Controller(Guid caller, Stream request, Stream? response = null)
    {
        var context = new DefaultHttpContext();
        context.Request.Body = request;
        context.Response.Body = response ?? Stream.Null;
        return new(Data(), new Authorization(caller), new FixedTime())
        {
            ControllerContext = new ControllerContext { HttpContext = context },
        };
    }

    // Counts what is written to it and keeps none of it.
    private sealed class Counted : Stream
    {
        private long _length;

        public Action? Written { get; set; }

        public override bool CanRead => false;

        public override bool CanSeek => false;

        public override bool CanWrite => true;

        public override long Length => _length;

        public override long Position { get => _length; set => throw new NotSupportedException(); }

        public override void Write(byte[] buffer, int offset, int count) => Count(count);

        public override void Write(ReadOnlySpan<byte> buffer) => Count(buffer.Length);

        public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Count(count);
            return Task.CompletedTask;
        }

        public override ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Count(buffer.Length);
            return ValueTask.CompletedTask;
        }

        public override Task FlushAsync(CancellationToken cancellationToken) => Task.CompletedTask;

        public override void Flush()
        {
        }

        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();

        private void Count(int written)
        {
            _length += written;
            Written?.Invoke();
        }
    }

    // A body that can only be read forwards and does not say its length.
    private abstract class Body : Stream
    {
        public override bool CanRead => true;

        public override bool CanSeek => false;

        public override bool CanWrite => false;

        public override long Length => throw new NotSupportedException();

        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

        public override int Read(byte[] buffer, int offset, int count) => Fill(buffer.AsSpan(offset, count));

        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) => ValueTask.FromResult(Fill(buffer.Span));

        public override void Flush()
        {
        }

        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();

        protected abstract int Fill(Span<byte> buffer);
    }

    private sealed class OneWay(byte[] bytes) : Body
    {
        private int _at;

        protected override int Fill(Span<byte> buffer)
        {
            var read = Math.Min(buffer.Length, bytes.Length - _at);
            bytes.AsSpan(_at, read).CopyTo(buffer);
            _at += read;
            return read;
        }
    }

    // One byte for ever, counting how much of it was read.
    private sealed class Endless(byte filler) : Body
    {
        public new long Read { get; private set; }

        protected override int Fill(Span<byte> buffer)
        {
            buffer.Fill(filler);
            Read += buffer.Length;
            return buffer.Length;
        }
    }

    // A real server holding the plugin's endpoints, for how a body and a connection really end.
    private sealed class Server : IAsyncDisposable
    {
        private readonly WebApplication _app;
        private int _entered;
        private int _left;

        private Server(ReadingData data)
        {
            var builder = WebApplication.CreateSlimBuilder();
            builder.Logging.ClearProviders();
            builder.WebHost.UseUrls("http://127.0.0.1:0");
            builder.Services.AddSingleton(data);
            builder.Services.AddSingleton<TimeProvider>(new FixedTime());
            builder.Services.AddTransient<IAuthorizationContext>(_ => new Authorization(Caller));
            builder.Services.AddControllers().AddApplicationPart(typeof(ReadingDataController).Assembly);
            _app = builder.Build();
            _app.Use(async (context, next) =>
            {
                Interlocked.Increment(ref _entered);
                try
                {
                    await next(context);
                }
                finally
                {
                    Interlocked.Increment(ref _left);
                }
            });
            _app.MapControllers().AllowAnonymous();
        }

        public Guid Caller { get; set; } = Reader;

        public HttpClient Client { get; } = new();

        // How many requests the endpoints are done with.
        public int Done => Volatile.Read(ref _left);

        public static async Task<Server> Start(ReadingData data)
        {
            var server = new Server(data);
            await server._app.StartAsync();
            server.Client.BaseAddress = new Uri(server._app.Urls.Single());
            return server;
        }

        public Task Entered(int requests) => Until(() => Volatile.Read(ref _entered) >= requests);

        public Task Left(int requests) => Until(() => Done >= requests);

        public async Task<(HttpStatusCode Status, string Body)> Import(HttpContent content)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "Oriel/Import") { Content = content };
            content.Headers.ContentType = new("application/json");
            using var response = await Client.SendAsync(request);
            return (response.StatusCode, await response.Content.ReadAsStringAsync());
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await _app.DisposeAsync();
        }

        private static async Task Until(Func<bool> met)
        {
            for (var i = 0; i < 3000 && !met(); i++)
            {
                await Task.Delay(10);
            }

            Assert.True(met(), "the server did not get there in 30 seconds");
        }
    }

    private sealed class Begun(bool begun) : HttpResponseFeature
    {
        public override bool HasStarted => begun;
    }

    private sealed class Catalog : IBookCatalog
    {
        public BookInfo? Find(Guid userId, Guid itemId) => itemId.Equals(Dune.ItemId) ? Dune : null;

        public IReadOnlyList<BookInfo> Books(Guid userId) => [Dune];
    }

    private sealed class Authorization(Guid userId) : IAuthorizationContext
    {
        public Task<AuthorizationInfo> GetAuthorizationInfo(HttpContext requestContext) => Task.FromResult(Info());

        public Task<AuthorizationInfo> GetAuthorizationInfo(HttpRequest requestContext) => Task.FromResult(Info());

        private AuthorizationInfo Info() => new() { User = new User("reader", "provider", "reset") { Id = userId } };
    }

    private sealed class FixedTime : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => Now;
    }
}
