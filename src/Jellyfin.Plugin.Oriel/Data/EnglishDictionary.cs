using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.Oriel.Data;

/// <summary>
/// The senses one word has as one part of speech.
/// </summary>
/// <param name="Word">The word as the dictionary holds it, which may be the base form of the word looked up.</param>
/// <param name="PartOfSpeech">noun, verb, adjective or adverb.</param>
/// <param name="Senses">The definitions, most common first.</param>
public sealed record DictionaryEntry(
    [property: JsonPropertyName("word")] string Word,
    [property: JsonPropertyName("partOfSpeech")] string PartOfSpeech,
    [property: JsonPropertyName("senses")] IReadOnlyList<string> Senses);

/// <summary>
/// The English dictionary the plugin carries: Princeton's WordNet 3.1, built into
/// wordnet.txt.gz by scripts/build-dictionary.py and read on first use.
/// </summary>
public sealed class EnglishDictionary
{
    /// <summary>
    /// The longest word or phrase a lookup accepts.
    /// </summary>
    public const int MaxLength = 64;

    private const string ResourceName = "oriel-dictionary/wordnet.txt.gz";

    private static readonly (char Code, string Name)[] PartsOfSpeech = [('n', "noun"), ('v', "verb"), ('a', "adjective"), ('r', "adverb")];

    // WordNet's detachment rules: an ending to take off and the one to put back.
    private static readonly (char Code, string Suffix, string Ending)[] Rules =
    [
        ('n', "s", string.Empty), ('n', "ses", "s"), ('n', "xes", "x"), ('n', "zes", "z"),
        ('n', "ches", "ch"), ('n', "shes", "sh"), ('n', "men", "man"), ('n', "ies", "y"),
        ('v', "s", string.Empty), ('v', "ies", "y"), ('v', "es", "e"), ('v', "es", string.Empty),
        ('v', "ed", "e"), ('v', "ed", string.Empty), ('v', "ing", "e"), ('v', "ing", string.Empty),
        ('a', "er", string.Empty), ('a', "est", string.Empty), ('a', "er", "e"), ('a', "est", "e"),
    ];

    private readonly Lazy<Contents> _contents;

    /// <summary>
    /// Initializes a new instance of the <see cref="EnglishDictionary"/> class from the plugin's own copy.
    /// </summary>
    public EnglishDictionary()
        : this(() => typeof(EnglishDictionary).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException($"The plugin has no {ResourceName}."))
    {
    }

    /// <summary>
    /// Initializes a new instance of the <see cref="EnglishDictionary"/> class from a gzipped dictionary file.
    /// </summary>
    /// <param name="open">Opens the file.</param>
    public EnglishDictionary(Func<Stream> open)
    {
        _contents = new Lazy<Contents>(() => Contents.Read(open));
    }

