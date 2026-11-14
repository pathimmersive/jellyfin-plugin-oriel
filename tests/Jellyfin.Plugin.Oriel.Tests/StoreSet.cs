using System.Collections.Generic;
using Jellyfin.Plugin.Oriel.Data;

namespace Jellyfin.Plugin.Oriel.Tests;

/// <summary>
/// A database file with its seven stores, as the plugin wires them.
/// </summary>
internal sealed class StoreSet
{
    public StoreSet(string path)
        : this(new OrielDatabase(path))
    {
    }

    public StoreSet(string path, IReadOnlyList<string> migrations)
        : this(new OrielDatabase(path, migrations))
    {
    }

    public StoreSet(OrielDatabase database)
    {
        Database = database;
        All = ReadingStores.Of(database);
    }

    public OrielDatabase Database { get; }

    public ReadingStores All { get; }

    public PositionsStore Positions => All.Positions;

    public BookmarksStore Bookmarks => All.Bookmarks;

    public HighlightsStore Highlights => All.Highlights;

    public HighlightersStore Highlighters => All.Highlighters;

    public FontsStore Fonts => All.Fonts;

    public ThemesStore Themes => All.Themes;

    public ChoicesStore Choices => All.Choices;
}
