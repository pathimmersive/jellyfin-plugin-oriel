using System;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.Oriel.Data;

/// <summary>
/// Whether a user can see a library item.
/// </summary>
public interface IItemAccess
{
    /// <summary>
    /// Gets a value indicating whether <paramref name="userId"/> can see <paramref name="itemId"/>.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="itemId">The item.</param>
    /// <returns>True when the item exists and the user has access to it.</returns>
    bool CanSee(Guid userId, Guid itemId);
}

/// <summary>
/// Asks Jellyfin's library, which applies the same access rules as <c>/Items/{id}/Download</c>.
/// </summary>
public class LibraryItemAccess : IItemAccess
{
    private readonly ILibraryManager _libraryManager;

    /// <summary>
    /// Initializes a new instance of the <see cref="LibraryItemAccess"/> class.
    /// </summary>
    /// <param name="libraryManager">The host library manager.</param>
    public LibraryItemAccess(ILibraryManager libraryManager)
    {
        _libraryManager = libraryManager;
    }

    /// <inheritdoc />
    public bool CanSee(Guid userId, Guid itemId)
    {
        try
        {
            return _libraryManager.GetItemById<BaseItem>(itemId, userId) is not null;
        }
        catch (ArgumentException)
        {
            // An unknown user or item reads as no access.
            return false;
        }
    }
}
