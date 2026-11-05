"""Native navigation metadata; source scripts and event handlers never execute."""
from bisect import bisect_right
import re
from urllib.parse import unquote
from bs4 import Comment, NavigableString, Tag

IGNORED={'script','style','link','meta','base','iframe','object','embed','img','audio','video','source','audio-wr'}
LEARNING_FIELDS=('levels','extendedLevels','lists','extendedLists')
LEVELS={'A1','A2','B1','B2','C1','C2'}

def empty_learning():return {field:[] for field in LEARNING_FIELDS}

def source_learning(attributes):
    result=empty_learning();value=lambda name:str(attributes.get(name,'')).strip().upper()
    if value('cefr') in LEVELS:result['levels'].append(value('cefr'))
    if value('fkcefr') in LEVELS:result['extendedLevels'].append(value('fkcefr'))
    for wordlist in ['3000','5000']:
        if value('ox'+wordlist)=='Y':result['lists'].append(wordlist)
        if value('fkox'+wordlist)=='Y':result['extendedLists'].append(wordlist)
    return result

def merge_learning(target,source):
    for field in LEARNING_FIELDS:target[field]=sorted(set(target[field]+source.get(field,[])))
    return target
def classes(node):return set(node.get('class',[])) if isinstance(node,Tag) else set()
def hidden(node):return isinstance(node,Comment) or isinstance(node,Tag) and (node.name in IGNORED or 'audio_play_button' in classes(node) or str(node.get('href','')).lower().startswith('sound:'))
def source_text(node):
    if node is None or hidden(node):return ''
    return str(node) if isinstance(node,NavigableString) else ''.join(source_text(child) for child in node.children)

def heading_text(node):
    if node is None or hidden(node):return ''
    if isinstance(node,NavigableString):return str(node)
    return ' · '+source_text(node) if node.name=='chn' else ''.join(heading_text(child) for child in node.children)
def find(node,predicate):
    if hidden(node):return None
    if isinstance(node,Tag) and predicate(node):return node
    for child in getattr(node,'children',[]):
        value=find(child,predicate)
        if value is not None:return value
    return None
def units(value):return len(value.encode('utf-16-le','surrogatepass'))//2
def sense_prefix(node):return str(node['sensenum'])+'. ' if 'sense' in classes(node) and node.get('sensenum') else ''
def excerpt(value):
    value=' '.join(value.split());return value[:120]+('…' if len(value)>120 else '')
def decode(value):
    if re.search(r'%(?![0-9a-fA-F]{2})',value):raise ValueError('Invalid URI component')
    return unquote(value,errors='strict')
def heading(node,word):
    c=classes(node);by_class=lambda name:find(node,lambda item:name in classes(item))
    if 'entry' in c:return '词性',' · '.join(filter(None,[source_text(by_class('headword')) or word,source_text(by_class('pos'))]))
    if 'shcut' in c:return '主题',heading_text(node)
    if 'sense' in c:
        translated=find(node,lambda item:item.name=='deft');english=by_class('def')
        value=(source_text(translated) if source_text(translated).strip() else source_text(english)) or source_text(node) or '参见原文'
        return '义项',(str(node['sensenum'])+'. ' if node.get('sensenum') else '')+value
    if 'unbox' in c:
        title=by_class('box_title') or by_class('unbox-title')
        return '补充' if title else '搭配',source_text(title or node) or node.get('unbox','补充内容')
    if 'idm-g' in c:return '习语',source_text(by_class('idm'))
    if 'phrasal_verb_links' in c:return '短语动词',source_text(by_class('heading') or find(node,lambda item:item.name=='h2')) or 'Phrasal Verbs'
    return None
def navigation(soup,blocks,word=''):
    anchors=[];contents=[];references=[];local=[];position=0;learning=empty_learning()
    def visit(node,root=False):
        nonlocal position
        if hidden(node):return
        if isinstance(node,NavigableString):position+=units(str(node));return
        if not isinstance(node,Tag):return
        markers=source_learning(node.attrs);merge_learning(learning,markers)
        identifier=node.get('id') or (node.get('name') if node.name=='a' else None)
        if identifier:anchors.append({'id':identifier,'document':0,'position':position})
        title=heading(node,word)
        if title and title[1].strip():contents.append({'key':'0-'+str(len(contents)),'document':0,'position':position,'id':identifier or '','kind':title[0],'label':excerpt(title[1]),'learning':markers})
        href=node.get('href','')
        try:
            if href.startswith('#') and len(href)>1:local.append({'anchor':decode(href[1:]),'document':0,'label':excerpt(source_text(node))})
            elif re.match(r'^(entry|dic|bword)://',href,re.I):
                target=href.split('://',1)[1];target_word,separator,anchor=target.partition('#');target_word=decode(target_word);anchor=decode(anchor) if separator else ''
                if target_word and units(target_word)<=256 and not target_word.startswith('@'):references.append({'word':target_word,'anchor':anchor,'label':excerpt(source_text(node)) or target_word})
        except (ValueError,UnicodeDecodeError):pass
        if not root:
            if 'phons_br' in classes(node):position+=2
            if 'phons_n_am' in classes(node):position+=2
            position+=units(sense_prefix(node))
        for child in node.children:visit(child)
    visit(soup.body or soup,root=True)
    def node_units(node):return units(node.get('text','')) if node.get('type')=='text' else sum(node_units(child) for child in node.get('children',[]))
    ends=[];total=0
    for block in blocks:total+=sum(node_units(node) for node in block);ends.append(total)
    for marker in anchors+contents:
        index=min(bisect_right(ends,marker['position']),len(ends)-1)
        marker.update(blockIndex=index,offset=marker['position']-(ends[index-1] if index>0 else 0))
    return {'anchors':anchors,'contents':contents,'references':references,'localLinks':local,'learning':learning}
