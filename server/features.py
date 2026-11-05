"""Real optional services. Missing models/configuration are explicit unavailable states."""
from functools import lru_cache
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import threading
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import wave

ROOT=Path(__file__).resolve().parents[1]
OPTIONAL=ROOT/'server/.optional-python'
if OPTIONAL.is_dir():sys.path.insert(0,str(OPTIONAL))
RUNTIME=ROOT/'server/runtime'
MODEL_NAMES={'en':'vosk-model-small-en-us-0.15','zh':'vosk-model-small-cn-0.22'}
HIDDEN=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0


class Unavailable(RuntimeError):pass


def has_module(name):
    try:return importlib.util.find_spec(name) is not None
    except (ImportError,ValueError):return False


def ffmpeg_path():
    path=shutil.which('ffmpeg')
    if path:return path
    if has_module('imageio_ffmpeg'):
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    return None


def model_runtime_path(path):
    if os.name!='nt' or str(path).isascii():return path
    # Kaldi's Windows narrow-character file API cannot open Chinese paths.
    import ctypes
    buffer=ctypes.create_unicode_buffer(32768)
    if ctypes.windll.kernel32.GetShortPathNameW(str(path),buffer,len(buffer)) and buffer.value.isascii():return Path(buffer.value)
    folder=Path(tempfile.gettempdir())/('hange-speech-'+hashlib.sha256(str(path.parent).encode()).hexdigest()[:12])
    if not str(folder).isascii():raise Unavailable('请把语音模型放在英文路径，并配置 HANGE_VOSK_MODEL_ROOT')
    alias=folder/path.name
    result=subprocess.run(['powershell','-NoProfile','-NonInteractive','-File',str(ROOT/'server/model_alias_windows.ps1'),'-TargetPath',str(path),'-AliasPath',str(alias)],capture_output=True,timeout=15,creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:raise Unavailable('无法创建语音模型的兼容路径，请配置英文模型目录')
    return alias


@lru_cache(maxsize=1)
def voices():
    if os.name!='nt':return []
    code="[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Speech; $s=[System.Speech.Synthesis.SpeechSynthesizer]::new(); try { [object[]]$localVoices=@($s.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { @{id=$_.VoiceInfo.Name;locale=$_.VoiceInfo.Culture.Name} }); ConvertTo-Json -InputObject $localVoices -Compress } finally { $s.Dispose() }"
    result=subprocess.run(['powershell','-NoProfile','-NonInteractive','-Command',code],capture_output=True,timeout=15,creationflags=HIDDEN)
    if result.returncode:return []
    value=json.loads(result.stdout.decode('utf-8-sig','replace'))
    return value if isinstance(value,list) else [value]


class Features:
    def __init__(self):
        self.ocr_engine=None;self.ocr_lock=threading.Lock();self.models={};self.speech_lock=threading.Lock()

    def capabilities(self):
        available_voices=voices()
        model_root=Path(os.environ.get('HANGE_VOSK_MODEL_ROOT',str(ROOT/'server/models')))
        asr_languages=[language for language,name in MODEL_NAMES.items() if (model_root/name/'am/final.mdl').is_file()]
        ai=bool(os.environ.get('HANGE_AI_BASE_URL') and os.environ.get('HANGE_AI_MODEL'))
        ocr=all(has_module(name) for name in ['rapidocr','onnxruntime','PIL','numpy'])
        asr=has_module('vosk') and bool(asr_languages) and bool(ffmpeg_path())
        return {'tts':{'available':bool(available_voices),'engine':'Windows SAPI' if available_voices else '', 'voices':available_voices,'reason':'' if available_voices else '当前服务端未安装可用的本地朗读引擎'},
                'ocr':{'available':ocr,'engine':'RapidOCR / ONNX Runtime','reason':'' if ocr else '需在服务端安装本地 OCR 依赖'},
                'asr':{'available':asr,'languages':asr_languages,'engine':'Vosk offline','reason':'' if asr else '需安装 Vosk、FFmpeg，并准备所选语言的本地模型'},
                'ai':{'available':ai,'model':os.environ.get('HANGE_AI_MODEL',''),'reason':'' if ai else '服务端尚未配置模型服务地址和模型名称'},
                'translation':{'available':ai,'reason':'' if ai else '全文翻译需要配置可用模型服务'},
                'documents':{'available':True,'epub':True,'pdf':has_module('fitz'),'txt':True}}

    def voice_catalog(self,refresh=False):
        if refresh:voices.cache_clear()
        available=voices()
        return {'available':bool(available),'voices':available,'engine':'Windows SAPI' if available else '','reason':'' if available else '当前服务端未安装可用的本地朗读引擎'}

    def synthesize(self,text,variant='US',language='en',rate=0,voice_id=''):
        if not isinstance(text,str) or variant not in ['US','UK'] or language not in ['en','zh'] or not isinstance(rate,(int,float)) or not isinstance(voice_id,str) or len(voice_id)>160 or re.search(r'[\x00-\x1f\x7f]',voice_id):raise ValueError('朗读请求格式无效')
        text=text.strip()
        if not text or len(text)>2500:raise ValueError('朗读文本须为 1～2500 字')
        available=voices()
        if not available:raise Unavailable('当前服务端没有可用的本地朗读引擎')
        wanted='zh-CN' if language=='zh' else 'en-GB' if variant=='UK' else 'en-US'
        if voice_id:
            voice=next((v for v in available if v['id']==voice_id),None)
            if voice is None:raise Unavailable('所选音色未安装，请刷新音色列表或选择自动')
            if not voice['locale'].startswith(language):raise ValueError('所选音色与朗读语言不同，请重新选择')
        else:
            voice=next((v for v in available if v['locale']==wanted),None)
            if voice is None:voice=next((v for v in available if v['locale'].startswith('zh' if language=='zh' else 'en')),None)
        if voice is None:raise Unavailable('没有安装所选语言的系统语音')
        rate=max(-5,min(5,int(rate)))
        key=hashlib.sha256(json.dumps([text,voice['id'],rate],ensure_ascii=False).encode()).hexdigest()
        folder=RUNTIME/'audio';folder.mkdir(parents=True,exist_ok=True)
        wav=folder/(key+'.wav');mp3=folder/(key+'.mp3')
        with self.speech_lock:
            if not wav.is_file() and not mp3.is_file():
                request_file=folder/(key+'.request.json')
                request_file.write_text(json.dumps({'text':text,'voice':voice['id'],'rate':rate},ensure_ascii=False),'utf-8')
                try:
                    result=subprocess.run(['powershell','-NoProfile','-NonInteractive','-File',str(ROOT/'server/speak_windows.ps1'),'-RequestFile',str(request_file),'-OutputFile',str(wav)],capture_output=True,timeout=90,creationflags=HIDDEN)
                    if result.returncode or not wav.is_file():raise RuntimeError('系统朗读生成失败')
                finally:
                    request_file.unlink(missing_ok=True)
            executable=ffmpeg_path()
            if executable and not mp3.is_file():
                result=subprocess.run([executable,'-nostdin','-v','error','-y','-i',str(wav),'-codec:a','libmp3lame','-b:a','64k',str(mp3)],capture_output=True,timeout=30,creationflags=HIDDEN)
                if result.returncode:mp3.unlink(missing_ok=True)
            chosen=mp3 if mp3.is_file() else wav
        return {'audioPath':'/api/audio/'+chosen.name,'voice':voice['id'],'voiceExplicit':bool(voice_id),'locale':voice['locale'],'variantFallback':voice['locale']!=wanted,'engine':'Windows SAPI','bytes':chosen.stat().st_size}

    def audio(self,name):
        if not re.fullmatch('[0-9a-f]{64}\\.(mp3|wav)',name):raise FileNotFoundError('音频不存在')
        path=RUNTIME/'audio'/name
        if not path.is_file():raise FileNotFoundError('音频不存在')
        return path

    def recognize_image(self,blob):
        if not has_module('rapidocr') or not has_module('onnxruntime'):raise Unavailable('尚未安装本地 OCR 引擎')
        if len(blob)>8*1024*1024:raise ValueError('图片最大为 8 MiB')
        from PIL import Image
        import numpy as np
        try:
            with Image.open(io.BytesIO(blob)) as image:
                if image.width*image.height>20000000:raise ValueError('图片像素过大，请压缩后重试')
                image=image.convert('RGB');image.thumbnail((2400,2400));pixels=np.array(image)
        except (OSError,Image.DecompressionBombError) as error:raise ValueError('无法读取该图片') from error
        with self.ocr_lock:
            if self.ocr_engine is None:
                from rapidocr import RapidOCR
                self.ocr_engine=RapidOCR(params={'Global.log_level':'error'})
            result=self.ocr_engine(pixels)
        texts=list(getattr(result,'txts',None) or []);scores=list(getattr(result,'scores',None) or [])
        return {'text':'\n'.join(texts),'lines':[{'text':text,'confidence':float(scores[index]) if index<len(scores) else None} for index,text in enumerate(texts)],'engine':'RapidOCR / ONNX Runtime'}

    def recognize_audio(self,blob,language='en'):
        if language not in MODEL_NAMES:raise ValueError('请选择英语或中文识别')
        model_path=Path(os.environ.get('HANGE_VOSK_MODEL_ROOT',str(ROOT/'server/models')))/MODEL_NAMES[language]
        if not has_module('vosk') or not (model_path/'am/final.mdl').is_file():raise Unavailable('所选语言的离线语音模型尚未安装')
        executable=ffmpeg_path()
        if not executable:raise Unavailable('服务端缺少 FFmpeg 音频转换工具')
        if len(blob)>10*1024*1024 or blob[:4]!=b'RIFF' or blob[8:12]!=b'WAVE':raise ValueError('请上传不超过 10 MiB 的 WAV 录音')
        try:
            with wave.open(io.BytesIO(blob),'rb') as original:
                if original.getnframes()/original.getframerate()>60.1:raise ValueError('单次语音输入最多 60 秒，请分段录制')
        except wave.Error as error:raise ValueError('WAV 录音格式无法读取') from error
        import vosk
        vosk.SetLogLevel(-1)
        folder=RUNTIME/'speech';folder.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=folder) as temporary:
            source=Path(temporary)/'input.wav';output=Path(temporary)/'mono.wav';source.write_bytes(blob)
            result=subprocess.run([executable,'-nostdin','-v','error','-y','-i',str(source),'-ar','16000','-ac','1','-sample_fmt','s16','-t','60',str(output)],capture_output=True,timeout=30,creationflags=HIDDEN)
            if result.returncode:raise ValueError('录音格式无法解码')
            with wave.open(str(output),'rb') as audio:
                if audio.getnframes()>60*16000:raise ValueError('单次最多识别 60 秒录音')
                with self.speech_lock:
                    if language not in self.models:self.models[language]=vosk.Model(str(model_runtime_path(model_path)))
                    recognizer=vosk.KaldiRecognizer(self.models[language],16000)
                phrases=[]
                while data:=audio.readframes(4000):
                    if recognizer.AcceptWaveform(data):phrases.append(json.loads(recognizer.Result()).get('text',''))
                phrases.append(json.loads(recognizer.FinalResult()).get('text',''))
        text=' '.join(value for value in phrases if value)
        if language=='zh':text=text.replace(' ','')
        return {'text':text,'language':language,'engine':'Vosk offline'}

    def assistant(self,payload):
        base=os.environ.get('HANGE_AI_BASE_URL','').rstrip('/');model=os.environ.get('HANGE_AI_MODEL','')
        if not base or not model:raise Unavailable('尚未配置真实模型服务，AI 问答与全文翻译暂不可用')
        if not re.match(r'^https?://',base):raise Unavailable('模型服务地址配置无效')
        task=payload.get('task','chat');allowed={'chat','translate','writing','explain','summarize'}
        if task not in allowed:raise ValueError('不支持的 AI 任务')
        messages=payload.get('messages',[])
        if not isinstance(messages,list) or not messages or len(messages)>20:raise ValueError('对话须包含 1～20 条消息')
        clean=[];characters=0
        for item in messages:
            if not isinstance(item,dict) or item.get('role') not in ['user','assistant'] or not isinstance(item.get('content'),str):raise ValueError('对话消息格式无效')
            characters+=len(item['content']);clean.append({'role':item['role'],'content':item['content']})
        if characters>16000:raise ValueError('本次对话文本过长，请新建对话或缩短内容')
        prompts={'chat':'You are a helpful bilingual English learning assistant. Explain accurately in Chinese unless asked otherwise. Distinguish uncertainty. Do not claim access to a dictionary you were not provided.',
                 'translate':'Translate the complete user text faithfully. Output only the translation in '+('English' if payload.get('target')=='en' else 'Simplified Chinese')+'. Preserve paragraphs, meaning, names, and numbers. Do not omit content.',
                 'writing':'Help revise English writing. Show the revised text, then explain important corrections in Chinese. Preserve the author\'s intended meaning.',
                 'explain':'Explain the English word, phrase, or sentence in Chinese, including relevant usage and original examples. Do not invent quotations or dictionary attribution.',
                 'summarize':'Summarize the provided text in clear Chinese. Separate source facts from inferences.'}
        body=json.dumps({'model':model,'messages':[{'role':'system','content':prompts[task]}]+clean,'stream':False,'max_tokens':int(os.environ.get('HANGE_AI_MAX_TOKENS','2048'))}).encode()
        headers={'Content-Type':'application/json','Accept':'application/json'}
        key=os.environ.get('HANGE_AI_API_KEY')
        if key:headers['Authorization']='Bearer '+key
        try:
            with urlopen(Request(base+'/chat/completions',data=body,headers=headers),timeout=90) as response:data=json.load(response)
        except (HTTPError,URLError,TimeoutError) as error:raise RuntimeError('模型服务调用失败，请检查服务端连接和配置') from error
        choice=(data.get('choices') or [{}])[0];content=choice.get('message',{}).get('content','')
        if not isinstance(content,str) or not content.strip():raise RuntimeError('模型未返回可用文本')
        return {'text':content,'model':model,'incomplete':choice.get('finish_reason')=='length','task':task}
