using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Threading.Tasks;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.Oriel.Controllers;
using Jellyfin.Plugin.Oriel.Data;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Xunit;

namespace Jellyfin.Plugin.Oriel.Tests;

public sealed class DictionaryControllerTests
{
    // The plugin's own copy, loaded once for every test.
    private static readonly EnglishDictionary Dictionary = new();

    [Fact]
    public void CarriesWordNetsLicenceInThePlugin()
    {
        using var file = typeof(EnglishDictionary).Assembly.GetManifestResourceStream("oriel-dictionary/wordnet.txt.gz")!;
        using var text = new StreamReader(new GZipStream(file, CompressionMode.Decompress));
        var head = string.Join('\n', Enumerable.Range(0, 32).Select(_ => text.ReadLine()));

        Assert.StartsWith("@licence\n", head, StringComparison.Ordinal);
        Assert.Contains("WordNet 3.1 Copyright 2011 by Princeton University.", head, StringComparison.Ordinal);
    }

    [Fact]
    public void DefinesAWordWithItsSensesInWordNetsOrder()
    {
        var entry = Assert.Single(Dictionary.Lookup("universally"));

        Assert.Equal(("universally", "adverb"), (entry.Word, entry.PartOfSpeech));
        Assert.Equal("Everywhere.", entry.Senses[0]);
    }

    [Fact]
    public void GivesEachPartOfSpeechNounsFirst()
    {
        var entries = Dictionary.Lookup("mouse");

        Assert.Equal(["noun", "verb"], entries.Select(e => e.PartOfSpeech));
        Assert.All(entries, e => Assert.Equal("mouse", e.Word));
        Assert.Equal(4, entries[0].Senses.Count);
        Assert.StartsWith("Any of numerous small rodents", entries[0].Senses[0], StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("acknowledged", "acknowledge", "verb")]
    [InlineData("mice", "mouse", "noun")]
    [InlineData("went", "go", "verb")]
    [InlineData("churches", "church", "noun")]
    [InlineData("happiest", "happy", "adjective")]
    [InlineData("running", "run", "verb")]
    public void FindsAnInflectedWordByItsBaseForm(string word, string baseForm, string partOfSpeech)
    {
        Assert.Contains(Dictionary.Lookup(word), e => e.Word == baseForm && e.PartOfSpeech == partOfSpeech);
    }

    [Theory]
    [InlineData("in vain")]
    [InlineData("  In   Vain, ")]
    [InlineData("“in vain”")]
    public void FindsAPhraseWhole(string phrase)
    {
        var entry = Assert.Single(Dictionary.Lookup(phrase));

        Assert.Equal(("in vain", "adverb"), (entry.Word, entry.PartOfSpeech));
    }

    [Theory]
    [InlineData("Darcy's")]
    [InlineData("qwxzt")]
    [InlineData("...")]
    public void HasNothingForAWordItDoesNotHold(string word)
    {
        Assert.Empty(Dictionary.Lookup(word));
    }

    [Fact]
    public void LooksAWordUpInUnderFiftyMilliseconds()
    {
        Dictionary.Lookup("warm");
        var words = new[] { "acknowledged", "mice", "universally", "in vain", "possession", "fortune", "qwxzt", "running" };

        foreach (var word in words)
        {
            var clock = Stopwatch.StartNew();
            Dictionary.Lookup(word);
            Assert.True(clock.ElapsedMilliseconds < 50, $"{word} took {clock.ElapsedMilliseconds} ms");
        }
    }

    [Fact]
    public async Task AnswersWithTheWordAsFoundAndItsEntries()
    {
        var response = (await Controller(Guid.NewGuid()).GetDefinition("acknowledged")).Value!;

        Assert.Equal("acknowledge", response.Word);
        Assert.Equal(("acknowledge", "verb"), (response.Entries[0].Word, response.Entries[0].PartOfSpeech));
        Assert.Contains(response.Entries, e => e.Word == "acknowledged" && e.PartOfSpeech == "adjective");
    }

    [Fact]
    public async Task ReturnsNotFoundForAWordItDoesNotHold()
    {
        Assert.IsType<NotFoundResult>((await Controller(Guid.NewGuid()).GetDefinition("qwxzt")).Result);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("?!")]
    public async Task ReturnsBadRequestWithoutAWord(string? word)
    {
        Assert.IsType<BadRequestResult>((await Controller(Guid.NewGuid()).GetDefinition(word)).Result);
    }

    [Fact]
    public async Task ReturnsBadRequestForMoreThanSixtyFourCharacters()
    {
        Assert.IsType<BadRequestResult>((await Controller(Guid.NewGuid()).GetDefinition(new string('a', 65))).Result);
        Assert.IsType<NotFoundResult>((await Controller(Guid.NewGuid()).GetDefinition(new string('a', 64))).Result);
    }

    [Fact]
    public async Task ReturnsUnauthorizedWithoutACaller()
    {
        Assert.IsType<UnauthorizedResult>((await Controller(Guid.Empty).GetDefinition("mouse")).Result);
    }

    private static DictionaryController Controller(Guid caller) =>
        new(new FakeAuthorization(caller), Dictionary)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };

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
