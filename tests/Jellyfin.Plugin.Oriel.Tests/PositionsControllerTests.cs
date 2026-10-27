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
using Microsoft.Data.Sqlite;
using Xunit;

namespace Jellyfin.Plugin.Oriel.Tests;

public sealed class PositionsControllerTests : IDisposable
{
    private static readonly Guid Reader = Guid.NewGuid();
    private static readonly Guid Book = Guid.NewGuid();
    private static readonly Guid HiddenBook = Guid.NewGuid();
    private static readonly DateTimeOffset Now = new(2026, 10, 27, 12, 0, 0, TimeSpan.Zero);

    private readonly string _folder = Path.Combine(Path.GetTempPath(), "oriel-api-" + Guid.NewGuid().ToString("N"));
    private readonly PositionStore _store;

    public PositionsControllerTests()
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
    public async Task SavesThenReturnsThePositionStampedWithTheServerTime()
    {
        var controller = Controller(Reader);

        Assert.IsType<NoContentResult>(await controller.PutPosition(Book, new("epubcfi(/6/8!/4/2/1:0)", 0.6)));
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
        _store.Save(Reader, HiddenBook, new StoredPosition("epubcfi(/6/8!/4/2/1:0)", 0.6, Now));
        var controller = Controller(Reader);

        Assert.IsType<NotFoundResult>((await controller.GetPosition(HiddenBook)).Result);
        Assert.IsType<NotFoundResult>(await controller.PutPosition(HiddenBook, new("epubcfi(/6/2!/4/2/1:0)", 0.1)));
        Assert.Equal("epubcfi(/6/8!/4/2/1:0)", _store.Get(Reader, HiddenBook)!.Cfi);
    }

    [Fact]
    public async Task ReturnsUnauthorizedWithoutACaller()
    {
        var controller = Controller(Guid.Empty);

        Assert.IsType<UnauthorizedResult>((await controller.GetPosition(Book)).Result);
        Assert.IsType<UnauthorizedResult>(await controller.PutPosition(Book, new("epubcfi(/6/8!/4/2/1:0)", 0.6)));
    }

    public static TheoryData<string?, double?> MalformedPositions => new()
    {
        { null, 0.5 },
        { string.Empty, 0.5 },
        { new string('a', PositionsController.MaxCfiLength + 1), 0.5 },
        { "epubcfi(/6/8!/4/2/1:0)", null },
        { "epubcfi(/6/8!/4/2/1:0)", -0.01 },
        { "epubcfi(/6/8!/4/2/1:0)", 1.01 },
        { "epubcfi(/6/8!/4/2/1:0)", double.NaN },
    };

    [Theory]
    [MemberData(nameof(MalformedPositions))]
    public async Task RejectsAMalformedPositionAndStoresNothing(string? cfi, double? fraction)
    {
        Assert.IsType<BadRequestResult>(await Controller(Reader).PutPosition(Book, new(cfi, fraction)));
        Assert.Null(_store.Get(Reader, Book));
    }

    [Fact]
    public async Task AcceptsTheLongestAllowedCfiAndBothEndsOfTheBook()
    {
        var controller = Controller(Reader);

        Assert.IsType<NoContentResult>(await controller.PutPosition(Book, new(new string('a', PositionsController.MaxCfiLength), 0)));
        Assert.IsType<NoContentResult>(await controller.PutPosition(Book, new("epubcfi(/6/8!/4/2/1:0)", 1)));
    }

    private PositionsController Controller(Guid caller) =>
        new(_store, new FakeAuthorization(caller), new FakeItemAccess([Book]), new FixedTime(Now))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };

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
