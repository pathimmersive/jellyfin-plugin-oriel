using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Jellyfin.Plugin.Oriel.Controllers;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Oriel.Data;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Xunit;

namespace Jellyfin.Plugin.Oriel.Tests;

public sealed class PositionsControllerTests : IDisposable
{
    private static readonly Guid Reader = Guid.NewGuid();
    private static readonly Guid Book = Guid.NewGuid();
    private static readonly Guid HiddenBook = Guid.NewGuid();
    private static readonly DateTimeOffset Now = new(2026, 10, 27, 12, 0, 0, TimeSpan.Zero);

    private readonly string _folder = Path.Combine(Path.GetTempPath(), "oriel-api-" + Guid.NewGuid().ToString("N"));
    private readonly StoreSet _store;
    private readonly FakeMirror _mirror = new();
    private readonly Recorder _log = new();

    public PositionsControllerTests()
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

    [Fact]
    public async Task SavesAndReturnsThePositionStampedWithTheServerTime()
    {
        var controller = Controller(Reader);

        var saved = (await controller.PutPosition(Book, new("epubcfi(/6/8!/4/2/1:0)", 0.6))).Value;
        Assert.Equal(new PositionsController.PositionResponse("epubcfi(/6/8!/4/2/1:0)", 0.6, Now), saved);
        var position = (await controller.GetPosition(Book)).Value;

        Assert.Equal(new PositionsController.PositionResponse("epubcfi(/6/8!/4/2/1:0)", 0.6, Now), position);
    }

    [Fact]
    public async Task ReturnsNotFoundWhenNothingIsStored()
    {
        Assert.IsType<NotFoundResult>((await Controller(Reader).GetPosition(Book)).Result);
    }

    [Fact]
    public async Task ReturnsNotFoundForABookTheCallerCannotSee()
    {
        _store.Positions.Save(Reader, HiddenBook, new StoredPosition("epubcfi(/6/8!/4/2/1:0)", 0.6, Now));
        var controller = Controller(Reader);

        Assert.IsType<NotFoundResult>((await controller.GetPosition(HiddenBook)).Result);
        Assert.IsType<NotFoundResult>((await controller.PutPosition(HiddenBook, new("epubcfi(/6/2!/4/2/1:0)", 0.1))).Result);
        Assert.Equal("epubcfi(/6/8!/4/2/1:0)", _store.Positions.Get(Reader, HiddenBook)!.Cfi);
    }

    [Fact]
    public async Task ReturnsUnauthorizedWithoutACaller()
    {
        var controller = Controller(Guid.Empty);

        Assert.IsType<UnauthorizedResult>((await controller.GetPosition(Book)).Result);
        Assert.IsType<UnauthorizedResult>((await controller.PutPosition(Book, new("epubcfi(/6/8!/4/2/1:0)", 0.6))).Result);
    }

    public static TheoryData<string?, double?> MalformedPositions => new()
    {
        { null, 0.5 },
        { string.Empty, 0.5 },
        { new string('a', ReadingRules.MaxCfiLength + 1), 0.5 },
        { "epubcfi(/6/8!/4/2/1:0)", null },
        { "epubcfi(/6/8!/4/2/1:0)", -0.01 },
        { "epubcfi(/6/8!/4/2/1:0)", 1.01 },
        { "epubcfi(/6/8!/4/2/1:0)", double.NaN },
    };

    [Theory]
    [MemberData(nameof(MalformedPositions))]
    public async Task RejectsAMalformedPositionAndStoresNothing(string? cfi, double? fraction)
    {
        var expected = cfi is not { Length: > 0 and <= ReadingRules.MaxCfiLength } ? "invalidCfi" : "invalidFraction";
        Assert.Equal(expected, Refused.Reason((await Controller(Reader).PutPosition(Book, new(cfi, fraction))).Result));
        Assert.Null(_store.Positions.Get(Reader, Book));
    }

    [Fact]
    public async Task AcceptsTheLongestAllowedCfiAndBothEndsOfTheBook()
    {
        var controller = Controller(Reader);

        Assert.NotNull((await controller.PutPosition(Book, new(new string('a', ReadingRules.MaxCfiLength), 0))).Value);
        Assert.NotNull((await controller.PutPosition(Book, new("epubcfi(/6/8!/4/2/1:0)", 1))).Value);
    }

