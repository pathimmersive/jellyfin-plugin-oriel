using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace Jellyfin.Plugin.Oriel.Data;

/// <summary>
/// What a user's reading data may hold: the limits, the built-ins, and the checks that the HTTP API and the
/// import both apply before anything is stored.
/// </summary>
public static partial class ReadingRules
{
    /// <summary>
    /// The longest CFI kept for a position, bookmark or highlight.
    /// </summary>
    public const int MaxCfiLength = 4096;

    /// <summary>
    /// The longest text a bookmark keeps.
    /// </summary>
    public const int MaxBookmarkTextLength = 500;

    /// <summary>
    /// The longest text a highlight keeps.
    /// </summary>
    public const int MaxHighlightTextLength = 1000;

    /// <summary>
    /// The longest note a highlight keeps.
    /// </summary>
    public const int MaxNoteLength = 2000;

    /// <summary>
    /// The most bookmarks a user keeps, in all their books.
    /// </summary>
    public const int MaxBookmarks = 5000;

    /// <summary>
    /// The most highlights a user keeps, in all their books.
    /// </summary>
    public const int MaxHighlights = 20000;

    /// <summary>
    /// The most highlighters a user keeps, built-ins included.
    /// </summary>
    public const int MaxHighlighters = 8;

    /// <summary>
    /// The longest name a highlighter keeps.
    /// </summary>
    public const int MaxHighlighterNameLength = 40;

    /// <summary>
    /// The longest id a highlighter or a theme has.
    /// </summary>
    public const int MaxIdLength = 64;

    /// <summary>
    /// The most themes of their own a user keeps.
    /// </summary>
    public const int MaxThemes = 12;

    /// <summary>
    /// The longest name a theme keeps.
    /// </summary>
    public const int MaxThemeNameLength = 40;

    /// <summary>
    /// The largest font file accepted: 5 MB.
    /// </summary>
    public const int MaxFontFileBytes = 5 * 1024 * 1024;

    /// <summary>
    /// The most font files a user keeps.
    /// </summary>
    public const int MaxFonts = 20;

    /// <summary>
    /// The most bytes of font files a user keeps: 100 MB.
    /// </summary>
    public const long MaxFontBytes = 100L * 1024 * 1024;

    /// <summary>
    /// The built-in highlighter a deleted highlighter's highlights move to: Quotes.
    /// </summary>
    public const string FallbackHighlighter = "yellow";

    private const string Own = "own:";

    /// <summary>
    /// The four built-in highlighters, in their first order: Quotes, Green, Vocabulary and Pink.
    /// </summary>
    public static readonly IReadOnlyList<HighlighterEntry> BuiltInHighlighters =
    [
        new("yellow", "Quotes", "#ffd54f"),
        new("green", "Green", "#81c784"),
        new("blue", "Vocabulary", "#64b5f6"),
        new("pink", "Pink", "#f06292"),
    ];

    /// <summary>
    /// A theme's colours, in the order they are kept.
    /// </summary>
    public static readonly IReadOnlyList<string> ThemeColours =
        ["background", "text", "secondary", "accent", "selection", "separator", "controls", "controlsText", "buttons", "grayed"];

    /// <summary>
    /// The themes Oriel has built in.
    /// </summary>
    public static readonly IReadOnlySet<string> BuiltInThemes = new HashSet<string>(StringComparer.Ordinal) { "light", "sepia", "dark" };

    /// <summary>
    /// The fonts the reader bundles, by name.
    /// </summary>
    public static readonly IReadOnlySet<string> BundledFonts = new HashSet<string>(StringComparer.Ordinal)
    {
        "Default", "Literata", "Noto Serif", "Noto Sans", "Atkinson Hyperlegible",
    };

    private static readonly IReadOnlySet<string> BuiltInHighlighterIds =
        BuiltInHighlighters.Select(builtIn => builtIn.Id).ToHashSet(StringComparer.Ordinal);

    /// <summary>
    /// Whether a highlighter id is one of the built-ins.
    /// </summary>
    /// <param name="id">The id.</param>
    /// <returns>True for a built-in.</returns>
    public static bool IsBuiltInHighlighter(string id) => BuiltInHighlighterIds.Contains(id);

    /// <summary>
    /// Whether a colour is written as #rrggbb.
    /// </summary>
    /// <param name="colour">The colour.</param>
    /// <returns>True for #rrggbb.</returns>
    public static bool IsColour(string? colour) => colour is not null && HexColour().IsMatch(colour);

