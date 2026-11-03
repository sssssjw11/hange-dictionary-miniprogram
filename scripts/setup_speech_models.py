"""Download optional Apache-2.0 Vosk models from the publisher's model list."""
from pathlib import Path
import argparse
import json
import shutil
import urllib.request
import zipfile

ROOT=Path(__file__).resolve().parents[1]
MODELS={'en':'vosk-model-small-en-us-0.15','zh':'vosk-model-small-cn-0.22'}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--languages',nargs='+',choices=list(MODELS),default=['en','zh'])
    args=parser.parse_args();folder=ROOT/'server/models';folder.mkdir(parents=True,exist_ok=True)
    for language in args.languages:
        name=MODELS[language];target=folder/name
        if (target/'am/final.mdl').is_file():
            print(language+': already installed',flush=True);continue
        url='https://alphacephei.com/vosk/models/'+name+'.zip';archive_path=folder/(name+'.zip')
        if not archive_path.is_file():
            print(language+': downloading official model',flush=True)
            temporary=archive_path.with_suffix('.download')
            request=urllib.request.Request(url,headers={'User-Agent':'HangeDictionaryLocalSetup'})
            with urllib.request.urlopen(request,timeout=30) as source,temporary.open('wb') as out:
                shutil.copyfileobj(source,out,1024*1024)
            temporary.replace(archive_path)
        with zipfile.ZipFile(archive_path) as archive:
            assert archive.testzip() is None
            for info in archive.infolist():
                path=(folder/info.filename).resolve()
                if not path.is_relative_to(folder.resolve()) or not info.filename.startswith(name+'/'):
                    raise ValueError('Unexpected model archive path')
            archive.extractall(folder)
        if not (target/'am/final.mdl').is_file():raise RuntimeError('Model setup incomplete')
        print(language+': ready',flush=True)
    print(json.dumps({'models':args.languages,'source':'https://alphacephei.com/vosk/models','license':'Apache-2.0'}))


if __name__=='__main__':main()
