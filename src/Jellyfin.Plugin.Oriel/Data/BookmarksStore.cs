using System;
using System.Collections.Generic;
using Microsoft.Data.Sqlite;

namespace Jellyfin.Plugin.Oriel.Data;

/// <summary>
/// A bookmark as stored: where the page it marks starts, the text it opens with, and when it was made.
/// </summary>
/// <param name="Id">The bookmark's id.</param>
/// <param name="Cfi">The EPUB CFI of the start of the page.</param>
/// <param name="Fraction">How far through the book the page is, from 0 to 1.</param>
/// <param name="Text">The text the page opens with, or its page number in a comic or PDF.</param>
/// <param name="CreatedAt">When the bookmark was made.</param>
public sealed record StoredBookmark(Guid Id, string Cfi, double Fraction, string Text, DateTimeOffset CreatedAt);

/// <summary>
/// Each user's bookmarks, at most one per book and CFI and <see cref="ReadingRules.MaxBookmarks"/> in all.
/// </summary>
public class BookmarksStore
{
    private readonly OrielDatabase _database;

    /// <summary>
    /// Initializes a new instance of the <see cref="BookmarksStore"/> class.
    /// </summary>
    /// <param name="database">The database.</param>
    public BookmarksStore(OrielDatabase database)
    {
        _database = database;
    }

    /// <summary>
    /// Gets a user's bookmarks in a book, in book order.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="itemId">The book.</param>
    /// <returns>The bookmarks, none when the user has made none.</returns>
    public IReadOnlyList<StoredBookmark> List(Guid userId, Guid itemId)
    {
        using var connection = _database.Open();
        using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT id, cfi, fraction, text, created_at FROM bookmarks WHERE user_id = $user AND item_id = $item ORDER BY fraction, created_at";
        command.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
        command.Parameters.AddWithValue("$item", OrielDatabase.Key(itemId));
        using var reader = command.ExecuteReader();
        var bookmarks = new List<StoredBookmark>();
        while (reader.Read())
        {
            bookmarks.Add(Bookmark(reader, 0));
        }

        return bookmarks;
    }

    /// <summary>
    /// Gets all of a user's bookmarks.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <returns>Each bookmark with its book, by book and then in book order.</returns>
    public IReadOnlyList<KeyValuePair<Guid, StoredBookmark>> ListForUser(Guid userId)
    {
        using var connection = _database.Open();
        using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT item_id, id, cfi, fraction, text, created_at FROM bookmarks WHERE user_id = $user ORDER BY item_id, fraction, created_at";
        command.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
        using var reader = command.ExecuteReader();
        var bookmarks = new List<KeyValuePair<Guid, StoredBookmark>>();
        while (reader.Read())
        {
            bookmarks.Add(new(Guid.ParseExact(reader.GetString(0), "N"), Bookmark(reader, 1)));
        }

        return bookmarks;
    }

    /// <summary>
    /// Adds a bookmark to a user's book, unless one is already at the same CFI.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="itemId">The book.</param>
    /// <param name="cfi">The EPUB CFI of the start of the page.</param>
    /// <param name="fraction">How far through the book the page is, from 0 to 1.</param>
    /// <param name="text">The text the page opens with.</param>
    /// <param name="createdAt">When the bookmark was made.</param>
    /// <returns>The bookmark at that CFI, and whether it was added now.</returns>
    /// <exception cref="LimitReachedException">The bookmark is new and the user already has <see cref="ReadingRules.MaxBookmarks"/>.</exception>
    public (StoredBookmark Bookmark, bool Added) Add(Guid userId, Guid itemId, string cfi, double fraction, string text, DateTimeOffset createdAt)
    {
        using var connection = _database.Open();
        using var transaction = connection.BeginTransaction();
        var isNew = !connection.Exists("bookmarks", userId, itemId, cfi);
        if (isNew && connection.Count("bookmarks", userId) >= ReadingRules.MaxBookmarks)
        {
            throw new LimitReachedException("bookmarks");
        }

        int added;
        using (var insert = connection.CreateCommand())
        {
            insert.CommandText =
                """
                INSERT INTO bookmarks (id, user_id, item_id, cfi, fraction, text, created_at)
                VALUES ($id, $user, $item, $cfi, $fraction, $text, $created)
                ON CONFLICT (user_id, item_id, cfi) DO NOTHING
                """;
            insert.Parameters.AddWithValue("$id", OrielDatabase.Key(Guid.NewGuid()));
            insert.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
            insert.Parameters.AddWithValue("$item", OrielDatabase.Key(itemId));
            insert.Parameters.AddWithValue("$cfi", cfi);
            insert.Parameters.AddWithValue("$fraction", fraction);
            insert.Parameters.AddWithValue("$text", text);
            insert.Parameters.AddWithValue("$created", OrielDatabase.Time(createdAt));
            added = insert.ExecuteNonQuery();
        }

        using var read = connection.CreateCommand();
        read.CommandText =
            "SELECT id, cfi, fraction, text, created_at FROM bookmarks WHERE user_id = $user AND item_id = $item AND cfi = $cfi";
        read.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
        read.Parameters.AddWithValue("$item", OrielDatabase.Key(itemId));
        read.Parameters.AddWithValue("$cfi", cfi);
        using var reader = read.ExecuteReader();
        reader.Read();
        var bookmark = Bookmark(reader, 0);
        reader.Close();
        transaction.Commit();
        if (added > 0)
        {
            connection.Added("bookmarks", userId);
        }

        return (bookmark, added > 0);
    }

