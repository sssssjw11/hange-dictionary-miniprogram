"""Index existing private ZIP volumes for transfer through the local API."""
from pathlib import Path
import argparse
import json
import sys
import zipfile

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'server'))
from pack_transfer import prepare_index,REGISTRY


def main():
    parser=argparse.ArgumentParser(description='Prepare your own offline volumes for the configured local service.')
    parser.add_argument('volumes',nargs='+',type=Path)
    parser.add_argument('--output',type=Path,help='Transfer index beside the ZIP volumes')
    args=parser.parse_args();output=args.output or args.volumes[0].resolve().parent/REGISTRY
    try:
        result=prepare_index(args.volumes,output)
        print(json.dumps({'volumes':len(result['volumes']),'totalBytes':sum(row['bytes'] for row in result['volumes']),'sourceSha256':result['sourceSha256']}))
    except (OSError,ValueError,KeyError,TypeError,zipfile.BadZipFile) as error:parser.error(str(error))


if __name__=='__main__':main()
