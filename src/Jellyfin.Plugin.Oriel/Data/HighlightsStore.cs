using System;
using System.Collections.Generic;
using Microsoft.Data.Sqlite;

namespace Jellyfin.Plugin.Oriel.Data;

/// <summary>
/// A highlight as stored: the text it covers, its highlighter, its note, and when it was made.
/// </summary>
/// <param name="Id">The highlight's id.</param>
/// <param name="Cfi">The EPUB range CFI of the highlighted text.</param>
/// <param name="Fraction">How far through the book the page it was made on is, from 0 to 1.</param>
/// <param name="Colour">Its highlighter's colour.</param>
/// <param name="Text">The highlighted text.</param>
/// <param name="CreatedAt">When the highlight was made.</param>
/// <param name="Note">The reader's note on it; empty for none.</param>
public sealed record StoredHighlight(Guid Id, string Cfi, double Fraction, string Colour, string Text, DateTimeOffset CreatedAt, string Note = "");

/// <summary>
/// Each user's highlights with their notes, at most one per book and CFI and <see cref="ReadingRules.MaxHighlights"/> in all.
/// </summary>
public class HighlightsStore
{
    private readonly OrielDatabase _database;

    /// <summary>
    /// Initializes a new instance of the <see cref="HighlightsStore"/> class.
    /// </summary>
    /// <param name="database">The database.</param>
    public HighlightsStore(OrielDatabase database)
    {
        _database = database;
    }

    /// <summary>
    /// Gets a user's highlights in a book, in book order.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="itemId">The book.</param>
    /// <returns>The highlights, none when the user has made none.</returns>
    public IReadOnlyList<StoredHighlight> List(Guid userId, Guid itemId)
    {
        using var connection = _database.Open();
        using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT id, cfi, fraction, colour, text, created_at, note FROM highlights WHERE user_id = $user AND item_id = $item ORDER BY fraction, created_at";
        command.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
        command.Parameters.AddWithValue("$item", OrielDatabase.Key(itemId));
        using var reader = command.ExecuteReader();
        var highlights = new List<StoredHighlight>();
        while (reader.Read())
        {
            highlights.Add(Highlight(reader, 0));
        }

        return highlights;
    }

    /// <summary>
    /// Gets all of a user's highlights.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <returns>Each highlight with its book, by book and then in book order.</returns>
    public IReadOnlyList<KeyValuePair<Guid, StoredHighlight>> ListForUser(Guid userId)
    {
        using var connection = _database.Open();
        using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT item_id, id, cfi, fraction, colour, text, created_at, note FROM highlights WHERE user_id = $user ORDER BY item_id, fraction, created_at";
        command.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
        using var reader = command.ExecuteReader();
        var highlights = new List<KeyValuePair<Guid, StoredHighlight>>();
        while (reader.Read())
        {
            highlights.Add(new(Guid.ParseExact(reader.GetString(0), "N"), Highlight(reader, 1)));
        }

        return highlights;
    }

    /// <summary>
    /// Adds a highlight to a user's book, unless one is already at the same CFI.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="itemId">The book.</param>
    /// <param name="cfi">The EPUB range CFI of the highlighted text.</param>
    /// <param name="fraction">How far through the book the page it was made on is, from 0 to 1.</param>
    /// <param name="colour">Its highlighter's colour.</param>
    /// <param name="text">The highlighted text.</param>
    /// <param name="createdAt">When the highlight was made.</param>
    /// <param name="note">The reader's note on it; empty for none.</param>
    /// <returns>The highlight at that CFI, and whether it was added now.</returns>
    /// <exception cref="LimitReachedException">The highlight is new and the user already has <see cref="ReadingRules.MaxHighlights"/>.</exception>
    public (StoredHighlight Highlight, bool Added) Add(Guid userId, Guid itemId, string cfi, double fraction, string colour, string text, DateTimeOffset createdAt, string note = "")
    {
        using var connection = _database.Open();
        using var transaction = connection.BeginTransaction();
        var isNew = !connection.Exists("highlights", userId, itemId, cfi);
        if (isNew && connection.Count("highlights", userId) >= ReadingRules.MaxHighlights)
        {
            throw new LimitReachedException("highlights");
        }

        int added;
        using (var insert = connection.CreateCommand())
        {
            insert.CommandText =
                """
                INSERT INTO highlights (id, user_id, item_id, cfi, fraction, colour, text, created_at, note)
                VALUES ($id, $user, $item, $cfi, $fraction, $colour, $text, $created, $note)
                ON CONFLICT (user_id, item_id, cfi) DO NOTHING
                """;
            insert.Parameters.AddWithValue("$id", OrielDatabase.Key(Guid.NewGuid()));
            insert.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
            insert.Parameters.AddWithValue("$item", OrielDatabase.Key(itemId));
            insert.Parameters.AddWithValue("$cfi", cfi);
            insert.Parameters.AddWithValue("$fraction", fraction);
            insert.Parameters.AddWithValue("$colour", colour);
            insert.Parameters.AddWithValue("$text", text);
            insert.Parameters.AddWithValue("$created", OrielDatabase.Time(createdAt));
            insert.Parameters.AddWithValue("$note", note);
            added = insert.ExecuteNonQuery();
        }

        using var read = connection.CreateCommand();
        read.CommandText =
            "SELECT id, cfi, fraction, colour, text, created_at, note FROM highlights WHERE user_id = $user AND item_id = $item AND cfi = $cfi";
        read.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
        read.Parameters.AddWithValue("$item", OrielDatabase.Key(itemId));
        read.Parameters.AddWithValue("$cfi", cfi);
        using var reader = read.ExecuteReader();
        reader.Read();
        var highlight = Highlight(reader, 0);
        reader.Close();
        transaction.Commit();
        if (added > 0)
        {
            connection.Added("highlights", userId);
        }

        return (highlight, added > 0);
    }

