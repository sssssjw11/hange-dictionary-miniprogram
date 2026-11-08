"""Read-only dictionary engine. No publisher downloads or user-account database."""
from __future__ import annotations
from collections import deque, OrderedDict
from contextlib import closing, nullcontext
from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
from threading import RLock
from urllib.parse import unquote
import zlib

from bs4 import BeautifulSoup, Comment, NavigableString
from oxford_summary import oxford_summary, visible_soup
from oxford_navigation import navigation, sense_prefix, empty_learning, merge_learning
from text_index import normalize, has_han, query_terms, meaning_rank
from spelling import eligible as spelling_eligible, rank as spelling_rank
import wordlists
from dictionary_media import MediaStore,media_references

ROOT = Path(__file__).resolve().parents[1]


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
        self.oxford_single_character = False
        self._chinese_checks = OrderedDict()
        self._chinese_checks_lock = RLock()
        if self.chinese_index.is_file() and self.oxford.is_file():
            try:
                with closing(connect(self.chinese_index)) as index, closing(connect(self.oxford)) as source:
                    metadata = dict(index.execute('SELECT key,value FROM metadata'))
                    source_sha = source.execute("SELECT value FROM metadata WHERE key='source_sha256'").fetchone()
                    self.oxford_chinese = bool(source_sha and metadata.get('source_sha256') == source_sha[0])
                    self.oxford_single_character = self.oxford_chinese and metadata.get('single_character') == '1'
            except sqlite3.Error:
                self.oxford_chinese = False
        self.teaching = json.loads((ROOT / 'miniprogram/data/learning.json').read_text('utf-8'))
        self.counts = {'base': 0, 'oxford': 0};self.oxford_source_sha=''
        for name, file in [('base', self.base), ('oxford', self.oxford)]:
            if file.is_file():
                with closing(connect(file)) as db:
                    self.counts[name] = db.execute('SELECT count(*) FROM entries' + (' WHERE body IS NOT NULL' if name == 'oxford' else '')).fetchone()[0]
                    if name=='oxford':
                        try:row=db.execute("SELECT value FROM metadata WHERE key='source_sha256'").fetchone();self.oxford_source_sha=row[0] if row else ''
                        except sqlite3.Error:pass
        self.media=MediaStore(self.folder/'oxford/media.db',self.oxford_source_sha)

    def status(self):
        return {'ready': self.base.is_file() or self.oxford.is_file(), 'oxford': self.oxford.is_file(),
                'baseEntries': self.counts['base'],
                'oxfordDefinitions': self.counts['oxford'],
                'oxfordChineseIndex': self.oxford_chinese, 'oxfordChineseSingleCharacter': self.oxford_single_character, 'version': '2.27.0'}

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
        if not key or len(key) > 128 or has_han(key):
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

    def _chinese_contains(self, identifier, term, source):
        # Keep only booleans for two queries. Later pages can revisit the SQL
        # prefix without reparsing its full HTML, or holding open connections.
        with self._chinese_checks_lock:
            checks=self._chinese_checks.get(term)
            if checks is None:
                if len(self._chinese_checks)>=2:self._chinese_checks.popitem(last=False)
                checks={};self._chinese_checks[term]=checks
            self._chinese_checks.move_to_end(term)
            if identifier in checks:return checks[identifier]
        body=source.execute('SELECT body FROM entries WHERE id=?',(identifier,)).fetchone()[0]
        found=term in normalize(visible_soup(zlib.decompress(body).decode()).get_text())
        with self._chinese_checks_lock:checks[identifier]=found
        return found

    @lru_cache(maxsize=32)
    def corrections(self, word):
        key=normalize(word)
        if not spelling_eligible(key):return []
        tolerance=1 if len(key)<5 else 2
        if self.oxford.is_file():
            with closing(connect(self.oxford)) as db:
                candidates=({'key':key,'word':word if body else key,'id':identifier,'body':body} for key,word,identifier,body in db.execute(
                    'SELECT key,word,id,body IS NOT NULL FROM entries WHERE length(key) BETWEEN ? AND ?', (len(key)-tolerance,len(key)+tolerance)) if body or not re.search(r' \d+$',key))
                selected=spelling_rank(key,candidates)
                results=[]
                with (closing(connect(self.chinese_index)) if self.oxford_chinese else nullcontext(None)) as index:
                    for item in selected:
                        pages=self._oxford(item['key']) if not item['body'] else None
                        if pages==[]:continue
                        identifier=pages[0][0] if pages else item['id']
                        brief=index.execute('SELECT brief FROM documents WHERE id=?',(identifier,)).fetchone() if index else None
                        meaning=brief[0] if brief and brief[0] else ''
                        if not meaning:
                            html=pages[0][2] if pages else zlib.decompress(db.execute('SELECT body FROM entries WHERE id=?',(identifier,)).fetchone()[0]).decode('utf-8')
                            meaning=oxford_summary(html)
                        results.append({'word':item['word'],'meaning':meaning or '牛津十版词条'})
                return results
        if self.base.is_file():
            with closing(connect(self.base)) as db:
                candidates=({'key':key,'word':word,'meaning':meaning} for key,word,meaning in db.execute(
                    'SELECT key,word,zh FROM entries WHERE length(key) BETWEEN ? AND ?', (len(key)-tolerance,len(key)+tolerance)))
                return [{'word':item['word'],'meaning':item['meaning'] or ''} for item in spelling_rank(key,candidates)]
        return []

    @lru_cache(maxsize=2)
    def _word_list_rows(self,key):
        pages=self._oxford(key)
        if not pages:raise ValueError('当前词库没有这份词表')
        return [row for _,_,html in pages for row in wordlists.parse(html)]

    @lru_cache(maxsize=1)
    def word_list_catalog(self):
        if not self.oxford.is_file():return []
        with closing(connect(self.oxford)) as db:words=sorted({row[0] for row in db.execute("SELECT word FROM entries WHERE word LIKE '@%' AND body IS NOT NULL")})
        opal=next((word for word in words if word.startswith('@opal_')),None)
        fields=wordlists.opal_fields(self._word_list_rows(opal)) if opal else {}
        return wordlists.describe(words,fields)

    def word_list(self,identifier):
        if not isinstance(identifier,str) or len(identifier)>256:raise ValueError('词表编号无效')
        descriptor=next((item for item in self.word_list_catalog() if item['id']==identifier),None)
        if descriptor is None:raise ValueError('词表不存在，请返回目录重新选择')
        return dict(wordlists.select(self._word_list_rows(descriptor['sourceKey']),descriptor),source='service',sourceSha256=self.oxford_source_sha)

    def _chinese_rows(self, term):
        seen = set()
        if self.oxford_chinese:
            grams=query_terms(term, self.oxford_single_character)
            if grams:
                query=' AND '.join('"'+gram+'"' for gram in sorted(grams))
                with closing(connect(self.chinese_index)) as index,closing(connect(self.oxford)) as source:
                    index.create_function('hange_rank', 2, meaning_rank, deterministic=True)
                    rows=index.execute('SELECT d.id,d.word,d.brief FROM search JOIN documents d ON d.id=search.rowid WHERE search MATCH ? ORDER BY hange_rank(d.brief,?),length(d.word),d.id',(query,term))
                    for identifier,word,brief in rows:
                        key=normalize(word)
                        if key in seen:continue
                        if self._chinese_contains(identifier,term,source):
                            seen.add(key)
                            yield {'word':word,'meaning':brief or '原文匹配：'+term}
        for word,note in self.teaching.items():
            key=normalize(word)
            if key not in seen and term in normalize(json.dumps(note,ensure_ascii=False)):
                seen.add(key)
                yield {'word':word,'meaning':note['title']}
        if not self.base.is_file():
            return
        escaped = term.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
        with closing(connect(self.base)) as db:
            rows = db.execute("SELECT word,zh FROM entries WHERE zh LIKE ? ESCAPE '\\' ORDER BY CASE WHEN zh=? OR zh LIKE ? THEN 0 ELSE 1 END,CASE WHEN substr(zh,1,1)='[' THEN 1 ELSE 0 END,length(word),word", ('%' + escaped + '%', term, 'n. ' + escaped + '%'))
            for word, zh in rows:
                key=normalize(word)
                if key not in seen:
                    seen.add(key)
                    yield {'word': word, 'meaning': zh}

    @lru_cache(maxsize=128,typed=True)
    def chinese_page(self, term, cursor=0):
        term=normalize(term)
        if not term or len(term)>256 or '\x00' in term or not has_han(term):
            raise ValueError('请输入包含汉字的中文关键词，最多 256 字')
        if type(cursor) is not int or not 0<=cursor<=self.counts['base']+self.counts['oxford']+len(self.teaching):
            raise ValueError('查询页码无效，请重新查询')
        matches=[];next_cursor=None
        # Close both read-only connections even when the look-ahead ends early.
        with closing(self._chinese_rows(term)) as rows:
            for index,row in enumerate(rows):
                if index<cursor:continue
                if len(matches)==40:
                    next_cursor=cursor+40;break
                matches.append(row)
        return {'kind':'matches','requested':term,'matches':matches,'source':'service',
                'cursor':cursor,'nextCursor':next_cursor,'pageSize':40}

    def chinese(self, term):
        return self.chinese_page(term)['matches']

    @lru_cache(maxsize=128)
    def supplement(self, requested):
        entry=self.lookup(requested)
        fields={key:entry.get(key,default) for key,default in [('word',requested),('phonetic',''),('zh',''),('en',''),('forms',[]),('tags',[]),('senses',[]),('teaching',None)]}
        fields.update(kind='supplement',schema=1,requested=requested,source='service',available=self.base.is_file(),
                      found=bool(fields['zh'] or fields['en'] or fields['senses'] or fields['teaching'] or fields['forms'] or fields['phonetic']),
                      related=(fields['teaching'] or {}).get('related',[]))
        return fields

    @lru_cache(maxsize=128)
    def lookup(self, requested):
        requested = requested.strip()
        if not requested or len(requested) > 256 or '\x00' in requested:
            raise ValueError('请输入 1～256 字的单词或短语')
        key = normalize(requested)
        if not self.base.is_file() and not self.oxford.is_file():
            raise FileNotFoundError('未找到补充词库，请按 README 配置本地数据')
        pages = self._oxford(key)
        matched, row = normalize(pages[0][1]) if pages else key, None
        with (closing(connect(self.base)) if self.base.is_file() else nullcontext(None)) as db:
            row = db.execute('SELECT word,phonetic,zh,en,forms,tags FROM entries WHERE key=?', (matched,)).fetchone() if db else None
            if not row and db:
                alias = db.execute('SELECT lemma FROM aliases WHERE key=?', (matched,)).fetchone()
                if alias:
                    matched = alias[0]
                    row = db.execute('SELECT word,phonetic,zh,en,forms,tags FROM entries WHERE key=?', (matched,)).fetchone()
            senses = db.execute('SELECT json FROM senses WHERE key=?', (matched,)).fetchone() if db else None
        if not row and matched in self.teaching:
            row = (matched, '', self.teaching[matched]['title'], '', '', '')
        if not row and not pages:
            if has_han(key):
                page = self.chinese_page(key)
                matches = page['matches']
                if len(matches) == 1 and page['nextCursor'] is None:
                    data = dict(self.lookup(matches[0]['word']))
                    return dict(data, requested=requested, matchedFrom=requested)
                return dict(page,requested=requested)
            suggestions=self.suggest(key)
            return {'kind': 'missing', 'requested': requested, 'source':'service', 'suggestions':suggestions or self.corrections(key), 'suggestionKind':'prefix' if suggestions else 'spelling'}
        data = dict(zip(['word', 'phonetic', 'zh', 'en', 'formsRaw', 'tagsRaw'], row)) if row else {'word': pages[0][1]}
        if pages:
            data['word'] = pages[0][1]
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
        table_count=0
        anchors=[];contents=[];references=[];reference_occurrences=[];local_links=[];word_list_links=[];media_refs=[];learning=empty_learning()
        for document,(identifier, headword, html) in enumerate(pages):
            first_block=len(blocks)
            rendered, links, info = rich_blocks(html, with_info=True,word=headword)
            merge_learning(learning,info['learning'])
            for nodes in rendered:
                blocks.append({'id': str(identifier) + '-' + str(len(blocks)), 'nodes': nodes})
            related.extend(links)
            examples.extend(info['examples']);phonetics.update(info['phonetics']);table_count+=info['tableCount']
            if not brief:brief=info['brief']
            for name,target in [('anchors',anchors),('contents',contents),('referenceOccurrences',reference_occurrences)]:
                for ordinal,item in enumerate(info[name]):
                    item=dict(item,document=document)
                    if item['blockIndex']>=0:item['blockIndex']+=first_block
                    if name=='contents':item['key']=str(document)+'-'+str(ordinal)
                    target.append(item)
            references.extend(info['references']);local_links.extend(dict(item,document=document) for item in info['localLinks'])
            word_list_links.extend(info['wordListLinks'])
            media_refs.extend(info['mediaRefs'])
        seen_references=set();unique_references=[]
        for item in references:
            key=(item['word'],item['anchor'])
            if key not in seen_references:seen_references.add(key);unique_references.append(item)
        list_ids=set();unique_list_links=[]
        for item in word_list_links:
            if item['id'] not in list_ids:list_ids.add(item['id']);unique_list_links.append(item)
        media_keys=set();unique_media=[]
        for item in media_refs:
            if item['key'] not in media_keys:media_keys.add(item['key']);unique_media.append(item)
        data['oxford'] = {'title': '牛津高阶英汉双解 · 第10版', 'documents': len(pages), 'blocks': blocks,'examples':examples,'phonetics':phonetics,'brief':brief,'tableVersion':1,'tableCount':table_count,'navVersion':1,'anchors':anchors,'contents':contents,'references':unique_references,'referenceVersion':1,'referenceOccurrences':reference_occurrences,'localLinks':local_links,'learningVersion':1,'learning':learning,'wordListVersion':1,'wordListLinks':unique_list_links,'mediaVersion':2,'mediaRefs':unique_media,'sourceSha256':self.oxford_source_sha}
        data['brief']=brief
        data['phonetics']=phonetics
        related.extend((data.get('teaching') or {}).get('related', []))
        data['related'] = list(dict.fromkeys(related))
        return data