    [Fact]
    public async Task WritesJellyfinsCopyWithTheStoresTimeOnceThePlaceIsStored()
    {
        _mirror.OnWrite = () => Assert.Equal("epubcfi(/6/8!/4/2/1:0)", _store.Positions.Get(Reader, Book)!.Cfi);

        await Controller(Reader).PutPosition(Book, new("epubcfi(/6/8!/4/2/1:0)", 0.6));

        Assert.Equal([(Reader, Book, 0.6, Now)], _mirror.Written);
    }

    [Fact]
    public async Task WritesNoCopyForAPlaceThatIsNotStored()
    {
        await Controller(Reader).PutPosition(Book, new("epubcfi(/6/8!/4/2/1:0)", 1.5));
        await Controller(Reader).PutPosition(HiddenBook, new("epubcfi(/6/8!/4/2/1:0)", 0.5));
        await Controller(Guid.Empty).PutPosition(Book, new("epubcfi(/6/8!/4/2/1:0)", 0.5));
        var unavailable = new StoreSet(Path.Combine(_folder, "oriel.db", "not-a-folder", "oriel.db"));
        Directory.CreateDirectory(_folder);
        File.WriteAllText(Path.Combine(_folder, "oriel.db"), "a file where a folder should be");
        await Assert.ThrowsAsync<StoreUnavailableException>(() => Controller(Reader, unavailable).PutPosition(Book, new("epubcfi(/6/8!/4/2/1:0)", 0.5)));

        Assert.Empty(_mirror.Written);
    }

    [Fact]
    public async Task KeepsThePlaceAndLogsIdsOnlyWhenJellyfinsCopyCannotBeWritten()
    {
        _mirror.OnWrite = () => throw new InvalidOperationException("marker-in-the-error");

        var saved = (await Controller(Reader).PutPosition(Book, new("epubcfi(/6/8!/4/2/1:0)", 0.6))).Value;

        Assert.Equal(Now, saved!.SavedAt);
        Assert.Equal("epubcfi(/6/8!/4/2/1:0)", _store.Positions.Get(Reader, Book)!.Cfi);
        var (level, text) = Assert.Single(_log.Lines);
        Assert.Equal(LogLevel.Warning, level);
        Assert.Contains(Reader.ToString(), text, StringComparison.Ordinal);
        Assert.Contains(Book.ToString(), text, StringComparison.Ordinal);
        Assert.Contains(nameof(InvalidOperationException), text, StringComparison.Ordinal);
        Assert.DoesNotContain("marker", text, StringComparison.Ordinal);
        Assert.DoesNotContain("epubcfi", text, StringComparison.Ordinal);
    }

    private PositionsController Controller(Guid caller, StoreSet? store = null) =>
        new((store ?? _store).Positions, new FakeAuthorization(caller), new FakeItemAccess([Book]), new FixedTime(Now), _mirror, _log)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };

    private sealed class FakeMirror : IProgressMirror
    {
        public List<(Guid User, Guid Item, double Fraction, DateTimeOffset SavedAt)> Written { get; } = [];

        public Action? OnWrite { get; set; }

        public void Write(Guid userId, Guid itemId, double fraction, DateTimeOffset savedAt)
        {
            OnWrite?.Invoke();
            Written.Add((userId, itemId, fraction, savedAt));
        }
    }

    private sealed class Recorder : ILogger<PositionsController>
    {
        public List<(LogLevel Level, string Text)> Lines { get; } = [];

        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            Lines.Add((logLevel, formatter(state, exception) + exception));
    }

    // AuthorizationInfo.UserId comes from its User; no user means an anonymous caller.
    private sealed class FakeAuthorization(Guid userId) : IAuthorizationContext
    {
        public Task<AuthorizationInfo> GetAuthorizationInfo(HttpContext requestContext) => Task.FromResult(Info());

        public Task<AuthorizationInfo> GetAuthorizationInfo(HttpRequest requestContext) => Task.FromResult(Info());

        private AuthorizationInfo Info() => new()
        {
            User = userId.Equals(Guid.Empty) ? null : new User("reader", "provider", "reset") { Id = userId },
        };
    }

    private sealed class FakeItemAccess(HashSet<Guid> visible) : IItemAccess
    {
        public bool CanSee(Guid userId, Guid itemId) => visible.Contains(itemId);
    }

    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
