"""Serve only explicitly indexed private offline-pack volumes."""
from pathlib import Path
import hashlib
import json
import os
import re
import zipfile

ROOT=Path(__file__).resolve().parents[1]
REGISTRY='offline-pack-transfer.json'
SAFE_NAME=re.compile(r'^(manifest\.json|NOTICE\.txt|lengths\.bin|keys/[0-9a-f]{2}\.json|prefix/[0-9a-f]{2}\.json|docs/[0-9]{3}\.json|zh/[0-9a-f]{2}\.z|parts/[0-9]{3}\.bin)$')
SHA=re.compile(r'^[0-9a-f]{64}$')


def prepare_index(paths,output):
    output=output.resolve();folder=output.parent
    if not 1<=len(paths)<=5:raise ValueError('请指定索引卷与全部数据卷，最多 5 个 ZIP')
    names={};volumes=[];manifest=None;manifest_sha='';declared={}
    for source in paths:
        source=source.resolve()
        if source.parent!=folder or source.name in names or source.suffix.lower()!='.zip' or not 22<=source.stat().st_size<=64*1024*1024:raise ValueError('分卷必须位于传输索引同一目录，每卷不超过 64 MiB')
        names[source.name]=True;has_manifest=False
        with zipfile.ZipFile(source) as archive:
            entries=archive.infolist()
            if len(entries)>1800:raise ValueError('词库 ZIP 文件过多')
            for entry in entries:
                if not SAFE_NAME.fullmatch(entry.filename) or entry.flag_bits&1 or (entry.external_attr>>16)&0xf000==0xa000 or entry.compress_type not in [0,8] or entry.file_size>64*1024*1024:raise ValueError('词库 ZIP 包含不支持的路径或文件')
                if entry.filename in declared:raise ValueError('分卷之间存在重复文件，请选择同一批完整分卷')
                declared[entry.filename]=entry.file_size
                if entry.filename=='manifest.json':
                    if entry.file_size>1024*1024:raise ValueError('词库清单过大')
                    raw=archive.read(entry);manifest=json.loads(raw);manifest_sha=hashlib.sha256(raw).hexdigest();has_manifest=True
        with source.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
        volumes.append({'name':source.name,'bytes':source.stat().st_size,'sha256':digest,'role':'index' if has_manifest else 'data'})
    if not isinstance(manifest,dict) or manifest.get('format')!='hange-oxford-pack' or manifest.get('version')!=1 or not SHA.fullmatch(manifest.get('sourceSha256','')):raise ValueError('分卷缺少有效牛津清单或来源指纹')
    files=manifest.get('files',{})
    if not isinstance(files,dict) or any(not isinstance(value,dict) or not isinstance(value.get('bytes'),int) or not isinstance(value.get('sha256'),str) or not SHA.fullmatch(value['sha256']) for value in files.values()):raise ValueError('词库文件清单格式无效')
    if len(files)+1!=len(declared) or sum(value['bytes'] for value in files.values())!=manifest.get('extractedBytes') or manifest['extractedBytes']>180*1024*1024 or any(name not in files or files[name]['bytes']!=size for name,size in declared.items() if name!='manifest.json'):raise ValueError('分卷不完整或来自不同词库版本')
    volumes.sort(key=lambda row:0 if row['role']=='index' else 1)
    result={'format':'hange-offline-transfer','version':1,'title':manifest.get('title','牛津离线词库'),'sourceSha256':manifest['sourceSha256'],'manifestSha256':manifest_sha,'extractedBytes':manifest['extractedBytes'],'volumes':volumes}
    if output.exists():
        existing=json.loads(output.read_text('utf-8'))
        if existing.get('format')!='hange-offline-transfer':raise ValueError('输出文件已存在且不是本项目生成的传输索引')
    temporary=output.with_name(output.name+'.partial')
    if temporary.exists():raise ValueError('存在未完成的传输索引，请先检查该文件')
    temporary.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')),encoding='utf-8');temporary.replace(output)
    return result


class PackTransfer:
    def __init__(self,folder=None,source_sha=''):
        self.folder=Path(folder or os.environ.get('HANGE_OFFLINE_PACK_DIR',ROOT/'output')).resolve();self.source_sha=source_sha

    def info(self):
        registry=self.folder/REGISTRY
        if not registry.is_file():return {'available':False,'reason':'配套服务尚未准备可传输的离线分卷'}
        try:
            if registry.stat().st_size>1024*1024:raise ValueError()
            raw=registry.read_bytes();data=json.loads(raw)
            if data.get('format')!='hange-offline-transfer' or data.get('version')!=1 or not SHA.fullmatch(data.get('sourceSha256','')) or not SHA.fullmatch(data.get('manifestSha256','')):raise ValueError()
            if self.source_sha and data['sourceSha256']!=self.source_sha:return {'available':False,'reason':'服务分卷与当前牛津词库不同步，请重新生成传输索引'}
            volumes=data['volumes']
            if not 1<=len(volumes)<=5 or volumes[0]['role']!='index' or any(row.get('role')!='data' for row in volumes[1:]):raise ValueError()
            for row in volumes:
                name=row['name'];target=(self.folder/name).resolve()
                if not isinstance(name,str) or not name or '/' in name or '\\' in name or ':' in name or target.parent!=self.folder or not name.lower().endswith('.zip') or not SHA.fullmatch(row['sha256']) or not 22<=row['bytes']<=64*1024*1024 or target.stat().st_size!=row['bytes']:raise ValueError()
            return {'available':True,'buildId':hashlib.sha256(raw).hexdigest(),'title':data['title'],'sourceSha256':data['sourceSha256'],'manifestSha256':data['manifestSha256'],'extractedBytes':data['extractedBytes'],'volumes':volumes,'totalBytes':sum(row['bytes'] for row in volumes)}
        except (OSError,ValueError,KeyError,TypeError):return {'available':False,'reason':'离线分卷或传输索引已变化，请在配套服务重新准备'}

    def volume(self,build_id,number):
        data=self.info()
        if not data['available']:raise FileNotFoundError(data['reason'])
        if build_id!=data['buildId']:raise ValueError('分卷版本已更新，请重新开始导入')
        if not isinstance(number,int) or not 0<=number<len(data['volumes']):raise ValueError('分卷编号无效')
        return self.folder/data['volumes'][number]['name']