    /// <summary>
    /// Adds bookmarks to a user's books in one transaction, leaving out any already at the same book and CFI.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="bookmarks">The bookmarks, in the order they are added.</param>
    /// <returns>How many were added, and whether the rest were left out at <see cref="ReadingRules.MaxBookmarks"/>.</returns>
    /// <remarks>The user's bookmarks are counted once, and one insert is reused for every one.</remarks>
    public (int Added, bool Limited) AddMany(Guid userId, IEnumerable<(Guid ItemId, string Cfi, double Fraction, string Text, DateTimeOffset CreatedAt)> bookmarks)
    {
        using var connection = _database.Open();
        using var transaction = connection.BeginTransaction();
        var count = connection.Count("bookmarks", userId);
        using var insert = connection.CreateCommand();
        insert.CommandText =
            """
            INSERT INTO bookmarks (id, user_id, item_id, cfi, fraction, text, created_at)
            VALUES ($id, $user, $item, $cfi, $fraction, $text, $created)
            ON CONFLICT (user_id, item_id, cfi) DO NOTHING
            """;
        var id = insert.Parameters.Add("$id", SqliteType.Text);
        insert.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
        var item = insert.Parameters.Add("$item", SqliteType.Text);
        var cfi = insert.Parameters.Add("$cfi", SqliteType.Text);
        var fraction = insert.Parameters.Add("$fraction", SqliteType.Real);
        var text = insert.Parameters.Add("$text", SqliteType.Text);
        var created = insert.Parameters.Add("$created", SqliteType.Text);
        var added = 0;
        var limited = false;
        foreach (var entry in bookmarks)
        {
            if (count >= ReadingRules.MaxBookmarks)
            {
                // At the limit only one the user already has may pass, and it changes nothing.
                if (connection.Exists("bookmarks", userId, entry.ItemId, entry.Cfi))
                {
                    continue;
                }

                limited = true;
                break;
            }

            id.Value = OrielDatabase.Key(Guid.NewGuid());
            item.Value = OrielDatabase.Key(entry.ItemId);
            cfi.Value = entry.Cfi;
            fraction.Value = entry.Fraction;
            text.Value = entry.Text;
            created.Value = OrielDatabase.Time(entry.CreatedAt);
            var rows = insert.ExecuteNonQuery();
            added += rows;
            count += rows;
        }

        transaction.Commit();
        connection.Added("bookmarks", userId, added);
        return (added, limited);
    }

    /// <summary>
    /// Removes one of a user's bookmarks in a book.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="itemId">The book.</param>
    /// <param name="bookmarkId">The bookmark.</param>
    /// <returns>False when the user has no such bookmark in the book.</returns>
    public bool Remove(Guid userId, Guid itemId, Guid bookmarkId)
    {
        using var connection = _database.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM bookmarks WHERE id = $id AND user_id = $user AND item_id = $item";
        command.Parameters.AddWithValue("$id", OrielDatabase.Key(bookmarkId));
        command.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
        command.Parameters.AddWithValue("$item", OrielDatabase.Key(itemId));
        return command.ExecuteNonQuery() > 0;
    }

    // The id, cfi, fraction, text and created_at columns, starting at `first`.
    private static StoredBookmark Bookmark(SqliteDataReader reader, int first) => new(
        Guid.ParseExact(reader.GetString(first), "N"),
        reader.GetString(first + 1),
        reader.GetDouble(first + 2),
        reader.GetString(first + 3),
        OrielDatabase.Time(reader, first + 4));
}
