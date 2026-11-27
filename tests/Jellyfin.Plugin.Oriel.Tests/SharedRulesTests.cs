using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using Jellyfin.Plugin.Oriel.Controllers;
using Jellyfin.Plugin.Oriel.Data;
using Jellyfin.Plugin.Oriel.Integration;
using Xunit;

namespace Jellyfin.Plugin.Oriel.Tests;

public sealed class SharedRulesTests
{
    [Fact]
    public void OneRecordAnswersEveryRefusal()
    {
        var reasons = typeof(Plugin).Assembly.GetTypes()
            .Where(type => type.GetProperties().Any(property => property.GetCustomAttribute<JsonPropertyNameAttribute>()?.Name == "reason"))
            .ToList();

        Assert.Equal([typeof(RequestRefusal)], reasons);
    }

    [Theory]
    [InlineData(1000)]
    [InlineData(81_920)]
    [InlineData(300_001)]
    public async Task ReadsABodyAtItsLimit(int limit)
    {
        var data = Enumerable.Range(0, limit).Select(i => (byte)i).ToArray();

        Assert.Equal(data, await LimitedBody.ReadAsync(new MemoryStream(data), limit));
    }

    [Fact]
    public async Task RefusesABodyOneBytePastItsLimit()
    {
        Assert.Null(await LimitedBody.ReadAsync(new MemoryStream(new byte[1001]), 1000));
        Assert.NotNull(await LimitedBody.ReadAsync(new MemoryStream(new byte[1000]), 1000));
    }

    [Theory]
    [InlineData(null, "")]
    [InlineData("", "")]
    [InlineData("  ", "")]
    [InlineData("/", "")]
    [InlineData("jf", "/jf")]
    [InlineData("/jf", "/jf")]
    [InlineData("/jf/", "/jf")]
    [InlineData(" jf/ ", "/jf")]
    [InlineData("media/books", "/media/books")]
    public void WritesTheBaseUrlAsAPathStart(string? baseUrl, string root)
    {
        Assert.Equal(root, BaseUrl.Root(baseUrl));
    }

    [Theory]
    [InlineData("", false)]
    [InlineData("epubcfi(/6/2!/4/2/1:0)", true)]
    public void ChecksACfi(string cfi, bool kept)
    {
        Assert.Equal(kept, ReadingRules.IsCfi(cfi));
        Assert.False(ReadingRules.IsCfi(null));
        Assert.True(ReadingRules.IsCfi(new string('c', ReadingRules.MaxCfiLength)));
        Assert.False(ReadingRules.IsCfi(new string('c', ReadingRules.MaxCfiLength + 1)));
    }

    [Fact]
    public void ChecksTextAndNotesAtTheirLimits()
    {
        Assert.True(ReadingRules.IsBookmarkText(string.Empty));
        Assert.True(ReadingRules.IsBookmarkText(new string('t', ReadingRules.MaxBookmarkTextLength)));
        Assert.False(ReadingRules.IsBookmarkText(new string('t', ReadingRules.MaxBookmarkTextLength + 1)));
        Assert.False(ReadingRules.IsBookmarkText(null));
        Assert.True(ReadingRules.IsHighlightText(new string('t', ReadingRules.MaxHighlightTextLength)));
        Assert.False(ReadingRules.IsHighlightText(new string('t', ReadingRules.MaxHighlightTextLength + 1)));
        Assert.False(ReadingRules.IsHighlightText(null));
        Assert.True(ReadingRules.IsNote(null));
        Assert.True(ReadingRules.IsNote(new string('n', ReadingRules.MaxNoteLength)));
        Assert.False(ReadingRules.IsNote(new string('n', ReadingRules.MaxNoteLength + 1)));
    }
}
