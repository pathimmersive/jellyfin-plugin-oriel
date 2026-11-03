using System;
using System.Collections.Generic;
using System.Net.Mime;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using Jellyfin.Plugin.Oriel.Data;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Oriel.Controllers;

/// <summary>
/// Defines words from the English dictionary the plugin carries, with no request to any other host.
/// </summary>
[ApiController]
[Route("Oriel/Dictionary")]
[Authorize]
public class DictionaryController : ControllerBase
{
    private readonly IAuthorizationContext _authorizationContext;
    private readonly EnglishDictionary _dictionary;

    /// <summary>
    /// Initializes a new instance of the <see cref="DictionaryController"/> class.
    /// </summary>
    /// <param name="authorizationContext">The host authorization context.</param>
    /// <param name="dictionary">The dictionary.</param>
    public DictionaryController(IAuthorizationContext authorizationContext, EnglishDictionary dictionary)
    {
        _authorizationContext = authorizationContext;
        _dictionary = dictionary;
    }

    /// <summary>
    /// Gets a word's definitions, by its base form when it is inflected.
    /// </summary>
    /// <param name="word">The word or short phrase, at most 64 characters.</param>
    /// <returns>The word as found and its senses by part of speech.</returns>
    [HttpGet]
    [Produces(MediaTypeNames.Application.Json)]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<DictionaryResponse>> GetDefinition([FromQuery] string? word)
    {
        var info = await _authorizationContext.GetAuthorizationInfo(HttpContext).ConfigureAwait(false);
        if (info.UserId.Equals(Guid.Empty))
        {
            return Unauthorized();
        }

        if (word is null || word.Length > EnglishDictionary.MaxLength || EnglishDictionary.Normalize(word).Length == 0)
        {
            return BadRequest();
        }

        var entries = _dictionary.Lookup(word);
        return entries.Count == 0 ? NotFound() : new DictionaryResponse(entries[0].Word, entries);
    }

    /// <summary>
    /// A word's definitions as <see cref="GetDefinition"/> returns them.
    /// </summary>
    /// <param name="Word">The word as found: the first entry's.</param>
    /// <param name="Entries">Its senses by part of speech.</param>
    public record DictionaryResponse(
        [property: JsonPropertyName("word")] string Word,
        [property: JsonPropertyName("entries")] IReadOnlyList<DictionaryEntry> Entries);
}