    /// <summary>
    /// A word as the dictionary keys it: lower case, single spaces, no punctuation around it.
    /// </summary>
    /// <param name="word">The word or phrase as selected.</param>
    /// <returns>The key, empty when nothing of a word is left.</returns>
    public static string Normalize(string? word)
    {
        var text = (word ?? string.Empty).Replace('’', '\'').Replace('‘', '\'').Replace('_', ' ');
        text = string.Join(' ', text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        int start = 0, end = text.Length;
        while (start < end && !char.IsLetterOrDigit(text[start]))
        {
            start++;
        }

        while (end > start && !char.IsLetterOrDigit(text[end - 1]))
        {
            end--;
        }

        return text[start..end].ToLowerInvariant();
    }

    /// <summary>
    /// Looks a word up as each part of speech, by its base form when it is inflected.
    /// </summary>
    /// <param name="word">The word or phrase as selected.</param>
    /// <returns>Its entries, nouns first then verbs, adjectives and adverbs; empty when the dictionary has none.</returns>
    public IReadOnlyList<DictionaryEntry> Lookup(string? word)
    {
        var key = Normalize(word);
        if (key.Length == 0)
        {
            return [];
        }

        var contents = _contents.Value;
        var entries = new List<DictionaryEntry>();
        foreach (var (code, name) in PartsOfSpeech)
        {
            foreach (var form in BaseForms(contents, key, code))
            {
                var senses = contents.Senses(form, code);
                if (senses.Count > 0)
                {
                    entries.Add(new DictionaryEntry(form, name, senses));
                }
            }
        }

        return entries;
    }

    // The word itself, WordNet's irregular forms for it, then what each rule gives, kept when the dictionary holds them.
    private static IEnumerable<string> BaseForms(Contents contents, string key, char code)
    {
        var forms = new List<string> { key };
        if (contents.Exceptions.TryGetValue((code, key), out var irregular))
        {
            forms.AddRange(irregular);
        }

        foreach (var (rule, suffix, ending) in Rules)
        {
            if (rule == code && key.Length > suffix.Length && key.EndsWith(suffix, StringComparison.Ordinal))
            {
                forms.Add(key[..^suffix.Length] + ending);
            }
        }

        return forms.Distinct(StringComparer.Ordinal);
    }

    private sealed class Contents
    {
        private readonly byte[] _text;
        private readonly int[] _synsets;
        private readonly int[] _words;

        private Contents(byte[] text, int[] synsets, int[] words, Dictionary<(char, string), string[]> exceptions)
        {
            _text = text;
            _synsets = synsets;
            _words = words;
            Exceptions = exceptions;
        }

        public Dictionary<(char Code, string Form), string[]> Exceptions { get; }

        public static Contents Read(Func<Stream> open)
        {
            byte[] text;
            using (var file = open())
            using (var gzip = new GZipStream(file, CompressionMode.Decompress))
            using (var buffer = new MemoryStream())
            {
                gzip.CopyTo(buffer);
                text = buffer.ToArray();
            }

            var synsets = new List<int>();
            var words = new List<int>();
            var exceptions = new Dictionary<(char, string), string[]>();
            List<int>? section = null;
            var inExceptions = false;
            for (var start = 0; start < text.Length;)
            {
                var end = Array.IndexOf(text, (byte)'\n', start);
                end = end < 0 ? text.Length : end;
                if (text[start] == (byte)'@')
                {
                    var name = Encoding.UTF8.GetString(text, start, end - start);
                    section = name == "@synsets" ? synsets : name == "@words" ? words : null;
                    inExceptions = name == "@exceptions";
                }
                else if (section is not null)
                {
                    section.Add(start);
                }
                else if (inExceptions)
                {
                    var fields = Encoding.UTF8.GetString(text, start, end - start).Split('\t');
                    exceptions[(fields[0][0], fields[1])] = fields[2].Split(' ');
                }

                start = end + 1;
            }

            return new Contents(text, [.. synsets], [.. words], exceptions);
        }

        // The definitions a word has as one part of speech, found by a binary search of the sorted words.
        public IReadOnlyList<string> Senses(string word, char code)
        {
            var key = Encoding.UTF8.GetBytes(word);
            int low = 0, high = _words.Length - 1;
            while (low <= high)
            {
                var middle = (low + high) / 2;
                var order = Compare(key, _words[middle]);
                if (order == 0)
                {
                    return SensesOn(_words[middle] + key.Length + 1, code);
                }

                if (order < 0)
                {
                    high = middle - 1;
                }
                else
                {
                    low = middle + 1;
                }
            }

            return [];
        }

        // Orders a key against the word at the start of a line, which ends at its tab.
        private int Compare(byte[] key, int line)
        {
            for (var i = 0; ; i++)
            {
                var b = _text[line + i];
                var ended = b == (byte)'\t';
                if (i == key.Length)
                {
                    return ended ? 0 : -1;
                }

                if (ended)
                {
                    return 1;
                }

                if (key[i] != b)
                {
                    return key[i] < b ? -1 : 1;
                }
            }
        }

        // The line's senses for one part of speech: n:1,2;v:3 lists synset numbers by part of speech.
        private List<string> SensesOn(int start, char code)
        {
            var end = Array.IndexOf(_text, (byte)'\n', start);
            var groups = Encoding.ASCII.GetString(_text, start, end - start).Split(';');
            var senses = new List<string>();
            foreach (var group in groups)
            {
                if (group[0] == code)
                {
                    foreach (var number in group[2..].Split(','))
                    {
                        senses.Add(Line(_synsets[int.Parse(number, System.Globalization.CultureInfo.InvariantCulture)]));
                    }
                }
            }

            return senses;
        }

        private string Line(int start)
        {
            var end = Array.IndexOf(_text, (byte)'\n', start);
            return Encoding.UTF8.GetString(_text, start, end - start);
        }
    }
}