    /// <summary>
    /// Whether a fraction of a book is a number from 0 to 1.
    /// </summary>
    /// <param name="fraction">The fraction.</param>
    /// <returns>True from 0 to 1.</returns>
    public static bool IsFraction(double fraction) => !double.IsNaN(fraction) && fraction is >= 0 and <= 1;

    /// <summary>
    /// Checks a whole list of highlighters for a user whose own highlighters have the ids in <paramref name="own"/>:
    /// 4 to 8 of them, each built-in once, any other id one of the user's own, a name of 1 to 40 characters and a
    /// colour written as #rrggbb. Entries without an id are new and are given one.
    /// </summary>
    /// <param name="list">The list as sent, each entry its id, name and colour; null entries are malformed.</param>
    /// <param name="own">The ids of the user's own highlighters.</param>
    /// <returns>The list to keep, or null when it is malformed.</returns>
    public static IReadOnlyList<HighlighterEntry>? CheckHighlighters(IReadOnlyList<(string? Id, string? Name, string? Colour)?>? list, IReadOnlySet<string> own)
    {
        if (list is not { Count: >= 4 and <= MaxHighlighters })
        {
            return null;
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        var kept = new List<HighlighterEntry>();
        foreach (var entry in list)
        {
            if (entry?.Name?.Trim() is not { Length: > 0 and <= MaxHighlighterNameLength } name || !IsColour(entry.Value.Colour))
            {
                return null;
            }

            var id = entry.Value.Id ?? Guid.NewGuid().ToString("N");
            if (!seen.Add(id) || (entry.Value.Id is not null && !IsBuiltInHighlighter(id) && !own.Contains(id)))
            {
                return null;
            }

            kept.Add(new HighlighterEntry(id, name, entry.Value.Colour!.ToLowerInvariant()));
        }

        return BuiltInHighlighterIds.IsSubsetOf(seen) ? kept : null;
    }

    /// <summary>
    /// Checks a whole list of themes for a user whose own themes have the ids in <paramref name="own"/>:
    /// at most 12, each id one of the user's own and not repeated, a name of 1 to 40 characters and
    /// ten colours written as #rrggbb. Entries without an id are new and are given one.
    /// </summary>
    /// <param name="list">The list as sent, each entry its id, name and ten colours; null entries are malformed.</param>
    /// <param name="own">The ids of the user's own themes.</param>
    /// <returns>The list to keep, or null when it is malformed.</returns>
    public static IReadOnlyList<ThemeEntry>? CheckThemes(IReadOnlyList<(string? Id, string? Name, IReadOnlyList<string?> Colours)?>? list, IReadOnlySet<string> own)
    {
        if (list is not { Count: <= MaxThemes })
        {
            return null;
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        var kept = new List<ThemeEntry>();
        foreach (var entry in list)
        {
            if (entry?.Name?.Trim() is not { Length: > 0 and <= MaxThemeNameLength } name)
            {
                return null;
            }

            var colours = entry.Value.Colours;
            if (!colours.All(IsColour))
            {
                return null;
            }

            var id = entry.Value.Id ?? Guid.NewGuid().ToString("N");
            if (!seen.Add(id) || (entry.Value.Id is not null && !own.Contains(id)))
            {
                return null;
            }

            kept.Add(new ThemeEntry(id, name, colours.Select(colour => colour!.ToLowerInvariant()).ToList()));
        }

        return kept;
    }

    /// <summary>
    /// Checks a choice for a user with the theme ids in <paramref name="themes"/> and the font families in
    /// <paramref name="families"/>: a built-in theme or <c>own:</c> one of theirs, a bundled font or
    /// <c>own:</c> one of their families.
    /// </summary>
    /// <param name="theme">The theme as sent.</param>
    /// <param name="font">The font as sent.</param>
    /// <param name="themes">The ids of the user's own themes.</param>
    /// <param name="families">The user's own font families.</param>
    /// <returns>The choice to keep, or null when it is not one the user can make.</returns>
    public static StoredChoices? CheckChoices(string? theme, string? font, IReadOnlySet<string> themes, IReadOnlySet<string> families)
    {
        if (theme is null || font is null)
        {
            return null;
        }

        var themeKnown = BuiltInThemes.Contains(theme) || (theme.StartsWith(Own, StringComparison.Ordinal) && themes.Contains(theme[Own.Length..]));
        var fontKnown = BundledFonts.Contains(font) || (font.StartsWith(Own, StringComparison.Ordinal) && families.Contains(font[Own.Length..]));
        return themeKnown && fontKnown ? new StoredChoices(theme, font) : null;
    }

    [GeneratedRegex("^#[0-9a-fA-F]{6}$")]
    private static partial Regex HexColour();
}
