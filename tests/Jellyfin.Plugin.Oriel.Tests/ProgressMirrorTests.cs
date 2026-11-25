using System;
using System.Collections.Generic;
using System.Reflection;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Oriel.Data;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Dto;
using MediaBrowser.Model.Entities;
using Xunit;

namespace Jellyfin.Plugin.Oriel.Tests;

/// <summary>
/// Jellyfin's copy of a place, against stand-ins for Jellyfin's own services.
/// </summary>
public sealed class ProgressMirrorTests
{
    private static readonly DateTimeOffset SavedAt = new(2026, 11, 24, 14, 0, 0, 123, 456, TimeSpan.FromHours(2));

    private readonly User _user = new("reader", "provider", "reset");
    private readonly Book _book = new() { Id = Guid.NewGuid() };
    private readonly List<object?[]> _saved = [];

    [Theory]
    [InlineData(0, 0)]
    [InlineData(0.6, 6_000_000)]
    [InlineData(0.61234567, 6_123_457)]
    [InlineData(0.00000005, 1)]
    [InlineData(1, 10_000_000)]
    public void WritesTheTicksAndTheStoresTimeAndNothingElse(double fraction, long ticks)
    {
        Mirror().Write(_user.Id, _book.Id, fraction, SavedAt);

        var call = Assert.Single(_saved);
        Assert.Same(_user, call[0]);
        Assert.Same(_book, call[1]);
        var written = Assert.IsType<UpdateUserItemDataDto>(call[2]);
        Assert.Equal(UserDataSaveReason.UpdateUserData, call[3]);
        Assert.Equal(ticks, written.PlaybackPositionTicks);
        Assert.Equal(SavedAt.UtcDateTime, written.LastPlayedDate);
        Assert.Equal(DateTimeKind.Utc, written.LastPlayedDate!.Value.Kind);
        Assert.Null(written.Played);
        Assert.Null(written.PlayCount);
        Assert.Null(written.IsFavorite);
        Assert.Null(written.Likes);
        Assert.Null(written.Rating);
        Assert.Null(written.PlayedPercentage);
        Assert.Null(written.UnplayedItemCount);
    }

    [Fact]
    public void FailsForAUserOrABookJellyfinDoesNotHave()
    {
        Assert.Throws<InvalidOperationException>(() => Mirror().Write(Guid.NewGuid(), _book.Id, 0.5, SavedAt));
        Assert.Throws<InvalidOperationException>(() => Mirror().Write(_user.Id, Guid.NewGuid(), 0.5, SavedAt));
        Assert.Empty(_saved);
    }

    private UserDataMirror Mirror() => new(
        Stand.In<IUserManager>((method, arguments) => method == "GetUserById" && arguments[0] is Guid id && id == _user.Id ? _user : null),
        Stand.In<ILibraryManager>((method, arguments) => method == "GetItemById" && arguments[0] is Guid id && id == _book.Id ? _book : null),
        Stand.In<IUserDataManager>((method, arguments) =>
        {
            Assert.Equal("SaveUserData", method);
            _saved.Add(arguments);
            return null;
        }));

    // A stand-in for an interface, which answers each call by its name and arguments.
    private class Stand : DispatchProxy
    {
        private Func<string, object?[], object?> _answer = (_, _) => null;

        public static T In<T>(Func<string, object?[], object?> answer)
            where T : class
        {
            var proxy = Create<T, Stand>();
            ((Stand)(object)proxy)._answer = answer;
            return proxy;
        }

        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args) => _answer(targetMethod!.Name, args ?? []);
    }
}
