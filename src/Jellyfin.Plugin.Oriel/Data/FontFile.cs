using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Text;

namespace Jellyfin.Plugin.Oriel.Data;

/// <summary>
/// What a font file says about itself: its format, family, style, weight and whether it is italic.
/// </summary>
/// <param name="Format">ttf, otf or woff2.</param>
/// <param name="Family">Its typographic family, else its family.</param>
/// <param name="Style">Its typographic subfamily, else its subfamily: Regular, Italic, Bold and so on.</param>
/// <param name="Weight">Its weight class, from 1 to 1000; 400 when it has no OS/2 table.</param>
/// <param name="Italic">True for an italic or oblique face.</param>
public sealed record FontFile(string Format, string Family, string Style, int Weight, bool Italic)
{
    /// <summary>
    /// The longest family or style name kept.
    /// </summary>
    public const int MaxNameLength = 64;

    /// <summary>
    /// The most a WOFF2 file's tables may inflate to; a file declaring more is not read.
    /// </summary>
    public const int MaxTablesBytes = 10 * 1024 * 1024;

    private const uint TrueType = 0x00010000;
    private const uint TrueTypeApple = 0x74727565; // 'true'
    private const uint OpenType = 0x4F54544F; // 'OTTO'
    private const uint Woff2 = 0x774F4632; // 'wOF2'

    // WOFF2's known table tags, by the index its table directory gives them.
    private static readonly string[] Woff2Tags =
    [
        "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT",
        "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH",
        "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
        "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
    ];

    /// <summary>
    /// Reads a font file's names, weight and italic.
    /// </summary>
    /// <param name="bytes">The file.</param>
    /// <returns>
    /// What the file says, or null when it is not a TrueType or OpenType font, bare or in WOFF2, has no family name,
    /// or cannot be read: a WOFF2 whose tables pass <see cref="MaxTablesBytes"/> or whose Brotli stream does not
    /// inflate to exactly the tables its directory declares. Never throws.
    /// </returns>
    public static FontFile? Read(ReadOnlySpan<byte> bytes)
    {
        try
        {
            if (bytes.Length < 12)
            {
                return null;
            }

            var tables = U32(bytes, 0) switch
            {
                TrueType or TrueTypeApple => ("ttf", SfntTables(bytes)),
                OpenType => ("otf", SfntTables(bytes)),
                Woff2 => Woff2Tables(bytes),
                _ => (null, null),
            };
            if (tables.Item1 is not { } format || tables.Item2 is not { } found || !found.TryGetValue("name", out var name))
            {
                return null;
            }

            var names = Names(name);
            var family = Clean(names.GetValueOrDefault(16) ?? names.GetValueOrDefault(1));
            if (family is null)
            {
                return null;
            }

            var style = Clean(names.GetValueOrDefault(17) ?? names.GetValueOrDefault(2)) ?? "Regular";
            var weight = 400;
            bool italic;
            if (found.TryGetValue("OS/2", out var os2) && os2.Length >= 64)
            {
                weight = Math.Clamp((int)U16(os2, 4), 1, 1000);
                var selection = U16(os2, 62);
                italic = (selection & 0x1) != 0 || (selection & 0x200) != 0;
            }
            else
            {
                italic = style.Contains("Italic", StringComparison.OrdinalIgnoreCase) || style.Contains("Oblique", StringComparison.OrdinalIgnoreCase);
            }

            return new FontFile(format, family, style, weight, italic);
        }
        catch (Exception exception) when (exception is not OutOfMemoryException)
        {
            return null;
        }
    }

    private static uint U32(ReadOnlySpan<byte> bytes, int at) =>
        ((uint)bytes[at] << 24) | ((uint)bytes[at + 1] << 16) | ((uint)bytes[at + 2] << 8) | bytes[at + 3];

    private static ushort U16(ReadOnlySpan<byte> bytes, int at) => (ushort)((bytes[at] << 8) | bytes[at + 1]);

    // The tables a bare TrueType or OpenType file lists, by tag.
    private static Dictionary<string, byte[]> SfntTables(ReadOnlySpan<byte> bytes)
    {
        var count = U16(bytes, 4);
        var tables = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        for (var i = 0; i < count; i++)
        {
            var record = 12 + (i * 16);
            var tag = Encoding.ASCII.GetString(bytes.Slice(record, 4));
            var offset = (int)U32(bytes, record + 8);
            var length = (int)U32(bytes, record + 12);
            if (tag is "name" or "OS/2")
            {
                tables[tag] = bytes.Slice(offset, length).ToArray();
            }
        }

        return tables;
    }

