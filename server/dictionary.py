"""Read-only dictionary engine. No publisher downloads or user-account database."""
from __future__ import annotations
from collections import deque
from contextlib import closing, nullcontext
from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import unicodedata
from urllib.parse import unquote
import zlib

from bs4 import BeautifulSoup, Comment, NavigableString

ROOT = Path(__file__).resolve().parents[1]


def normalize(value):
    return ' '.join(unicodedata.normalize('NFC', value).replace('_', ' ').replace('’', "'").lower().split())


def connect(path):
    return sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True, timeout=5)


def find_data():
    configured = os.environ.get('HANGE_DICT_DATA_DIR')
    candidates = [Path(configured)] if configured else [ROOT / 'server/data', ROOT.parent / 'output']
    for folder in candidates:
        if (folder / 'dictionary.db').is_file() or (folder / 'oxford/oxford.db').is_file():
            return folder
    return candidates[0]


class Engine:
    def __init__(self, folder=None):
        self.folder = Path(folder) if folder else find_data()
        self.base = self.folder / 'dictionary.db'
        self.oxford = self.folder / 'oxford/oxford.db'
        self.chinese_index = self.folder / 'oxford/chinese.db'
        self.oxford_chinese = False
        if self.chinese_index.is_file() and self.oxford.is_file():
            try:
                with closing(connect(self.chinese_index)) as index, closing(connect(self.oxford)) as source:
                    self.oxford_chinese = index.execute("SELECT value FROM metadata WHERE key='source_sha256'").fetchone() == source.execute("SELECT value FROM metadata WHERE key='source_sha256'").fetchone()
            except sqlite3.Error:
                self.oxford_chinese = False
        self.teaching = json.loads((ROOT / 'miniprogram/data/learning.json').read_text('utf-8'))
        self.counts = {'base': 0, 'oxford': 0}
        for name, file in [('base', self.base), ('oxford', self.oxford)]:
            if file.is_file():
                with closing(connect(file)) as db:
                    self.counts[name] = db.execute('SELECT count(*) FROM entries' + (' WHERE body IS NOT NULL' if name == 'oxford' else '')).fetchone()[0]

    def status(self):
        return {'ready': self.base.is_file() or self.oxford.is_file(), 'oxford': self.oxford.is_file(),
                'baseEntries': self.counts['base'],
                'oxfordDefinitions': self.counts['oxford'],
                'oxfordChineseIndex': self.oxford_chinese, 'version': '2.0.0'}

    def _oxford(self, word):
        if not self.oxford.is_file():
            return []
        pending, visited, seen, pages = deque([word]), set(), set(), []
        with closing(connect(self.oxford)) as db:
            while pending:
                request = pending.popleft()
                key = normalize(request)
                if key in visited:
                    continue
                visited.add(key)
                if len(visited) > 1024:
                    raise ValueError('词库跳转链异常')
                rows = db.execute('SELECT id,word,body,target FROM entries WHERE key=? ORDER BY id', (key,)).fetchall()
                if not rows:
                    compact = ''.join(char for char in key if char.isalnum())
                    rows = db.execute('SELECT id,word,body,target FROM entries WHERE compact=? ORDER BY id', (compact,)).fetchall()
                if not rows and '#' in request:
                    pending.append(request.split('#', 1)[0])
                for identifier, headword, body, target in rows:
                    if target:
                        pending.append(target)
                    elif body is not None:
                        content = zlib.decompress(body).decode('utf-8')
                        digest = hashlib.sha256(content.encode()).digest()
                        if digest not in seen:
                            seen.add(digest)
                            pages.append((identifier, headword, content))
        return pages

    def suggest(self, word):
        key = normalize(word)
        if not key or len(key) > 128 or re.search('[\u3400-\u9fff]', key):
            return []
        result, seen = [], set()
        with (closing(connect(self.base)) if self.base.is_file() else nullcontext(None)) as db:
            if self.oxford.is_file():
                with closing(connect(self.oxford)) as oxford:
                    for (headword,) in oxford.execute('SELECT word FROM entries WHERE key>=? AND key<? AND body IS NOT NULL ORDER BY length(key),key LIMIT 10', (key, key + '\uffff')):
                        normalized = normalize(headword)
                        if normalized in seen:
                            continue
                        seen.add(normalized)
                        brief = db.execute('SELECT zh FROM entries WHERE key=?', (normalized,)).fetchone() if db else None
                        result.append({'word': headword, 'meaning': brief[0] if brief and brief[0] else '牛津十版词条'})
            if db:
                for headword, zh in db.execute('SELECT word,zh FROM entries WHERE key>=? AND key<? ORDER BY length(key),key LIMIT 20', (key, key + '\uffff')):
                    if normalize(headword) not in seen and len(result) < 10:
                        seen.add(normalize(headword))
                        result.append({'word': headword, 'meaning': zh})
        return result

    def chinese(self, term):
        result = [{'word': word, 'meaning': note['title']} for word, note in self.teaching.items()
                  if len(term) >= 2 and term in json.dumps(note, ensure_ascii=False)]
        seen = {row['word'] for row in result}
        if self.oxford_chinese and len(term)>=2:
            grams=set()
            for phrase in re.findall('[\u3400-\u9fff]+',term):grams.update(phrase[offset:offset+2] for offset in range(len(phrase)-1))
            if grams:
                query=' AND '.join('"'+gram+'"' for gram in sorted(grams))
                with closing(connect(self.chinese_index)) as index,closing(connect(self.oxford)) as source:
                    rows=index.execute('SELECT d.id,d.word,d.brief FROM search JOIN documents d ON d.id=search.rowid WHERE search MATCH ? ORDER BY CASE WHEN d.brief=? THEN 0 WHEN d.brief LIKE ? THEN 1 ELSE 2 END,d.length,length(d.word),d.word',(query,term,term+'%'))
                    for identifier,word,brief in rows:
                        if word in seen:continue
                        body=source.execute('SELECT body FROM entries WHERE id=?',(identifier,)).fetchone()[0]
                        text=BeautifulSoup(zlib.decompress(body).decode(),'html.parser').get_text()
                        if term in text:seen.add(word);result.append({'word':word,'meaning':brief})
                        if len(result)>=40:break
        if not self.base.is_file():
            return result[:40]
        escaped = term.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
        with closing(connect(self.base)) as db:
            rows = db.execute("SELECT word,zh FROM entries WHERE zh LIKE ? ESCAPE '\\' ORDER BY CASE WHEN zh=? OR zh LIKE ? THEN 0 ELSE 1 END,CASE WHEN substr(zh,1,1)='[' THEN 1 ELSE 0 END,length(word),word LIMIT 40", ('%' + escaped + '%', term, 'n. ' + escaped + '%'))
            for word, zh in rows:
                if word not in seen and len(result) < 40:
                    seen.add(word)
                    result.append({'word': word, 'meaning': zh})
        return result[:40]

    @lru_cache(maxsize=128)
    def lookup(self, requested):
        requested = requested.strip()
        if not requested or len(requested) > 256 or '\x00' in requested:
            raise ValueError('请输入 1～256 字的单词或短语')
        key = normalize(requested)
        if not self.base.is_file() and not self.oxford.is_file():
            raise FileNotFoundError('未找到补充词库，请按 README 配置本地数据')
        matched, row = key, None
        with (closing(connect(self.base)) if self.base.is_file() else nullcontext(None)) as db:
            row = db.execute('SELECT word,phonetic,zh,en,forms,tags FROM entries WHERE key=?', (key,)).fetchone() if db else None
            if not row and db:
                alias = db.execute('SELECT lemma FROM aliases WHERE key=?', (key,)).fetchone()
                if alias:
                    matched = alias[0]
                    row = db.execute('SELECT word,phonetic,zh,en,forms,tags FROM entries WHERE key=?', (matched,)).fetchone()
            senses = db.execute('SELECT json FROM senses WHERE key=?', (matched,)).fetchone() if db else None
        if not row and key in self.teaching:
            row = (key, '', self.teaching[key]['title'], '', '', '')
        pages = self._oxford(key)
        if not row and not pages:
            if re.search('[\u3400-\u9fff]', key):
                matches = self.chinese(key)
                if len(matches) == 1:
                    data = dict(self.lookup(matches[0]['word']))
                    return dict(data, requested=requested, matchedFrom=requested)
                return {'kind': 'matches', 'requested': requested, 'matches': matches}
            return {'kind': 'missing', 'requested': requested, 'suggestions': self.suggest(key)}
        data = dict(zip(['word', 'phonetic', 'zh', 'en', 'formsRaw', 'tagsRaw'], row)) if row else {'word': key}
        data.update(kind='entry', schema=1, requested=requested, source='service', senses=json.loads(senses[0]) if senses else [])
        if matched != key:
            data['matchedFrom'] = requested
        data['teaching'] = self.teaching.get(matched)
        data['forms'] = []
        labels = {'p': '过去式', 'd': '过去分词', 'i': '现在分词', '3': '第三人称单数', 'r': '比较级', 't': '最高级', 's': '复数', '0': '原形'}
        for item in (data.pop('formsRaw', '') or '').split('/'):
            code, _, word = item.partition(':')
            if code in labels and word:
                data['forms'].append({'label': labels[code], 'word': word})
        data['tags'] = (data.pop('tagsRaw', '') or '').split()
        blocks, related, examples, phonetics, brief = [], [], [], {}, ''
        for identifier, headword, html in pages:
            rendered, links, info = rich_blocks(html, with_info=True)
            for nodes in rendered:
                blocks.append({'id': str(identifier) + '-' + str(len(blocks)), 'nodes': nodes})
            related.extend(links)
            examples.extend(info['examples']);phonetics.update(info['phonetics'])
            if not brief:brief=info['brief']
        data['oxford'] = {'title': '牛津高阶英汉双解 · 第10版', 'documents': len(pages), 'blocks': blocks,'examples':examples,'phonetics':phonetics,'brief':brief}
        data['brief']=brief
        data['phonetics']=phonetics
        related.extend((data.get('teaching') or {}).get('related', []))
        data['related'] = list(dict.fromkeys(related))[:60]
        return data


