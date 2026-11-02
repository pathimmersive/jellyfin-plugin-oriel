#!/usr/bin/env python3
"""Builds the plugin's English dictionary from Princeton's WordNet 3.1.

Downloads WordNet's database (or reads the tarball given as the first argument),
checks it against the SHA-256 below, and writes the words, their definitions and
WordNet's lists of irregular forms to
src/Jellyfin.Plugin.Oriel/Data/wordnet.txt.gz, which the plugin embeds.
The output is committed, so a build needs no network; run this again only to
change what the file holds.

The file is UTF-8 text in four sections:

    @licence      WordNet's licence, as its own files carry it, so every copy has it
    @synsets      one definition per line; a word's senses refer to these by line number
    @words        word<TAB>pos:index,index;pos:index,...   senses in WordNet's order
    @exceptions   pos<TAB>irregular form<TAB>base form[ base form...]

pos is n, v, a or r (noun, verb, adjective, adverb). Words are lower case with
spaces between the words of a phrase.
"""

import gzip
import hashlib
import io
import pathlib
import re
import sys
import tarfile
import urllib.request

URL = 'https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz'
SHA256 = '3f7d8be8ef6ecc7167d39b10d66954ec734280b5bdcd57f7d9eafe429d11c22a'
OUT = pathlib.Path(__file__).resolve().parent.parent / 'src' / 'Jellyfin.Plugin.Oriel' / 'Data' / 'wordnet.txt.gz'
POS = {'noun': 'n', 'verb': 'v', 'adj': 'a', 'adv': 'r'}


def definition(gloss):
    """The definition part of a WordNet gloss, without its quoted examples, as a sentence."""
    parts = []
    for part in gloss.split('; '):
        if part.startswith('"'):
            break
        parts.append(part)
    text = '; '.join(parts).strip() or gloss.strip()
    text = text[0].upper() + text[1:]
    return text if text[-1] in '.?!' else text + '.'


def main():
    if len(sys.argv) > 1:
        data = pathlib.Path(sys.argv[1]).read_bytes()
    else:
        with urllib.request.urlopen(URL) as response:
            data = response.read()
    digest = hashlib.sha256(data).hexdigest()
    if digest != SHA256:
        sys.exit(f'build-dictionary: the download has SHA-256 {digest}, not {SHA256}')

    files = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as tar:
        for member in tar.getmembers():
            name = member.name.rsplit('/', 1)[-1]
            if member.isfile() and (name.startswith(('data.', 'index.')) or name.endswith('.exc')):
                files[name] = tar.extractfile(member).read().decode('utf-8')

    # The licence heads every WordNet data file, as numbered lines starting with two spaces.
    licence = [re.sub(r'^  \d+ ', '', line).rstrip() for line in files['data.noun'].splitlines() if line.startswith('  ')]
    assert any('Princeton University' in line for line in licence)

    glosses = []
    synset = {}
    for pos, code in POS.items():
        for line in files[f'data.{pos}'].splitlines():
            if line.startswith('  '):
                continue
            offset, _, rest = line.partition(' ')
            gloss = rest.split(' | ', 1)[1] if ' | ' in rest else ''
            synset[(code, offset)] = len(glosses)
            glosses.append(definition(gloss) if gloss.strip() else '')

    words = {}
    for pos, code in POS.items():
        for line in files[f'index.{pos}'].splitlines():
            if line.startswith('  '):
                continue
            fields = line.split()
            lemma, count = fields[0], int(fields[2])
            pointers = int(fields[3])
            senses = int(fields[4 + pointers])
            offsets = fields[6 + pointers:6 + pointers + senses]
            assert senses == count and len(offsets) == senses, line
            indexes = [synset[(code, offset)] for offset in offsets if glosses[synset[(code, offset)]]]
            if indexes:
                words.setdefault(lemma.replace('_', ' '), []).append(f'{code}:' + ','.join(map(str, indexes)))

    exceptions = []
    for pos, code in POS.items():
        for line in files[f'{pos}.exc'].splitlines():
            fields = line.split()
            if len(fields) >= 2:
                exceptions.append('\t'.join([code, fields[0].replace('_', ' '), ' '.join(f.replace('_', ' ') for f in fields[1:])]))

    text = io.StringIO()
    text.write('@licence\n')
    for line in licence:
        text.write(line + '\n')
    text.write('@synsets\n')
    for gloss in glosses:
        text.write(gloss + '\n')
    text.write('@words\n')
    for lemma in sorted(words):
        text.write(lemma + '\t' + ';'.join(words[lemma]) + '\n')
    text.write('@exceptions\n')
    for line in exceptions:
        text.write(line + '\n')

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, 'wb') as out:
        with gzip.GzipFile(filename='', mode='wb', fileobj=out, compresslevel=9, mtime=0) as gz:
            gz.write(text.getvalue().encode('utf-8'))
    print(f'build-dictionary: {len(words)} words, {len(glosses)} definitions, {len(exceptions)} irregular forms; {OUT.stat().st_size} bytes')


if __name__ == '__main__':
    main()
