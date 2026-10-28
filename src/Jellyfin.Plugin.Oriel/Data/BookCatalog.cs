using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Jellyfin.Data.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.Oriel.Data;

/// <summary>
/// What identifies a book apart from its item id, which differs between servers.
/// </summary>
/// <param name="ItemId">The book's item id on this server.</param>
/// <param name="Title">The book's title.</param>
/// <param name="Authors">The book's authors, in the library's order.</param>
/// <param name="FileName">The book file's name, without its folder.</param>
public sealed record BookInfo(Guid ItemId, string Title, IReadOnlyList<string> Authors, string FileName);

/// <summary>
/// The books a user can see.
/// </summary>
public interface IBookCatalog
{
    /// <summary>
    /// Gets a book the user can see.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="itemId">The book.</param>
    /// <returns>The book, or null when it does not exist or the user cannot see it.</returns>
    BookInfo? Find(Guid userId, Guid itemId);

    /// <summary>
    /// Gets every book the user can see.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <returns>The books.</returns>
    IReadOnlyList<BookInfo> Books(Guid userId);
}

/// <summary>
/// Reads books from Jellyfin's library, which applies the user's library access.
/// </summary>
public class LibraryBookCatalog : IBookCatalog
{
    private readonly ILibraryManager _libraryManager;
    private readonly IUserManager _userManager;

    /// <summary>
    /// Initializes a new instance of the <see cref="LibraryBookCatalog"/> class.
    /// </summary>
    /// <param name="libraryManager">The host library manager.</param>
    /// <param name="userManager">The host user manager.</param>
    public LibraryBookCatalog(ILibraryManager libraryManager, IUserManager userManager)
    {
        _libraryManager = libraryManager;
        _userManager = userManager;
    }

    /// <inheritdoc />
    public BookInfo? Find(Guid userId, Guid itemId)
    {
        try
        {
            var item = _libraryManager.GetItemById<BaseItem>(itemId, userId);
            return item is null ? null : Info(item);
        }
        catch (ArgumentException)
        {
            // An unknown user or item reads as no access.
            return null;
        }
    }

    /// <inheritdoc />
    public IReadOnlyList<BookInfo> Books(Guid userId)
    {
        var user = _userManager.GetUserById(userId);
        if (user is null)
        {
            return [];
        }

        var query = new InternalItemsQuery(user) { IncludeItemTypes = [BaseItemKind.Book], Recursive = true };
        return _libraryManager.GetItemList(query).Select(Info).ToList();
    }

    private BookInfo Info(BaseItem item) => new(
        item.Id,
        item.Name ?? string.Empty,
        _libraryManager.GetPeople(item).Where(person => person.Type == PersonKind.Author).Select(person => person.Name).ToList(),
        Path.GetFileName(item.Path ?? string.Empty));
}