    /// <summary>
    /// Adds highlights to a user's books in one transaction, leaving out any already at the same book and CFI.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="highlights">The highlights, in the order they are added.</param>
    /// <returns>How many were added, and whether the rest were left out at <see cref="ReadingRules.MaxHighlights"/>.</returns>
    /// <remarks>The user's highlights are counted once, and one insert is reused for every one.</remarks>
    public (int Added, bool Limited) AddMany(Guid userId, IEnumerable<(Guid ItemId, string Cfi, double Fraction, string Colour, string Text, DateTimeOffset CreatedAt, string Note)> highlights)
    {
        using var connection = _database.Open();
        using var transaction = connection.BeginTransaction();
        var count = connection.Count("highlights", userId);
        using var insert = connection.CreateCommand();
        insert.CommandText =
            """
            INSERT INTO highlights (id, user_id, item_id, cfi, fraction, colour, text, note, created_at)
            VALUES ($id, $user, $item, $cfi, $fraction, $colour, $text, $note, $created)
            ON CONFLICT (user_id, item_id, cfi) DO NOTHING
            """;
        var id = insert.Parameters.Add("$id", SqliteType.Text);
        insert.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
        var item = insert.Parameters.Add("$item", SqliteType.Text);
        var cfi = insert.Parameters.Add("$cfi", SqliteType.Text);
        var fraction = insert.Parameters.Add("$fraction", SqliteType.Real);
        var colour = insert.Parameters.Add("$colour", SqliteType.Text);
        var text = insert.Parameters.Add("$text", SqliteType.Text);
        var note = insert.Parameters.Add("$note", SqliteType.Text);
        var created = insert.Parameters.Add("$created", SqliteType.Text);
        var added = 0;
        var limited = false;
        foreach (var entry in highlights)
        {
            if (count >= ReadingRules.MaxHighlights)
            {
                // At the limit only one the user already has may pass, and it changes nothing.
                if (connection.Exists("highlights", userId, entry.ItemId, entry.Cfi))
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
            colour.Value = entry.Colour;
            text.Value = entry.Text;
            note.Value = entry.Note;
            created.Value = OrielDatabase.Time(entry.CreatedAt);
            var rows = insert.ExecuteNonQuery();
            added += rows;
            count += rows;
        }

        transaction.Commit();
        connection.Added("highlights", userId, added);
        return (added, limited);
    }

    /// <summary>
    /// Changes the highlighter or the note, or both, of one of a user's highlights in a book.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="itemId">The book.</param>
    /// <param name="highlightId">The highlight.</param>
    /// <param name="colour">The new highlighter's colour, or null to keep it.</param>
    /// <param name="note">The new note (empty for none), or null to keep it.</param>
    /// <returns>The highlight as it is now, or null when the user has no such highlight in the book.</returns>
    public StoredHighlight? Update(Guid userId, Guid itemId, Guid highlightId, string? colour, string? note)
    {
        using var connection = _database.Open();
        using var command = connection.CreateCommand();
        command.CommandText =
            """
            UPDATE highlights SET colour = coalesce($colour, colour), note = coalesce($note, note)
            WHERE id = $id AND user_id = $user AND item_id = $item
            RETURNING id, cfi, fraction, colour, text, created_at, note
            """;
        command.Parameters.AddWithValue("$colour", (object?)colour ?? DBNull.Value);
        command.Parameters.AddWithValue("$note", (object?)note ?? DBNull.Value);
        command.Parameters.AddWithValue("$id", OrielDatabase.Key(highlightId));
        command.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
        command.Parameters.AddWithValue("$item", OrielDatabase.Key(itemId));
        using var reader = command.ExecuteReader();
        return reader.Read() ? Highlight(reader, 0) : null;
    }

    /// <summary>
    /// Removes one of a user's highlights in a book.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="itemId">The book.</param>
    /// <param name="highlightId">The highlight.</param>
    /// <returns>False when the user has no such highlight in the book.</returns>
    public bool Remove(Guid userId, Guid itemId, Guid highlightId)
    {
        using var connection = _database.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM highlights WHERE id = $id AND user_id = $user AND item_id = $item";
        command.Parameters.AddWithValue("$id", OrielDatabase.Key(highlightId));
        command.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
        command.Parameters.AddWithValue("$item", OrielDatabase.Key(itemId));
        return command.ExecuteNonQuery() > 0;
    }

    // The id, cfi, fraction, colour, text, created_at and note columns, starting at `first`.
    private static StoredHighlight Highlight(SqliteDataReader reader, int first) => new(
        Guid.ParseExact(reader.GetString(first), "N"),
        reader.GetString(first + 1),
        reader.GetDouble(first + 2),
        reader.GetString(first + 3),
        reader.GetString(first + 4),
        OrielDatabase.Time(reader, first + 5),
        reader.GetString(first + 6));
}