def rich_blocks(html, with_info=False):
    """Map every source text node to trusted mini-program rich-text nodes.

    Unknown/custom tags are mapped rather than dropped; source JavaScript is never
    executed. Fragmentation splits the tree without truncating long entries.
    """
    soup = BeautifulSoup(html, 'html.parser')
    for node in soup.select('script,style,link,meta,base,iframe,object,embed,img,audio,video,source,audio-wr,.audio_play_button'):
        node.decompose()
    related = []
    for anchor in soup.select('a[href]'):
        href = anchor.get('href', '')
        if href.lower().startswith(('entry://', 'dic://', 'bword://')):
            word = unquote(href.split('://', 1)[1].split('#', 1)[0])
            if 0 < len(word) <= 80 and not word.startswith('@'):
                related.append(word)
        elif href.lower().startswith('sound:'):
            anchor.decompose()
    allowed = {'div', 'span', 'p', 'b', 'strong', 'i', 'em', 'u', 's', 'sub', 'sup', 'br', 'hr', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote'}
    blocks = []

    def convert(node):
        if isinstance(node, Comment):
            return None
        if isinstance(node, NavigableString):
            return {'type': 'text', 'text': str(node)} if str(node) else None
        name, classes = node.name.lower(), set(node.get('class', []))
        style = 'max-width:100%;overflow-wrap:anywhere;line-height:1.85;'
        if name in {'html', 'body', 'section', 'article', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'deft', 'xt'}:
            tag = 'div'
        elif name in {'td', 'th'}:
            tag = 'span'
            style += 'display:inline-block;padding-right:12px;'
        else:
            tag = name if name in allowed else 'span'
        if name == 'chn':
            style += 'display:block;opacity:.78;margin:3px 0 9px;'
        if name in {'deft', 'xt'}:
            style += 'margin:3px 0 9px;'
        if 'sense' in classes:
            style += 'margin:14px 0;'
        if 'headword' in classes:
            style += 'font-size:22px;font-weight:700;'
        if classes & {'pos', 'grammar', 'labels', 'registerlab', 'regionlab'}:
            style += 'font-size:13px;opacity:.8;'
        if 'pos' in classes:
            style += 'font-style:italic;margin-left:6px;'
        if classes & {'unbox', 'collapse'}:
            style += 'margin:10px 0;padding:10px;border:1px solid #9dbbd244;border-radius:8px;'
        if classes & {'heading', 'sensetop', 'unbox-title'}:
            style += 'font-weight:600;'
        if name in {'ol', 'ul'}:
            style += 'padding-left:20px;margin:6px 0;'
        children = [value for child in node.children if (value := convert(child)) is not None]
        if 'phons_br' in classes:
            children.insert(0, {'type': 'text', 'text': '英 '})
        if 'phons_n_am' in classes:
            children.insert(0, {'type': 'text', 'text': '美 '})
        return {'type': 'node', 'name': tag, 'attrs': {'style': style}, 'children': children}

    def size(node):
        return len(json.dumps(node, ensure_ascii=False).encode())

    def fragments(node):
        if size(node) <= 18000:
            yield node
        elif node['type'] == 'text':
            for start in range(0, len(node['text']), 3000):
                yield {'type': 'text', 'text': node['text'][start:start + 3000]}
        else:
            for child in node.get('children', []):
                for fragment in fragments(child):
                    yield dict(node, children=[fragment])

    current, current_size = [], 0
    for child in (soup.body or soup).children:
        node = convert(child)
        if node is None:
            continue
        for fragment in fragments(node):
            length = size(fragment)
            if current and current_size + length > 22000:
                blocks.append(current)
                current, current_size = [], 0
            current.append(fragment)
            current_size += length
    if current:
        blocks.append(current)
    if with_info:
        phonetics={}
        for cls,variant in [('phons_br','uk'),('phons_n_am','us')]:
            node=soup.select_one('.'+cls+' .phon')
            if node:phonetics[variant]=node.get_text(' ',strip=True)
        examples=[]
        for node in soup.select('.x'):
            sibling=node.find_next_sibling();examples.append({'en':node.get_text(' ',strip=True),'zh':sibling.get_text(' ',strip=True) if sibling and sibling.name.lower()=='xt' else '', 'source':'牛津十版'})
        first=soup.find('chn')
        return blocks,list(dict.fromkeys(related)),{'phonetics':phonetics,'examples':examples,'brief':first.get_text(' ',strip=True) if first else ''}
    return blocks, list(dict.fromkeys(related))