def rich_blocks(html, with_info=False,word=''):
    """Map every source text node to trusted mini-program rich-text nodes.

    Unknown/custom tags are mapped rather than dropped; source JavaScript is never
    executed. Fragmentation splits the tree without truncating long entries.
    """
    soup = BeautifulSoup(html, 'html.parser')
    media_refs=media_references(soup)
    for node in soup.select('script,style,link,meta,base,iframe,object,embed,img,audio,video,source,audio-wr,.audio_play_button'):
        node.decompose()
    related = []
    for anchor in soup.select('a[href]'):
        href = anchor.get('href', '')
        if href.lower().startswith(('entry://', 'dic://', 'bword://')):
            word = unquote(href.split('://', 1)[1].split('#', 1)[0])
            if 0 < len(word) <= 256 and not word.startswith('@'):
                related.append(word)
        elif href.lower().startswith('sound:'):
            anchor.decompose()
    allowed = {'div', 'span', 'p', 'b', 'strong', 'i', 'em', 'u', 's', 'sub', 'sup', 'br', 'hr', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'caption', 'col', 'colgroup'}
    blocks = []

    def inline_translation(node):
        for parent in node.parents:
            if parent.name in {'deft', 'xt', 'at', 'ot'}:
                return False
            if parent.name in {'subjt', 'dis-gt', 'shcutt'} or set(parent.get('class', [])) & {'labels', 'grammar', 'registerlab', 'regionlab', 'dis-g', 'shcut', 'heading', 'unbox-title'}:
                return True
        return False

    cell_style='max-width:100%;word-break:normal;overflow-wrap:break-word;line-height:1.75;padding:8px 6px;vertical-align:top;overflow-wrap:anywhere;word-break:break-word;'
    def complete_table_columns(children):
        rows=[];has_columns=False;has_span=False
        def visit(node):
            nonlocal has_columns,has_span
            if node.get('type')=='text':return
            name=node.get('name')
            if name in {'col','colgroup'}:has_columns=True;return
            if name=='tr':
                cells=[item for item in node.get('children',[]) if item.get('type')!='text' and item.get('name') in {'td','th'}]
                if any(item.get('attrs',{}).get('rowspan') or item.get('attrs',{}).get('colspan') for item in cells):has_span=True
                rows.append((node,cells));return
            if name in {'tbody','thead','tfoot'}:
                for child in node.get('children',[]):visit(child)
        for child in children:visit(child)
        width=max((len(cells) for _,cells in rows),default=0)
        if has_columns or has_span or width<2 or width>16:return
        for node,cells in rows:
            for _ in range(width-len(cells)):node['children'].append({'type':'node','name':'td','attrs':{'style':cell_style},'children':[]})

    def convert(node):
        if isinstance(node, Comment):
            return None
        if isinstance(node, NavigableString):
            return {'type': 'text', 'text': str(node)} if str(node) else None
        name, classes = node.name.lower(), set(node.get('class', []))
        style = 'max-width:100%;word-break:normal;overflow-wrap:break-word;line-height:1.75;'
        if name in {'html', 'body', 'section', 'article', 'deft', 'xt'}:
            tag = 'div'
        else:
            tag = name if name in allowed else 'span'
        if name=='table':style+='width:100%;table-layout:fixed;border-collapse:collapse;margin:10px 0 14px;'
        if name=='tr':style+='border-bottom:1px solid #9dbbd233;'
        if name in {'td','th'}:style+='padding:8px 6px;vertical-align:top;overflow-wrap:anywhere;word-break:break-word;'
        if name in {'th','caption'}:style+='font-weight:600;text-align:left;'
        if name == 'chn':
            style += 'display:inline;opacity:.8;margin-left:5px;' if inline_translation(node) else 'display:block;opacity:.85;margin:2px 0 7px;'
        if name in {'deft', 'xt'}:
            style += 'margin:3px 0 9px;'
        if 'sense' in classes:
            tag='div';style += 'margin:14px 0;'
        if 'webtop' in classes:
            style += 'display:block;padding-bottom:8px;margin-bottom:10px;border-bottom:1px solid #9dbbd233;'
        if 'headword' in classes:
            style += 'font-size:20px;font-weight:600;margin:0 0 4px;'
        if 'phonetics' in classes:
            style += 'display:block;margin:4px 0;'
        if classes & {'phons_br', 'phons_n_am'}:
            style += 'display:inline-block;margin-right:12px;'
        if 'labels' in classes:
            style += 'display:block;margin:4px 0;'
        if 'link-right' in classes:
            style += 'display:block;font-size:11px;text-align:right;opacity:.55;margin:4px 0;'
        if classes & {'pos', 'grammar', 'labels', 'registerlab', 'regionlab'}:
            style += 'font-size:13px;opacity:.8;'
        if 'pos' in classes:
            style += 'font-style:italic;margin-left:6px;'
        if 'collapse' in classes:
            tag='div';style += 'display:block;margin:12px 0;'
        if 'unbox' in classes:
            tag='div'
            box=node.get('unbox') or node.find(class_='box_title',recursive=False)
            style += 'display:block;margin:12px 0;padding:12px 14px;border:1px solid #9dbbd233;border-left:3px solid #278de0aa;border-radius:10px;font-weight:400;' if box else 'display:block;margin:10px 0 5px;font-size:13px;font-weight:600;opacity:.8;'
        if classes & {'box_title','unbox-title'}:
            tag='div';style += 'display:block;margin:0 0 8px;font-size:14px;font-weight:600;'
        if classes & {'body','p'}:
            tag='div';style += 'display:block;font-weight:400;'
        if 'p' in classes:style += 'margin:7px 0;'
        if 'heading' in classes:style += 'font-weight:600;'
        if name in {'ol', 'ul'}:
            style += 'padding-left:20px;margin:6px 0;'
        children = [value for child in node.children if (value := convert(child)) is not None]
        if 'phons_br' in classes:
            children.insert(0, {'type': 'text', 'text': '英 '})
        if 'phons_n_am' in classes:
            children.insert(0, {'type': 'text', 'text': '美 '})
        number=sense_prefix(node)
        if number:children.insert(0,{'type':'text','text':number})
        if name=='table':complete_table_columns(children)
        attrs={'style':style}
        for key in (['colspan','rowspan'] if name in {'td','th'} else ['span'] if name in {'col','colgroup'} else []):
            value=str(node.get(key,'')).strip()
            if re.fullmatch(r'(?:[1-9]\d{0,2}|1000)',value):attrs[key]=value
        return {'type': 'node', 'name': tag, 'attrs': attrs, 'children': children}

    def size(node):
        return len(json.dumps(node, ensure_ascii=False).encode())

    def fragments(node):
        if size(node) <= 18000:
            yield node
        elif node['type'] == 'text':
            for start in range(0, len(node['text']), 3000):
                yield {'type': 'text', 'text': node['text'][start:start + 3000]}
        elif node.get('name') in {'table','tbody','thead','tfoot'}:
            current=[]
            for child in node.get('children',[]):
                for part in fragments(child):
                    if current and size(dict(node,children=current+[part]))>18000:
                        yield dict(node,children=current);current=[]
                    current.append(part)
            if current:yield dict(node,children=current)
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
        return blocks,list(dict.fromkeys(related)),dict(navigation(soup,blocks,word),phonetics=phonetics,examples=examples,brief=oxford_summary(soup),mediaRefs=media_refs,tableCount=len(soup.find_all('table')))
    return blocks, list(dict.fromkeys(related))
