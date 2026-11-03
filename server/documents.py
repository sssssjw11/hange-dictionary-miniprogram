"""Extract user-provided text/EPUB/PDF without executing document content."""
import io
import posixpath
import re
from urllib.parse import unquote
from xml.etree import ElementTree as ET
import zipfile
from bs4 import BeautifulSoup


def html_text(value):
    soup=BeautifulSoup(value,'html.parser')
    for node in soup.select('script,style,iframe,object,embed,nav'):node.decompose()
    return re.sub(r'\n{3,}','\n\n',soup.get_text('\n',strip=True)).strip()


def extract(blob,filename):
    if len(blob)>10*1024*1024:raise ValueError('阅读文件最大为 10 MiB')
    extension=filename.lower().rsplit('.',1)[-1]
    documents=[]
    if extension=='txt':
        try:text=blob.decode('utf-8-sig')
        except UnicodeDecodeError as error:raise ValueError('请使用 UTF-8 编码的文本文件') from error
        documents=[{'title':filename.rsplit('.',1)[0],'text':text}]
    elif extension=='epub':
        try:
            with zipfile.ZipFile(io.BytesIO(blob)) as archive:
                if len(archive.infolist())>5000 or sum(info.file_size for info in archive.infolist())>40*1024*1024:raise ValueError('EPUB 解压内容过大')
                container=ET.fromstring(archive.read('META-INF/container.xml'))
                rootfile=next(node.get('full-path') for node in container.iter() if node.tag.endswith('rootfile'))
                opf=ET.fromstring(archive.read(rootfile));base=posixpath.dirname(rootfile)
                items={node.get('id'):node.get('href') for node in opf.iter() if node.tag.endswith('item')}
                ordered=[node.get('idref') for node in opf.iter() if node.tag.endswith('itemref')]
                for number,identifier in enumerate(ordered,1):
                    href=items.get(identifier)
                    if not href:continue
                    path=posixpath.normpath(posixpath.join(base,unquote(href).split('#')[0]))
                    if path.startswith(('../','/')):raise ValueError('EPUB 章节路径无效')
                    content=archive.read(path)
                    if len(content)>2*1024*1024:raise ValueError('EPUB 单章过大，请按章节拆分')
                    soup=BeautifulSoup(content,'html.parser');heading=soup.find(['h1','h2','title']);title=heading.get_text(' ',strip=True)[:100] if heading else '第 %d 章'%number
                    text=html_text(content)
                    if text:documents.append({'title':title,'text':text})
        except (zipfile.BadZipFile,KeyError,ET.ParseError,StopIteration) as error:raise ValueError('无法读取此 EPUB 的目录和章节') from error
    elif extension=='pdf':
        try:import fitz
        except ImportError as error:raise ValueError('服务端尚未安装 PDF 文本读取组件') from error
        with fitz.open(stream=blob,filetype='pdf') as book:
            if book.needs_pass:raise ValueError('暂不支持加密 PDF，请先解密后导入')
            if len(book)>200:raise ValueError('一次最多导入 200 页 PDF')
            for number,page in enumerate(book,1):
                text=page.get_text('text',sort=True).strip()
                if text:documents.append({'title':'第 %d 页'%number,'text':text})
        if not documents:raise ValueError('此 PDF 没有可提取的文本；扫描页可使用拍照识词逐页导入')
    else:raise ValueError('支持 TXT、EPUB 和含文本的 PDF 文件')
    if not documents:raise ValueError('没有可导入的正文')
    if sum(len(document['text']) for document in documents)>800000:raise ValueError('正文过长，请拆分书籍后导入')
    return {'title':filename.rsplit('.',1)[0][:100],'documents':documents,'format':extension}
