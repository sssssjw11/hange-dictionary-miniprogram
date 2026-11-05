"""Private dictionary media references and read-only MDD resource storage."""
from contextlib import closing
import re
import sqlite3
import unicodedata
from urllib.parse import unquote
from bs4 import BeautifulSoup, Tag

MIME={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp',
      '.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.aac':'audio/aac'}
MAX_RESOURCE=16*1024*1024


def resource_key(value):
    if not isinstance(value,str) or len(value)>2048 or re.search(r'[\x00-\x1f\x7f]',value):return None
    value=value.strip()
    if re.match(r'^(sound|res)://',value,re.I):value=value.split('://',1)[1]
    elif re.match(r'^[a-z][a-z0-9+.-]*:',value,re.I) or value.startswith('//'):return None
    try:
        if re.search(r'%(?![0-9a-fA-F]{2})',value):return None
        value=unquote(value.split('#',1)[0].split('?',1)[0],errors='strict')
    except (ValueError,UnicodeDecodeError):return None
    value=unicodedata.normalize('NFC',value.replace('\\','/')).lstrip('/').lower()
    if not value or len(value)>512 or re.search(r'[\x00-\x1f\x7f:?#]',value):return None
    parts=value.split('/')
    if any(part in ['', '.', '..'] for part in parts):return None
    return value if '.'+value.rsplit('.',1)[-1] in MIME else None


def mime_type(key):return MIME.get('.'+key.rsplit('.',1)[-1],'')


def valid_bytes(key,body):
    mime=mime_type(key)
    if not body or len(body)>MAX_RESOURCE:return False
    if mime=='image/png':return body.startswith(b'\x89PNG\r\n\x1a\n')
    if mime=='image/jpeg':return body.startswith(b'\xff\xd8\xff')
    if mime=='image/gif':return body.startswith((b'GIF87a',b'GIF89a'))
    if mime=='image/webp':return body[:4]==b'RIFF' and body[8:12]==b'WEBP'
    if mime=='audio/wav':return body[:4]==b'RIFF' and body[8:12]==b'WAVE'
    if mime=='audio/mp4':return body[4:8]==b'ftyp'
    if mime in ['audio/mpeg','audio/aac']:return body.startswith(b'ID3') or len(body)>1 and body[0]==255 and body[1]&224==224
    return False


def media_references(source):
    soup=BeautifulSoup(source,'html.parser') if isinstance(source,str) else source
    result=[];seen=set()
    for node in soup.find_all(['a','img','audio','source']):
        if any(parent.name in ['script','style','iframe','object','embed'] for parent in node.parents):continue
        value=node.get('href','') if node.name=='a' else node.get('src','')
        if node.name=='a' and not re.match(r'^sound://',value,re.I):continue
        key=resource_key(value)
        if not key or key in seen:continue
        seen.add(key);kind='image' if mime_type(key).startswith('image/') else 'audio'
        classes=node.get('class',[]);variant='UK' if 'pron-uk' in classes else 'US' if 'pron-us' in classes else ''
        label=' '.join(str(node.get('alt') or node.get('title') or '').split())
        if kind=='audio':
            for parent in list(node.parents)[:4]:
                if not isinstance(parent,Tag) or 'entry' in parent.get('class',[]) or 'sense' in parent.get('class',[]):break
                if parent.name=='li' and (example:=parent.select_one('.x')) is not None:
                    label='例句 · '+example.get_text();break
        if not label:label=key.rsplit('/',1)[-1]
        row={'key':key,'kind':kind,'variant':variant,'label':' '.join(label.split())[:200]}
        title=' '.join(str(node.get('title','')).split());match=re.match(r'^(.+?) pronunciation(?:\s|$)',title,re.I)
        if kind=='audio' and match and any(set(parent.get('class',[]))&{'phons_br','phons_n_am'} for parent in list(node.parents)[:4] if isinstance(parent,Tag)):row['pronunciationText']=match[1]
        result.append(row)
    return result


class MediaStore:
    def __init__(self,path,dictionary_sha):self.path=path;self.dictionary_sha=dictionary_sha

    def connect(self):return sqlite3.connect(self.path.resolve().as_uri()+'?mode=ro',uri=True,timeout=5)

    def status(self):
        if not self.path.is_file():return {'available':False,'reason':'尚未导入原版录音和插图 MDD 文件','resources':0,'audio':0,'images':0}
        try:
            with closing(self.connect()) as db:metadata=dict(db.execute('SELECT key,value FROM metadata'))
            if metadata.get('format')!='hange-dictionary-media-v1' or not self.dictionary_sha or metadata.get('dictionary_sha256')!=self.dictionary_sha:
                return {'available':False,'reason':'媒体文件与当前牛津词库不匹配，请导入对应 MDD 文件','resources':0,'audio':0,'images':0}
            return {'available':True,'reason':'原版词条媒体已导入配套服务','resources':int(metadata['resources']),'audio':int(metadata['audio']),'images':int(metadata['images'])}
        except (sqlite3.Error,KeyError,ValueError):return {'available':False,'reason':'词条媒体索引暂时无法读取，请检查导入结果','resources':0,'audio':0,'images':0}

    def resolve(self,keys,source_sha):
        if not isinstance(keys,list) or len(keys)>24 or any(not isinstance(key,str) or resource_key(key)!=key for key in keys):raise ValueError('媒体资源列表无效，每次最多查询 24 项')
        if source_sha!=self.dictionary_sha:raise ValueError('词条与配套服务的牛津词库版本不同，请连接对应服务')
        state=self.status();found={}
        if state['available'] and keys:
            with closing(self.connect()) as db:
                found={key:{'key':key,'available':True,'mime':mime,'bytes':size} for key,mime,size in db.execute('SELECT key,mime,length(body) FROM resources WHERE key IN ('+','.join('?' for _ in keys)+')',keys)}
        return dict(state,sourceSha256=self.dictionary_sha,rows=[found.get(key,{'key':key,'available':False,'bytes':0}) for key in keys])

    def read(self,key,source_sha):
        if source_sha!=self.dictionary_sha or resource_key(key)!=key:raise ValueError('媒体资源引用无效')
        state=self.status()
        if not state['available']:raise FileNotFoundError(state['reason'])
        with closing(self.connect()) as db:row=db.execute('SELECT mime,body FROM resources WHERE key=?',(key,)).fetchone()
        if not row:raise FileNotFoundError('所导入的 MDD 未包含这项资源')
        return row
