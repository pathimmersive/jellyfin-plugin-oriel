using System;
using System.Collections.Generic;

namespace Jellyfin.Plugin.Oriel.Data;

/// <summary>
/// One of a user's own themes: its id, its name and its ten colours, each #rrggbb, in the order of <see cref="ReadingRules.ThemeColours"/>.
/// </summary>
/// <param name="Id">Its id.</param>
/// <param name="Name">Its name.</param>
/// <param name="Colours">Its colours.</param>
public sealed record ThemeEntry(string Id, string Name, IReadOnlyList<string> Colours);

/// <summary>
/// Each user's own themes in their order, at most <see cref="ReadingRules.MaxThemes"/>.
/// </summary>
public class ThemesStore
{
    private readonly OrielDatabase _database;

    /// <summary>
    /// Initializes a new instance of the <see cref="ThemesStore"/> class.
    /// </summary>
    /// <param name="database">The database.</param>
    public ThemesStore(OrielDatabase database)
    {
        _database = database;
    }

    /// <summary>
    /// Gets a user's own themes in their order.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <returns>The themes; none for a user who has made none.</returns>
    public IReadOnlyList<ThemeEntry> List(Guid userId)
    {
        using var connection = _database.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT id, name, colours FROM themes WHERE user_id = $user ORDER BY position";
        command.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
        using var reader = command.ExecuteReader();
        var themes = new List<ThemeEntry>();
        while (reader.Read())
        {
            themes.Add(new ThemeEntry(reader.GetString(0), reader.GetString(1), reader.GetString(2).Split(' ')));
        }

        return themes;
    }

    /// <summary>
    /// Replaces a user's own themes with a whole, checked list; those left out are deleted.
    /// </summary>
    /// <param name="userId">The user.</param>
    /// <param name="themes">The list, in its order.</param>
    /// <returns>The themes as <see cref="List"/> gives them.</returns>
    public IReadOnlyList<ThemeEntry> Replace(Guid userId, IReadOnlyList<ThemeEntry> themes)
    {
        using (var connection = _database.Open())
        using (var transaction = connection.BeginTransaction())
        {
            using (var clear = connection.CreateCommand())
            {
                clear.CommandText = "DELETE FROM themes WHERE user_id = $user";
                clear.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
                clear.ExecuteNonQuery();
            }

            for (var position = 0; position < themes.Count; position++)
            {
                using var insert = connection.CreateCommand();
                insert.CommandText = "INSERT INTO themes (user_id, id, name, colours, position) VALUES ($user, $id, $name, $colours, $position)";
                insert.Parameters.AddWithValue("$user", OrielDatabase.Key(userId));
                insert.Parameters.AddWithValue("$id", themes[position].Id);
                insert.Parameters.AddWithValue("$name", themes[position].Name);
                insert.Parameters.AddWithValue("$colours", string.Join(' ', themes[position].Colours));
                insert.Parameters.AddWithValue("$position", position);
                insert.ExecuteNonQuery();
            }

            transaction.Commit();
        }

        return List(userId);
    }
}
