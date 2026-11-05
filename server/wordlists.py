"""Read the supplied Oxford lists as data, without running source scripts."""
import re
from urllib.parse import unquote
from bs4 import BeautifulSoup
from text_index import normalize
from dictionary_media import resource_key,mime_type


def human(value):
    value=re.sub(r'[_-]+',' ',value)
    return value[:1].upper()+value[1:]


def reference(word):
    if not isinstance(word,str) or len(word)>256 or re.search(r'[\x00-\x1f]',word):return None
    core=re.fullmatch(r'@ox(3000|5000)(?:&level=([abc][12]))?',word)
    if core:
        size,level=core.groups();level=level or ''
        if level=='c2':return None
        if size=='3000' and level=='c1':size='5000'
        return {'id':'ox'+size+':'+(level or 'all'),'name':'牛津'+size+' · '+(level.upper() if level else '全部')}
    opal=re.fullmatch(r'@opal_(written|spoken)(?:&level=sublist_(\d+))?',word)
    if opal:
        kind,part=opal.groups();number=int(part or 0)
        if part and not 0<number<=(12 if kind=='written' else 6):return None
        return {'id':'opal:'+kind+':'+('sublist_'+str(number) if number else 'all'),'name':'OPAL 学术'+('书面语' if kind=='written' else '口语')+' · '+('词汇分表 '+str(number) if number else '全部')}
    topic=re.fullmatch(r'@topic_([a-z0-9][a-z0-9_-]*?)(?:_level=([abc][12]))?',word)
    if topic:
        name,level=topic.groups()
        return {'id':'topic:'+name+':'+(level or 'all'),'name':human(name)+' · '+(level.upper() if level else '全部')}
    return None


def parse(source):
    soup=BeautifulSoup(source,'html.parser')
    for node in soup.select('script,style,audio,video,img,iframe'):node.decompose()
    result=[]
    for node in soup.select('[data-hw]'):
        word=node.get('data-hw','').strip()
        if not word or len(word)>256 or re.search(r'[\x00-\x1f]',word):continue
        pos=node.select_one('.pos');level=node.select_one('.belong-to')
        link=node.find('a',href=re.compile(r'^entry://',re.I));query=word;anchor=''
        if link:
            target=link['href'][8:];query,_,anchor=target.partition('#');query=unquote(query);anchor=unquote(anchor)
        academic=node.find('a',href=re.compile(r'^/definition/academic/'))
        related=unquote(academic['href'].rsplit('/',1)[-1].split('#',1)[0]) if academic else ''
        audio={}
        for anchor_node in node.find_all('a',href=re.compile(r'^sound://',re.I)):
            classes=anchor_node.get('class',[]);variant='UK' if 'pron-uk' in classes else 'US' if 'pron-us' in classes else ''
            key=resource_key(anchor_node['href'])
            if variant and key and mime_type(key).startswith('audio/'):
                values=audio.setdefault(variant,[])
                if key not in values:values.append(key)
        row={'word':word,'pos':pos.get_text().strip() if pos else '',
             'level':level.get_text().strip().upper() if level and re.match(r'^[ABC][12]$',level.get_text().strip().upper()) else '',
             'query':query,'anchor':anchor,'relatedWord':related if related.lower()!=word.lower() else '',
             'fields':{key:value for key,value in node.attrs.items() if key.startswith('data-')}}
        if audio:row['audio']=audio
        result.append(row)
    return result


def opal_fields(rows):
    result={'written':[],'spoken':[],'writtenPhrases':False,'spokenPhrases':False,'writtenCategories':[],'spokenCategories':[]}
    for row in rows:
        for kind in ['written','spoken']:
            part=row['fields'].get('data-opal_'+kind)
            if part and part not in result[kind]:result[kind].append(part)
            category=row['fields'].get('data-opal_'+kind+'_phrases')
            if category:
                result[kind+'Phrases']=True
                if category not in result[kind+'Categories']:result[kind+'Categories'].append(category)
    for kind in ['written','spoken']:
        result[kind].sort(key=lambda part:int(part.rsplit('_',1)[-1]));result[kind+'Categories'].sort()
    return result


def describe(words,opal):
    result=[]
    if '@ox3000' in words:
        for size in ['3000','5000']:
            for level in ['','a1','a2','b1','b2']+(['c1'] if size=='5000' else []):
                result.append({'id':'ox'+size+':'+(level or 'all'),'name':'牛津'+size+' · '+(level.upper() if level else '全部'),'group':'核心与等级','sourceKey':'@ox3000','column':'data-ox'+size,'value':level,'kind':'oxford'})
    source=next((word for word in words if re.match(r'^@opal_(written|spoken)&level=sublist_\d+$',word)),None)
    if source:
        for kind in ['written','spoken']:
            label='OPAL 学术'+('书面语' if kind=='written' else '口语');parts=opal.get(kind,[])
            if parts or opal.get(kind+'Phrases'):result.append({'id':'opal:'+kind+':all','name':label+' · 全部','group':'学术词表','sourceKey':source,'column':'data-opal_'+kind,'value':'','kind':'opal'})
            if opal.get(kind+'Phrases'):result.append({'id':'opal:'+kind+':phrases','name':label+' · 短语','group':'学术词表','sourceKey':source,'column':'data-opal_'+kind+'_phrases','value':'','kind':'opal'})
            for part in parts:result.append({'id':'opal:'+kind+':'+part,'name':label+' · 词汇分表 '+part.rsplit('_',1)[-1],'group':'学术词表','sourceKey':source,'column':'data-opal_'+kind,'value':part,'kind':'opal'})
            for category in opal.get(kind+'Categories',[]):result.append({'id':'opal:'+kind+':phrase:'+category,'name':label+' · '+human(category),'group':'学术短语分类','sourceKey':source,'column':'data-opal_'+kind+'_phrases','value':category,'kind':'opal'})
    for word in words:
        match=re.match(r'^@topic_(.+?)(?:_level=([abc][12]))?$',word)
        if match:
            topic,level=match.groups();result.append({'id':'topic:'+topic+':'+(level or 'all'),'name':human(topic)+' · '+(level.upper() if level else '全部'),'group':'牛津主题','sourceKey':word,'column':'','value':'','kind':'topic'})
    return result


def select(rows,descriptor):
    result=[]
    for row in rows:
        column=descriptor['column'];value=row['fields'].get(column,'');phrase=row['fields'].get(column+'_phrases','') if descriptor['kind']=='opal' else ''
        if column and not (value==descriptor['value'] if descriptor['value'] else value or phrase):continue
        level=value.upper() if descriptor['kind']=='oxford' else row['level'];category=(value or phrase) if descriptor['kind']=='opal' else ''
        note=('词汇分表 '+category.rsplit('_',1)[-1] if re.match(r'^sublist_\d+$',category) else human(category)) if category else ''
        selected={key:row[key] for key in ['word','pos','query','anchor','relatedWord']}|{'level':level,'note':note}
        if row.get('audio'):selected['audio']=row['audio']
        result.append(selected)
    normalized=normalize
    return {'id':descriptor['id'],'name':descriptor['name'],'group':descriptor['group'],'rows':result,'sourceRecords':len(result),'uniqueWords':len({normalized(row['word']) for row in result})}
