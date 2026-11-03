"""Generate only redistributable ECDICT/WordNet + original-note offline entries."""
from pathlib import Path
import json
import sqlite3
import sys
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'server'))
from dictionary import normalize


def main():
    teaching = json.loads((ROOT / 'miniprogram/data/learning.json').read_text('utf-8'))
    words = list(teaching) + 'apple bank run set get take make go come give find think know say see work study learn word dictionary language grammar sentence noun verb adjective adverb subject object complement clause phrase article preposition conjunction book school student teacher friend help time day people person world home water food love good great beautiful right wrong can will should would could have be do read write speak listen understand meaning example definition'.split()
    words = list(dict.fromkeys(words))
    data, aliases = {}, {}
    database = ROOT.parent / 'output/dictionary.db'
    if not database.is_file():
        print('Using committed offline.js: optional local ECDICT/WordNet database is absent.')
        return
    with sqlite3.connect(database) as db:
        for word in words:
            row = db.execute('SELECT word,phonetic,zh,en,forms,tags FROM entries WHERE key=?', (normalize(word),)).fetchone()
            if not row and word not in teaching:
                continue
            entry = dict(zip(['word', 'phonetic', 'zh', 'en', 'formsRaw', 'tags'], row)) if row else {'word': word}
            entry.update(kind='entry', schema=1, source='builtin', teaching=teaching.get(word), oxford={'documents': 0, 'blocks': []}, related=teaching.get(word, {}).get('related', []))
            senses = db.execute('SELECT json FROM senses WHERE key=?', (normalize(word),)).fetchone()
            entry['senses'] = json.loads(senses[0]) if senses else []
            labels = {'p': '过去式', 'd': '过去分词', 'i': '现在分词', '3': '第三人称单数', 'r': '比较级', 't': '最高级', 's': '复数', '0': '原形'}
            entry['forms'] = []
            for item in (entry.pop('formsRaw', '') or '').split('/'):
                code, _, value = item.partition(':')
                if code in labels and value:
                    entry['forms'].append({'label': labels[code], 'word': value})
            data[normalize(word)] = entry
        for key, lemma in db.execute('SELECT key,lemma FROM aliases'):
            if lemma in data and key not in data:
                aliases[key] = lemma
    (ROOT / 'miniprogram/data/offline.js').write_text('// ECDICT (MIT), WordNet 3.1 and original learning notes only. No Oxford text.\nmodule.exports=' + json.dumps({'entries': data, 'aliases': aliases}, ensure_ascii=False, separators=(',', ':')) + ';\n', 'utf-8')
    folder = ROOT / 'miniprogram/assets'
    folder.mkdir(exist_ok=True)
    for name in ['search', 'bookmark', 'history']:
        for active in [False, True]:
            image = Image.new('RGBA', (81, 81), (0, 0, 0, 0)); draw = ImageDraw.Draw(image)
            color = '#267fbb' if active else '#8193a1'
            if name == 'search':
                draw.ellipse((13, 10, 55, 52), outline=color, width=5); draw.line((50, 47, 70, 67), fill=color, width=5)
            elif name == 'bookmark':
                draw.line([(21, 11), (60, 11), (60, 68), (40, 54), (21, 68), (21, 11)], fill=color, width=5)
            else:
                draw.ellipse((10, 10, 70, 70), outline=color, width=5); draw.line([(40, 24), (40, 42), (54, 48)], fill=color, width=5)
            image.save(folder / (name + ('-on' if active else '') + '.png'))
    print(json.dumps({'offline_entries': len(data), 'aliases': len(aliases), 'bytes': (ROOT / 'miniprogram/data/offline.js').stat().st_size}))


if __name__ == '__main__':
    main()
