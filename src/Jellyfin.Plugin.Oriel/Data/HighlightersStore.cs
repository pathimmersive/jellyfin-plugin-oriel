using System;
using System.Collections.Generic;
using System.Linq;

namespace Jellyfin.Plugin.Oriel.Data;

/// <summary>
/// A highlighter as kept: its id, name and colour, as a whole list replaces it.
/// </summary>
/// <param name="Id">Its id.</param>
/// <param name="Name">Its name.</param>
/// <param name="Colour">Its colour, as #rrggbb.</param>
public sealed record HighlighterEntry(string Id, string Name, string Colour);

/// <summary>
/// A user's highlighter as listed: its id, name and colour, whether it is built in, and how many highlights use it.
/// </summary>
/// <param name="Id">Its id.</param>
/// <param name="Name">Its name.</param>
/// <param name="Colour">Its colour, as #rrggbb.</param>
/// <param name="BuiltIn">True for the four built-ins.</param>
/// <param name="Uses">How many of the user's highlights, in every book, are in it.</param>
public sealed record StoredHighlighter(string Id, string Name, string Colour, bool BuiltIn, int Uses);

/// <summary>
/// Each user's highlighters in their order; the built-ins for a user who has changed nothing. Deleting one
/// moves its highlights to <see cref="ReadingRules.FallbackHighlighter"/>.
/// </summary>
public class HighlightersStore
{
    private readonly OrielDatabase _database;

    /// <summary>
    /// Initializes a new instance of the <see cref="HighlightersStore"/> class.
    /// </summary>
    /// <param name="database">The database.</param>
    public HighlightersStore(OrielDatabase database)
    {
        _database = database;
    }

    /// <summary>
    /// Gets a user's highlighters in their order, with how many of the user's highlights use each.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <returns>The highlighters; the built-ins for a user who has changed nothing.</returns>
    public IReadOnlyList<StoredHighlighter> List(Guid userId)
    {
        using var connection = _database.Open();
        var uses = new Dictionary<string, int>(StringComparer.Ordinal);
        using (var count = connection.CreateCommand())
        {
            count.CommandText = "SELECT colour, COUNT(*) FROM highlights WHERE user_id = $user GROUP BY colour";
            count.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
            using var reader = count.ExecuteReader();
            while (reader.Read())
            {
                uses[reader.GetString(0)] = reader.GetInt32(1);
            }
        }

        var entries = Entries(connection, userId);
        return (entries.Count > 0 ? entries : ReadingRules.BuiltInHighlighters)
            .Select(entry => new StoredHighlighter(entry.Id, entry.Name, entry.Colour, ReadingRules.IsBuiltInHighlighter(entry.Id), uses.GetValueOrDefault(entry.Id)))
            .ToList();
    }

    /// <summary>
    /// Replaces a user's highlighters with a whole, checked list. The user's own highlighters left out are
    /// deleted, and their highlights move to Quotes; which ones go is decided inside the same transaction.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="highlighters">The list, in its order; the built-ins all in it.</param>
    /// <returns>The highlighters as <see cref="List"/> gives them.</returns>
    public IReadOnlyList<StoredHighlighter> Replace(Guid userId, IReadOnlyList<HighlighterEntry> highlighters)
    {
        var kept = highlighters.Select(highlighter => highlighter.Id).ToHashSet(StringComparer.Ordinal);
        using (var connection = _database.Open())
        using (var transaction = connection.BeginTransaction())
        {
            var gone = Entries(connection, userId)
                .Where(highlighter => !ReadingRules.IsBuiltInHighlighter(highlighter.Id) && !kept.Contains(highlighter.Id))
                .Select(highlighter => highlighter.Id)
                .ToList();
            foreach (var id in gone)
            {
                using var move = connection.CreateCommand();
                move.CommandText = "UPDATE highlights SET colour = $fallback WHERE user_id = $user AND colour = $id";
                move.Parameters.AddWithValue("$fallback", ReadingRules.FallbackHighlighter);
                move.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
                move.Parameters.AddWithValue("$id", id);
                move.ExecuteNonQuery();
            }

            using (var clear = connection.CreateCommand())
            {
                clear.CommandText = "DELETE FROM highlighters WHERE user_id = $user";
                clear.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
                clear.ExecuteNonQuery();
            }

            for (var position = 0; position < highlighters.Count; position++)
            {
                using var insert = connection.CreateCommand();
                insert.CommandText = "INSERT INTO highlighters (user_id, id, name, colour, position) VALUES ($user, $id, $name, $colour, $position)";
                insert.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
                insert.Parameters.AddWithValue("$id", highlighters[position].Id);
                insert.Parameters.AddWithValue("$name", highlighters[position].Name);
                insert.Parameters.AddWithValue("$colour", highlighters[position].Colour);
                insert.Parameters.AddWithValue("$position", position);
                insert.ExecuteNonQuery();
            }

            transaction.Commit();
        }

        return List(userId);
    }

    /// <summary>
    /// Gets the ids of a user's highlighters, which a highlight's colour must be one of.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <returns>The ids.</returns>
    public IReadOnlySet<string> Ids(Guid userId) =>
        List(userId).Select(highlighter => highlighter.Id).ToHashSet(StringComparer.Ordinal);

    // The highlighters the user has kept, in their order; none for a user who has changed nothing.
    private static List<HighlighterEntry> Entries(StoreConnection connection, Guid userId)
    {
        using var read = connection.CreateCommand();
        read.CommandText = "SELECT id, name, colour FROM highlighters WHERE user_id = $user ORDER BY position";
        read.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
        using var reader = read.ExecuteReader();
        var entries = new List<HighlighterEntry>();
        while (reader.Read())
        {
            entries.Add(new HighlighterEntry(reader.GetString(0), reader.GetString(1), reader.GetString(2)));
        }

        return entries;
    }
}
