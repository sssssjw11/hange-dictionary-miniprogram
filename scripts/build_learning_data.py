"""Generate the native JS data module; WeChat require does not load JSON."""
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
source=ROOT/'miniprogram/data/learning.json'
target=source.with_suffix('.js')
data=json.loads(source.read_text('utf-8'))
target.write_text('// Generated from learning.json by scripts/build_learning_data.py.\nmodule.exports='+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8',newline='\n')
print('Built native learning data: '+str(len(data))+' topics.')
