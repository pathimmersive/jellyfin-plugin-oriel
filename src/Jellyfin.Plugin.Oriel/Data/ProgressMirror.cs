using System;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Dto;
using MediaBrowser.Model.Entities;

namespace Jellyfin.Plugin.Oriel.Data;

/// <summary>
/// Jellyfin's own copy of a place, which Resume, Continue Reading and the built-in reader use.
/// </summary>
public interface IProgressMirror
{
    /// <summary>
    /// Writes a user's place in a book to Jellyfin.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="itemId">The book.</param>
    /// <param name="fraction">How far through the book the place is, from 0 to 1.</param>
    /// <param name="savedAt">When Oriel saved it.</param>
    void Write(Guid userId, Guid itemId, double fraction, DateTimeOffset savedAt);
}

/// <summary>
/// Writes the place to Jellyfin's user data, as Jellyfin's own endpoint for it does: the ticks and the time,
/// and nothing else.
/// </summary>
public class UserDataMirror : IProgressMirror
{
    // Jellyfin gives every book a runtime of one second, in ticks.
    private const long TicksPerBook = 10_000_000;

    private readonly IUserManager _userManager;
    private readonly ILibraryManager _libraryManager;
    private readonly IUserDataManager _userDataManager;

    /// <summary>
    /// Initializes a new instance of the <see cref="UserDataMirror"/> class.
    /// </summary>
    /// <param name="userManager">The host user manager.</param>
    /// <param name="libraryManager">The host library manager.</param>
    /// <param name="userDataManager">The host user data manager.</param>
    public UserDataMirror(IUserManager userManager, ILibraryManager libraryManager, IUserDataManager userDataManager)
    {
        _userManager = userManager;
        _libraryManager = libraryManager;
        _userDataManager = userDataManager;
    }

    /// <inheritdoc />
    public void Write(Guid userId, Guid itemId, double fraction, DateTimeOffset savedAt)
    {
        var user = _userManager.GetUserById(userId) ?? throw new InvalidOperationException("Jellyfin does not have the user.");
        var item = _libraryManager.GetItemById<BaseItem>(itemId, userId) ?? throw new InvalidOperationException("Jellyfin does not have the book.");
        var place = new UpdateUserItemDataDto
        {
            PlaybackPositionTicks = (long)Math.Round(fraction * TicksPerBook, MidpointRounding.AwayFromZero),
            LastPlayedDate = savedAt.UtcDateTime,
        };
        _userDataManager.SaveUserData(user, item, place, UserDataSaveReason.UpdateUserData);
    }
}
