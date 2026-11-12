using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Oriel.Controllers;
using Jellyfin.Plugin.Oriel.Data;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Jellyfin.Plugin.Oriel.Tests;

public sealed class FontsControllerTests : IDisposable
{
    private static readonly Guid Reader = Guid.NewGuid();
    private static readonly Guid OtherReader = Guid.NewGuid();

    private readonly string _folder = Path.Combine(Path.GetTempPath(), "oriel-fonts-" + Guid.NewGuid().ToString("N"));
    private readonly PositionStore _store;

    public FontsControllerTests()
    {
        _store = new PositionStore(Path.Combine(_folder, "oriel.db"));
    }

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        if (Directory.Exists(_folder))
        {
            Directory.Delete(_folder, recursive: true);
        }
    }

    [Fact]
    public void ReadsTheNamesWeightAndItalicOfATrueTypeAnOpenTypeAndAWoff2Font()
    {
        Assert.Equal(new FontFile("ttf", "Charter", "Regular", 400, false), FontFile.Read(Sfnt(0x00010000, Tables("Charter", "Regular", 400, false))));
        Assert.Equal(new FontFile("otf", "Charter", "Bold Italic", 700, true), FontFile.Read(Sfnt(0x4F54544F, Tables("Charter", "Bold Italic", 700, true))));
        Assert.Equal(new FontFile("woff2", "Charter", "Italic", 400, true), FontFile.Read(Woff2(Tables("Charter", "Italic", 400, true))));
        Assert.Equal("ttf", FontFile.Read(Sfnt(0x74727565, Tables("Charter", "Regular", 400, false)))?.Format);
    }

    [Fact]
    public void ReadsARealWoff2FontWhoseGlyphsAreTransformed()
    {
        var font = FontFile.Read(File.ReadAllBytes(Fontsource("atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-italic.woff2")));

        Assert.Equal(new FontFile("woff2", "Atkinson Hyperlegible", "Bold Italic", 700, true), font);
    }

    [Fact]
    public void PrefersTheTypographicNamesAndReadsItalicFromTheStyleWithoutOs2()
    {
        var tables = Tables("Charter Light", "Regular", 300, false);
        tables["name"] = Name((1, "Charter Light"), (2, "Regular"), (16, "Charter"), (17, "Light"));
        Assert.Equal(new FontFile("ttf", "Charter", "Light", 300, false), FontFile.Read(Sfnt(0x00010000, tables)));

        var bare = new Dictionary<string, byte[]> { ["name"] = Name((1, "  Charter\u0000 "), (2, "Oblique")) };
        Assert.Equal(new FontFile("ttf", "Charter", "Oblique", 400, true), FontFile.Read(Sfnt(0x00010000, bare)));
    }

    public static TheoryData<string> NotFonts => new()
    {
        "empty",
        "text",
        "a WOFF file",
        "a font collection",
        "a font with no name table",
        "a font with no family name",
        "a font cut short",
        "a WOFF2 file cut short",
    };

    [Theory]
    [MemberData(nameof(NotFonts))]
    public void ReadsNothingFromAFileThatIsNotAFont(string what)
    {
        Assert.Null(FontFile.Read(NotAFont(what)));
    }

    public static TheoryData<string> HostileWoff2s => new()
    {
        "a Brotli bomb",
        "a Brotli bomb at the ceiling",
        "a stream with more than its tables",
        "a stream shorter than its tables",
        "a stream cut short",
        "a UIntBase128 past int range",
        "a UIntBase128 past 32 bits",
        "declared lengths that overflow",
        "declared lengths past 10 MB",
        "a compressed length past the file",
    };

    [Theory]
    [MemberData(nameof(HostileWoff2s))]
    public async Task RefusesAHostileWoff2AsNotAFont(string what)
    {
        Assert.Null(FontFile.Read(HostileWoff2(what)));

        var refused = Assert.IsType<BadRequestObjectResult>((await Controller(Reader, HostileWoff2(what)).AddFont()).Result);
        Assert.Equal("notAFont", Assert.IsType<FontsController.Refusal>(refused.Value).Reason);
        Assert.Empty((await Controller(Reader).GetFonts()).Value!);
    }

    [Theory]
    [InlineData("a Brotli bomb", 1024 * 1024)]
    [InlineData("a Brotli bomb at the ceiling", (10 * 1024 * 1024) + (1024 * 1024))]
    [InlineData("declared lengths past 10 MB", 1024 * 1024)]
    public void ReadsAHostileWoff2WithoutAllocatingPastItsDeclaredTables(string what, int most)
    {
        var bomb = HostileWoff2(what);
        Assert.True(bomb.Length < FontsController.MaxBytes);
        FontFile.Read(bomb);

        var before = GC.GetAllocatedBytesForCurrentThread();
        var font = FontFile.Read(bomb);
        var allocated = GC.GetAllocatedBytesForCurrentThread() - before;

        Assert.Null(font);
        Assert.True(allocated <= most, $"reading {what} allocated {allocated} bytes");
    }

    [Fact]
    public async Task AddsListsServesAndRemovesAFamily()
    {
        var controller = Controller(Reader);
        var regular = Sfnt(0x00010000, Tables("Charter", "Regular", 400, false));
        var italic = Woff2(Tables("Charter", "Italic", 400, true));

        var added = (await controller.AddFont()).Value!;
        Assert.Equal(("Charter", "Regular", 400, false, "ttf"), (added.Family, added.Style, added.Weight, added.Italic, added.Format));
        controller = Controller(Reader, italic);
        await controller.AddFont();
        controller = Controller(Reader, regular);
        Assert.Equal(added.Family, (await controller.AddFont()).Value!.Family);

        var listed = (await Controller(Reader).GetFonts()).Value!;
        Assert.Equal([("Regular", false, "ttf"), ("Italic", true, "woff2")], listed.Select(font => (font.Style, font.Italic, font.Format)));

        var serving = Controller(Reader);
        var file = Assert.IsType<FileContentResult>(await serving.GetFont(Guid.ParseExact(listed[1].Id, "N")));
        Assert.Equal(italic, file.FileContents);
        Assert.Equal("font/woff2", file.ContentType);
        Assert.Equal("private, max-age=31536000, immutable", serving.Response.Headers.CacheControl.ToString());

        Assert.IsType<NoContentResult>(await Controller(Reader).RemoveFamily("Charter"));
        Assert.Empty((await Controller(Reader).GetFonts()).Value!);
        Assert.IsType<NotFoundResult>(await Controller(Reader).RemoveFamily("Charter"));
        Assert.IsType<NotFoundResult>(await Controller(Reader).GetFont(Guid.ParseExact(listed[1].Id, "N")));
    }

    [Fact]
    public async Task ReplacesAStyleTheFamilyAlreadyHas()
    {
        var first = (await Controller(Reader, Sfnt(0x00010000, Tables("Charter", "Regular", 400, false))).AddFont()).Value!;
        var second = (await Controller(Reader, Woff2(Tables("Charter", "Regular", 400, false))).AddFont()).Value!;

        var listed = (await Controller(Reader).GetFonts()).Value!;
        Assert.Equal([second.Id], listed.Select(font => font.Id));
        Assert.NotEqual(first.Id, second.Id);
        Assert.Equal("woff2", listed[0].Format);
    }

    [Fact]
    public async Task RefusesA21stFileButTakesOneThatReplacesAnother()
    {
        for (var weight = 100; weight <= 1000; weight += 100)
        {
            await Controller(Reader, Sfnt(0x00010000, Tables("Charter", "W", weight, false))).AddFont();
            await Controller(Reader, Sfnt(0x00010000, Tables("Charter", "W", weight, true))).AddFont();
        }

        var refused = Assert.IsType<BadRequestObjectResult>((await Controller(Reader, Sfnt(0x00010000, Tables("Other", "Regular", 400, false))).AddFont()).Result);
        Assert.Equal("tooMany", Assert.IsType<FontsController.Refusal>(refused.Value).Reason);
        Assert.Equal(PositionStore.MaxFonts, (await Controller(Reader).GetFonts()).Value!.Count);

        Assert.Equal("Bold", (await Controller(Reader, Sfnt(0x00010000, Tables("Charter", "Bold", 700, false))).AddFont()).Value!.Style);
        Assert.Equal(PositionStore.MaxFonts, (await Controller(Reader).GetFonts()).Value!.Count);
    }

    [Fact]
    public async Task RefusesAFileOver5MbAndAFileThatIsNotAFont()
    {
        var over = new byte[FontsController.MaxBytes + 1];
        Assert.Equal(StatusCodes.Status413PayloadTooLarge, Assert.IsType<StatusCodeResult>((await Controller(Reader, over).AddFont()).Result).StatusCode);

        var atLimit = new byte[FontsController.MaxBytes];
        var refused = Assert.IsType<BadRequestObjectResult>((await Controller(Reader, atLimit).AddFont()).Result);
        Assert.Equal("notAFont", Assert.IsType<FontsController.Refusal>(refused.Value).Reason);

        Assert.Empty((await Controller(Reader).GetFonts()).Value!);
    }

    [Fact]
    public async Task KeepsEachReadersFontsTheirOwn()
    {
        var added = (await Controller(Reader, Sfnt(0x00010000, Tables("Charter", "Regular", 400, false))).AddFont()).Value!;

        Assert.Empty((await Controller(OtherReader).GetFonts()).Value!);
        Assert.IsType<NotFoundResult>(await Controller(OtherReader).GetFont(Guid.ParseExact(added.Id, "N")));
        Assert.IsType<NotFoundResult>(await Controller(OtherReader).RemoveFamily("Charter"));
        Assert.Single((await Controller(Reader).GetFonts()).Value!);
    }

    [Fact]
    public async Task RefusesACallerWithoutAToken()
    {
        var anonymous = Controller(Guid.Empty, Sfnt(0x00010000, Tables("Charter", "Regular", 400, false)));
        Assert.IsType<UnauthorizedResult>((await anonymous.GetFonts()).Result);
        Assert.IsType<UnauthorizedResult>((await anonymous.AddFont()).Result);
        Assert.IsType<UnauthorizedResult>(await anonymous.GetFont(Guid.NewGuid()));
        Assert.IsType<UnauthorizedResult>(await anonymous.RemoveFamily("Charter"));
    }

    // A font from the reader's Fontsource packages, which building the plugin installs.
    internal static string Fontsource(string file)
    {
        for (var folder = new DirectoryInfo(AppContext.BaseDirectory); folder is not null; folder = folder.Parent)
        {
            var path = Path.Combine(folder.FullName, "src", "reader", "node_modules", "@fontsource", file);
            if (File.Exists(path))
            {
                return path;
            }
        }

        throw new FileNotFoundException($"@fontsource/{file} is not installed; building the plugin installs it.");
    }

    private static byte[] NotAFont(string what) => what switch
    {
        "empty" => [],
        "text" => Encoding.UTF8.GetBytes("This is not a font, though it is long enough to look like one."),
        "a WOFF file" => [.. "wOFF"u8, 0, 1, 0, 0, .. new byte[40]],
        "a font collection" => [.. "wOF2"u8, .. "ttcf"u8, .. new byte[40]],
        "a font with no name table" => Sfnt(0x00010000, new Dictionary<string, byte[]> { ["OS/2"] = Os2(400, false) }),
        "a font with no family name" => Sfnt(0x00010000, new Dictionary<string, byte[]> { ["name"] = Name((2, "Regular")) }),
        "a font cut short" => Sfnt(0x00010000, Tables("Charter", "Regular", 400, false))[..40],
        "a WOFF2 file cut short" => Woff2(Tables("Charter", "Regular", 400, false))[..60],
        _ => throw new ArgumentOutOfRangeException(nameof(what)),
    };

    private static Dictionary<string, byte[]> Tables(string family, string style, int weight, bool italic) =>
        new() { ["name"] = Name((1, family), (2, style)), ["OS/2"] = Os2(weight, italic) };

    // A name table of Windows English strings.
    private static byte[] Name(params (int Id, string Text)[] names)
    {
        var strings = names.Select(name => Encoding.BigEndianUnicode.GetBytes(name.Text)).ToList();
        var table = new List<byte>();
        Put16(table, 0);
        Put16(table, names.Length);
        Put16(table, 6 + (names.Length * 12));
        var offset = 0;
        for (var i = 0; i < names.Length; i++)
        {
            foreach (var value in new[] { 3, 1, 0x409, names[i].Id, strings[i].Length, offset })
            {
                Put16(table, value);
            }

            offset += strings[i].Length;
        }

        foreach (var text in strings)
        {
            table.AddRange(text);
        }

        return [.. table];
    }

    // An OS/2 table with only the weight class and the italic bit of fsSelection set.
    private static byte[] Os2(int weight, bool italic)
    {
        var table = new byte[78];
        table[4] = (byte)(weight >> 8);
        table[5] = (byte)weight;
        table[63] = italic ? (byte)1 : (byte)0;
        return table;
    }

    private static byte[] Sfnt(uint version, Dictionary<string, byte[]> tables)
    {
        var bytes = new List<byte>();
        Put32(bytes, version);
        Put16(bytes, tables.Count);
        Put16(bytes, 0);
        Put16(bytes, 0);
        Put16(bytes, 0);
        var offset = 12 + (tables.Count * 16);
        foreach (var (tag, data) in tables)
        {
            bytes.AddRange(Encoding.ASCII.GetBytes(tag));
            Put32(bytes, 0);
            Put32(bytes, (uint)offset);
            Put32(bytes, (uint)data.Length);
            offset += data.Length;
        }

        foreach (var data in tables.Values)
        {
            bytes.AddRange(data);
        }

        return [.. bytes];
    }

    // A WOFF2 file of the tables, untransformed, name and OS/2 given by their known indexes and anything else by tag.
    private static byte[] Woff2(Dictionary<string, byte[]> tables)
    {
        using var compressed = new MemoryStream();
        using (var brotli = new BrotliStream(compressed, CompressionLevel.Optimal, leaveOpen: true))
        {
            foreach (var data in tables.Values)
            {
                brotli.Write(data);
            }
        }

        var directory = new List<byte>();
        foreach (var (tag, data) in tables)
        {
            var known = tag switch { "name" => 5, "OS/2" => 6, _ => 63 };
            directory.Add((byte)known);
            if (known == 63)
            {
                directory.AddRange(Encoding.ASCII.GetBytes(tag));
            }

            var length = new List<byte> { (byte)(data.Length & 0x7F) };
            for (var rest = data.Length >> 7; rest > 0; rest >>= 7)
            {
                length.Insert(0, (byte)(0x80 | (rest & 0x7F)));
            }

            directory.AddRange(length);
        }

        var bytes = new List<byte>();
        bytes.AddRange("wOF2"u8.ToArray());
        Put32(bytes, 0x00010000);
        Put32(bytes, 0);
        Put16(bytes, tables.Count);
        Put16(bytes, 0);
        Put32(bytes, 0);
        Put32(bytes, (uint)compressed.Length);
        bytes.AddRange(new byte[24]);
        bytes.AddRange(directory);
        bytes.AddRange(compressed.ToArray());
        return [.. bytes];
    }

    // A WOFF2 file built to exhaust or confuse a reader: name and OS/2 tables whose
    // directory or Brotli stream lies about their size.
    internal static byte[] HostileWoff2(string what)
    {
        const int TenMb = 10 * 1024 * 1024;
        var name = Name((1, "Charter"), (2, "Regular"));
        var os2 = Os2(400, false);
        var honest = new List<(int, byte[])> { (5, Base128(name.Length)), (6, Base128(os2.Length)) };
        var tables = Compress(name, os2);
        return what switch
        {
            "a Brotli bomb" => RawWoff2(honest, Compress(name, os2, new byte[16 * 1024 * 1024])),
            "a Brotli bomb at the ceiling" => RawWoff2(
                [.. honest, (0x3F, Base128(TenMb - name.Length - os2.Length))],
                Compress(name, os2, new byte[16 * 1024 * 1024])),
            "a stream with more than its tables" => RawWoff2(honest, Compress(name, os2, new byte[100])),
            "a stream shorter than its tables" => RawWoff2([(5, Base128(name.Length + 100)), (6, Base128(os2.Length))], tables),
            "a stream cut short" => RawWoff2(honest, tables[..(tables.Length / 2)]),
            "a UIntBase128 past int range" => RawWoff2([(5, Base128(0x80000000L)), (6, Base128(os2.Length))], tables),
            "a UIntBase128 past 32 bits" => RawWoff2([(5, [0xFF, 0xFF, 0xFF, 0xFF, 0x7F]), (6, Base128(os2.Length))], tables),
            "declared lengths that overflow" => RawWoff2([(5, Base128(int.MaxValue)), (6, Base128(int.MaxValue))], tables),
            "declared lengths past 10 MB" => RawWoff2([(5, Base128(name.Length)), (6, Base128(TenMb))], tables),
            "a compressed length past the file" => RawWoff2(honest, tables, compressedLength: 0xFFFFFFF0),
            _ => throw new ArgumentOutOfRangeException(nameof(what)),
        };
    }

    private static byte[] Compress(params byte[][] parts)
    {
        using var compressed = new MemoryStream();
        using (var brotli = new BrotliStream(compressed, CompressionLevel.Fastest, leaveOpen: true))
        {
            foreach (var part in parts)
            {
                brotli.Write(part);
            }
        }

        return compressed.ToArray();
    }

    private static byte[] Base128(long value)
    {
        var bytes = new List<byte> { (byte)(value & 0x7F) };
        for (var rest = value >> 7; rest > 0; rest >>= 7)
        {
            bytes.Insert(0, (byte)(0x80 | (rest & 0x7F)));
        }

        return [.. bytes];
    }

    // A WOFF2 file of a raw table directory (known index or 0x3F with tag 'zzzz', then the length's bytes) and Brotli stream.
    private static byte[] RawWoff2(List<(int Flags, byte[] Length)> directory, byte[] stream, uint? compressedLength = null)
    {
        var bytes = new List<byte>();
        bytes.AddRange("wOF2"u8.ToArray());
        Put32(bytes, 0x00010000);
        Put32(bytes, 0);
        Put16(bytes, directory.Count);
        Put16(bytes, 0);
        Put32(bytes, 0);
        Put32(bytes, compressedLength ?? (uint)stream.Length);
        bytes.AddRange(new byte[24]);
        foreach (var (flags, length) in directory)
        {
            bytes.Add((byte)flags);
            if (flags == 0x3F)
            {
                bytes.AddRange("zzzz"u8.ToArray());
            }

            bytes.AddRange(length);
        }

        bytes.AddRange(stream);
        return [.. bytes];
    }

    private static void Put16(List<byte> bytes, int value)
    {
        bytes.Add((byte)(value >> 8));
        bytes.Add((byte)value);
    }

    private static void Put32(List<byte> bytes, uint value)
    {
        Put16(bytes, (int)(value >> 16));
        Put16(bytes, (int)(value & 0xFFFF));
    }

    private FontsController Controller(Guid caller, byte[]? body = null)
    {
        var context = new DefaultHttpContext();
        context.Request.Body = new MemoryStream(body ?? Sfnt(0x00010000, Tables("Charter", "Regular", 400, false)));
        return new(_store, new FakeAuthorization(caller), TimeProvider.System)
        {
            ControllerContext = new ControllerContext { HttpContext = context },
        };
    }

    // AuthorizationInfo.UserId comes from its User; no user means an anonymous caller.
    private sealed class FakeAuthorization(Guid userId) : IAuthorizationContext
    {
        public Task<AuthorizationInfo> GetAuthorizationInfo(HttpContext requestContext) => Task.FromResult(Info());

        public Task<AuthorizationInfo> GetAuthorizationInfo(HttpRequest requestContext) => Task.FromResult(Info());

        private AuthorizationInfo Info() => new()
        {
            User = userId.Equals(Guid.Empty) ? null : new User("reader", "provider", "reset") { Id = userId },
        };
    }
}