    // A WOFF2 file's name and OS/2 tables, which it never transforms, from its Brotli stream.
    private static (string?, Dictionary<string, byte[]>?) Woff2Tables(ReadOnlySpan<byte> bytes)
    {
        if (U32(bytes, 4) == 0x74746366)
        {
            // 'ttcf': a collection, more than one font in a file.
            return (null, null);
        }

        var count = U16(bytes, 12);
        var compressedLength = U32(bytes, 20);
        var at = 48;
        var entries = new List<(string Tag, int Length)>();
        long total = 0;
        for (var i = 0; i < count; i++)
        {
            var flags = bytes[at++];
            string tag;
            if ((flags & 0x3F) == 0x3F)
            {
                tag = Encoding.ASCII.GetString(bytes.Slice(at, 4));
                at += 4;
            }
            else
            {
                tag = Woff2Tags[flags & 0x3F];
            }

            var length = Base128(bytes, ref at);
            var version = flags >> 6;
            var transformed = tag is "glyf" or "loca" ? version != 3 : version != 0;
            if (transformed)
            {
                length = Base128(bytes, ref at);
            }

            total += length;
            if (total > MaxTablesBytes)
            {
                return (null, null);
            }

            entries.Add((tag, length));
        }

        if (compressedLength > bytes.Length - at)
        {
            return (null, null);
        }

        // Inflate into a buffer of exactly the declared size, then make sure the stream ends there.
        var tables = new byte[total];
        using var compressed = new MemoryStream(bytes.Slice(at, (int)compressedLength).ToArray());
        using var brotli = new BrotliStream(compressed, CompressionMode.Decompress);
        brotli.ReadExactly(tables);
        if (brotli.Read(stackalloc byte[1]) != 0)
        {
            return (null, null);
        }

        var found = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        var offset = 0;
        foreach (var (tag, length) in entries)
        {
            if (tag is "name" or "OS/2")
            {
                found[tag] = tables.AsSpan(offset, length).ToArray();
            }

            offset += length;
        }

        return ("woff2", found);
    }

    // WOFF2's UIntBase128: up to five bytes, seven bits each, high bit set on all but the last; no more than int.MaxValue here.
    private static int Base128(ReadOnlySpan<byte> bytes, ref int at)
    {
        long value = 0;
        for (var i = 0; i < 5; i++)
        {
            var b = bytes[at++];
            if (i == 0 && b == 0x80)
            {
                throw new InvalidDataException("A UIntBase128 starts with a zero.");
            }

            value = (value << 7) | (long)(b & 0x7F);
            if ((b & 0x80) == 0)
            {
                return value <= int.MaxValue ? (int)value : throw new InvalidDataException("A UIntBase128 is past int range.");
            }
        }

        throw new InvalidDataException("A UIntBase128 runs past five bytes.");
    }

    // The name table's strings by name id: Windows Unicode English first, then any Windows Unicode, then Mac Roman.
    private static Dictionary<int, string> Names(ReadOnlySpan<byte> table)
    {
        var count = U16(table, 2);
        var strings = U16(table, 4);
        var best = new Dictionary<int, (int Rank, string Text)>();
        for (var i = 0; i < count; i++)
        {
            var record = 6 + (i * 12);
            var platform = U16(table, record);
            var encoding = U16(table, record + 2);
            var language = U16(table, record + 4);
            var id = U16(table, record + 6);
            var length = U16(table, record + 8);
            var offset = U16(table, record + 10);
            int rank;
            string text;
            var raw = table.Slice(strings + offset, length);
            if (platform == 3 && (encoding == 1 || encoding == 10))
            {
                rank = language == 0x409 ? 0 : 1;
                text = Encoding.BigEndianUnicode.GetString(raw);
            }
            else if (platform == 0)
            {
                rank = 2;
                text = Encoding.BigEndianUnicode.GetString(raw);
            }
            else if (platform == 1 && encoding == 0)
            {
                rank = language == 0 ? 3 : 4;
                text = Encoding.Latin1.GetString(raw);
            }
            else
            {
                continue;
            }

            if (!best.TryGetValue(id, out var kept) || rank < kept.Rank)
            {
                best[id] = (rank, text);
            }
        }

        var names = new Dictionary<int, string>();
        foreach (var (id, (_, text)) in best)
        {
            names[id] = text;
        }

        return names;
    }

    // A name with control characters dropped and spaces evened, cut to MaxNameLength; null when nothing is left.
    private static string? Clean(string? name)
    {
        if (name is null)
        {
            return null;
        }

        var kept = new StringBuilder();
        foreach (var character in name)
        {
            if (!char.IsControl(character))
            {
                kept.Append(char.IsWhiteSpace(character) ? ' ' : character);
            }
        }

        var text = string.Join(' ', kept.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries));
        return text.Length == 0 ? null : text[..Math.Min(text.Length, MaxNameLength)];
    }
}
