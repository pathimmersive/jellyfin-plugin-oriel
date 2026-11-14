namespace Jellyfin.Plugin.Oriel.Data;

/// <summary>
/// The seven stores of a user's reading data together, for the export and import, which use them all.
/// </summary>
/// <param name="Positions">The positions.</param>
/// <param name="Bookmarks">The bookmarks.</param>
/// <param name="Highlights">The highlights.</param>
/// <param name="Highlighters">The highlighters.</param>
/// <param name="Fonts">The fonts.</param>
/// <param name="Themes">The themes.</param>
/// <param name="Choices">The chosen theme and font.</param>
public sealed record ReadingStores(
    PositionsStore Positions,
    BookmarksStore Bookmarks,
    HighlightsStore Highlights,
    HighlightersStore Highlighters,
    FontsStore Fonts,
    ThemesStore Themes,
    ChoicesStore Choices)
{
    /// <summary>
    /// Makes the seven stores of one database.
    /// </summary>
    /// <param name="database">The database.</param>
    /// <returns>The stores.</returns>
    public static ReadingStores Of(OrielDatabase database) => new(
        new PositionsStore(database),
        new BookmarksStore(database),
        new HighlightsStore(database),
        new HighlightersStore(database),
        new FontsStore(database),
        new ThemesStore(database),
        new ChoicesStore(database));
}
