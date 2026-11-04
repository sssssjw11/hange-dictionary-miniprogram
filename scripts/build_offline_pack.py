"""Build a private, random-access Oxford pack for WeChat's user-file storage.

The public code package never contains the supplied dictionary. Every shard is
under 48 MiB, and the extracted pack is checked against a 180 MiB budget.
"""
from array import array
from collections import defaultdict
from contextlib import closing
import hashlib
import html
import json
from pathlib import Path
import re
import sqlite3
import struct
import sys
import zipfile
import zlib

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'server'))
from dictionary import normalize
from oxford_summary import oxford_summary

PART_SIZE = 48 * 1024 * 1024


def bucket(text):
    value = 2166136261
    for byte in text.encode('utf-8'):
        value = ((value ^ byte) * 16777619) & 0xffffffff
    return value & 255


def deltas(values):
    output = bytearray(); previous = 0
    for value in values:
        number = value - previous; previous = value
        while number >= 128:
            output.append((number & 127) | 128); number >>= 7
        output.append(number)
    return output.hex()


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--database', type=Path, default=ROOT / 'server/data/oxford/oxford.db')
    parser.add_argument('--output', type=Path, default=ROOT / 'output/牛津十版-微信离线词库.zip')
    parser.add_argument('--rebuild', action='store_true', help='Replace only this script\'s previously generated artifacts')
    args = parser.parse_args()
    stage = args.output.parent / 'offline-pack-build'
    if (stage / 'manifest.json').exists():
        existing = json.loads((stage / 'manifest.json').read_text('utf-8'))
        if not args.rebuild or existing.get('format') != 'hange-oxford-pack':
            parser.error('Build folder already contains a completed pack; choose a new --output directory or --rebuild.')
    for name in ['parts', 'keys', 'docs', 'zh', 'prefix']:
        (stage / name).mkdir(parents=True, exist_ok=True)
    rows_by_key, compact_keys = defaultdict(list), defaultdict(set)
    doc_meta, source_docs, hashes, lengths = {}, {}, {}, bytearray()
    postings = defaultdict(lambda: array('I'))
    source_count = aliases = 0
    part_number, part_size = 0, 0
    part = (stage / 'parts/000.bin').open('wb')
    with closing(sqlite3.connect(args.database.resolve().as_uri() + '?mode=ro', uri=True)) as db:
        for identifier, key, compact, word, body, target in db.execute('SELECT id,key,compact,word,body,target FROM entries ORDER BY id'):
            compact_keys[compact].add(key)
            if target:
                aliases += 1; rows_by_key[key].append(('link', target))
                continue
            if body is None:
                continue
            source_count += 1
            fingerprint = hashlib.sha256(body).digest()
            if fingerprint in hashes:
                document = hashes[fingerprint]
            else:
                document = len(doc_meta); hashes[fingerprint] = document
                if part_size and part_size + len(body) > PART_SIZE:
                    part.close(); part_number += 1; part_size = 0
                    part = (stage / ('parts/%03d.bin' % part_number)).open('wb')
                part.write(body)
                text = zlib.decompress(body).decode('utf-8')
                translations = [html.unescape(re.sub('<[^>]*>', '', item)) for item in re.findall(r'<chn\b[^>]*>([\s\S]*?)</chn>', text, re.I)]
                brief = oxford_summary(text)
                doc_meta[document] = [part_number, part_size, len(body), word, brief]
                lengths.append(min(len(word), 255))
                part_size += len(body)
                grams = set()
                for translation in translations:
                    for phrase in re.findall('[\u3400-\u9fff]+', translation):
                        grams.update(phrase[index:index+2] for index in range(len(phrase)-1))
                for gram in grams:
                    postings[gram].append(document)
            source_docs[identifier] = document
            rows_by_key[key].append(('doc', document))
        metadata = dict(db.execute('SELECT key,value FROM metadata'))
    part.close()

    def keys_for(value):
        key = normalize(value)
        if key in rows_by_key:
            return [key]
        compact = ''.join(char for char in key if char.isalnum())
        found = compact_keys.get(compact)
        if found:
            return sorted(found)
        if '#' in key:
            return keys_for(key.split('#', 1)[0])
        return []

    resolved, active = {}, set()
    def resolve(key):
        if key in resolved:
            return resolved[key]
        if key in active:
            return ()
        active.add(key); documents = set()
        for kind, value in rows_by_key[key]:
            if kind == 'doc':
                documents.add(value)
            else:
                for target in keys_for(value):
                    documents.update(resolve(target))
        active.remove(key)
        result = tuple(sorted(documents))
        if result:
            resolved[key] = result
        return result

    shards = [dict() for _ in range(256)]
    missing = []
    for key in rows_by_key:
        documents = resolve(key)
        if not documents:
            missing.append(key)
        else:
            shards[bucket(key)][key] = documents
    for compact, keys in compact_keys.items():
        documents = sorted({document for key in keys for document in resolved.get(key, ())})
        if documents:
            marker = '\x01' + compact
            shards[bucket(marker)][marker] = documents
    if missing:
        raise ValueError('Unresolved dictionary keys: ' + repr(missing[:12]))
    for index, values in enumerate(shards):
        (stage / ('keys/%02x.json' % index)).write_text(json.dumps(values, ensure_ascii=False, separators=(',', ':')), 'utf-8')
    for start in range(0, len(doc_meta), 512):
        values = {str(index): doc_meta[index] for index in range(start, min(start+512, len(doc_meta)))}
        (stage / ('docs/%03d.json' % (start//512))).write_text(json.dumps(values, ensure_ascii=False, separators=(',', ':')), 'utf-8')
    prefixes=[defaultdict(list) for _ in range(256)]
    for identifier,row in doc_meta.items():
        word=normalize(row[3])
        if word:prefixes[bucket(word[0])][word[0]].append([row[3],identifier])
    for index,values in enumerate(prefixes):
        for first,items in values.items():items.sort(key=lambda row:(len(row[0]),normalize(row[0])))
        (stage/('prefix/%02x.json'%index)).write_text(json.dumps(values,ensure_ascii=False,separators=(',',':')),'utf-8')
    (stage / 'lengths.bin').write_bytes(lengths)
    zh = [dict() for _ in range(256)]
    for gram, identifiers in postings.items():
        zh[bucket(gram)][gram] = deltas(identifiers)
    for index, values in enumerate(zh):
        content = json.dumps(values, ensure_ascii=False, separators=(',', ':')).encode()
        (stage / ('zh/%02x.z' % index)).write_bytes(zlib.compress(content, 9))
    (stage / 'NOTICE.txt').write_text('Source: user-provided local MDX. Dictionary text remains the property of its original rightsholders. No audio or image resources were supplied. This private pack is excluded from the public repository.\n', 'utf-8')
    files = {}
    for file in sorted(stage.rglob('*')):
        if file.is_file() and file.name != 'manifest.json':
            with file.open('rb') as input_file:
                digest = hashlib.file_digest(input_file, 'sha256').hexdigest()
            files[file.relative_to(stage).as_posix()] = {'bytes': file.stat().st_size, 'sha256': digest}
    total = sum(value['bytes'] for value in files.values())
    if total > 180*1024*1024:
        raise ValueError('Extracted pack exceeds the reserved 180 MiB user-file budget: ' + str(total))
    manifest = {'format': 'hange-oxford-pack', 'version': 1, 'title': '牛津高阶英汉双解 · 第10版', 'edition': metadata.get('edition', ''), 'sourceSha256': metadata.get('source_sha256', ''), 'definitionRecords': source_count, 'redirectRecords': aliases, 'uniqueDocuments': len(doc_meta), 'lookupKeys': len(resolved), 'compactIndex': True, 'prefixIndex':True, 'summaryVersion':2, 'buckets': 256, 'documentShardSize': 512, 'chineseBigrams': len(postings), 'extractedBytes': total, 'files': files}
    (stage / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')), 'utf-8')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for file in sorted(stage.rglob('*')):
            if file.is_file():
                mode = zipfile.ZIP_STORED if file.suffix in ['.bin', '.z'] else zipfile.ZIP_DEFLATED
                archive.write(file, file.relative_to(stage).as_posix(), compress_type=mode)
    volumes = []
    index_path = args.output.parent / '牛津十版-微信离线词库-索引.zip'
    with zipfile.ZipFile(index_path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for file in sorted(stage.rglob('*')):
            if file.is_file() and file.parent.name != 'parts':
                archive.write(file, file.relative_to(stage).as_posix())
    volumes.append({'name': index_path.name, 'bytes': index_path.stat().st_size})
    for number, file in enumerate(sorted((stage / 'parts').glob('*.bin')), 1):
        destination = args.output.parent / ('牛津十版-微信离线词库-数据%d.zip' % number)
        with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_STORED) as archive:
            archive.write(file, file.relative_to(stage).as_posix())
        volumes.append({'name': destination.name, 'bytes': destination.stat().st_size})
    assert all(volume['bytes'] < 96*1024*1024 for volume in volumes)
    report = {key: value for key, value in manifest.items() if key != 'files'}
    report.update(zipBytes=args.output.stat().st_size, volumes=volumes, allRedirectsResolved=True)
    (args.output.parent / 'offline-pack-verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), 'utf-8')
    print(json.dumps(report, ensure_ascii=True))


if __name__ == '__main__':
    main()
