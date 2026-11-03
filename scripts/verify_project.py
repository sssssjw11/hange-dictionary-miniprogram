"""Check the actual mini-program package, references, handlers and public files."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    mini = ROOT / 'miniprogram'
    config = json.loads((ROOT / 'project.config.json').read_text('utf-8'))
    app = json.loads((mini / 'app.json').read_text('utf-8'))
    assert config['miniprogramRoot'] == 'miniprogram/'
    assert config['compileType'] == 'miniprogram'
    assert config['appid'] == 'touristappid' or re.fullmatch(r'wx[0-9a-f]{16}', config['appid'])
    assert not app.get('permission') and not app.get('requiredPrivateInfos')
    for page in app['pages']:
        for extension in ['.js', '.json', '.wxml', '.wxss']:
            assert (mini / (page + extension)).is_file(), page + extension
        source = (mini / (page + '.js')).read_text('utf-8')
        template = (mini / (page + '.wxml')).read_text('utf-8')
        for event in re.findall(r'\b(?:bind|catch)(?:\w+|:[\w-]+)="(\w+)"', template):
            assert re.search(r'\b' + event + r'\s*\(', source), (page, event)
        assert '<web-view' not in template
    for item in app['tabBar']['list']:
        assert item['pagePath'] in app['pages']
        for key in ['iconPath', 'selectedIconPath']:
            assert (mini / item[key]).stat().st_size < 40000
    for path in mini.rglob('*.json'):
        json.loads(path.read_text('utf-8'))
    for path in list(mini.rglob('*.js')) + list((ROOT / 'scripts').glob('*.js')):
        subprocess.run(['node', '--check', str(path)], check=True, capture_output=True)
        if mini in path.parents:
            source = path.read_text('utf-8')
            assert not re.search(r'wx\.(login|authorize|getUserProfile|getLocation|getPhoneNumber|requestPayment)\s*\(', source), path
    files = [path for path in mini.rglob('*') if path.is_file()]
    size = sum(path.stat().st_size for path in files)
    assert size < 2 * 1024 * 1024, size
    assert not any(path.suffix.lower() in ['.db', '.mdx', '.mdd', '.apk', '.pem', '.key', '.keystore'] for path in files)
    offline = (mini / 'data/offline.js').read_text('utf-8')
    data = json.loads(offline.partition('module.exports=')[2].rstrip(';\n'))
    assert len(data['entries']) == 97
    assert all(not entry['oxford']['blocks'] for entry in data['entries'].values())
    assert 'source_sha256' not in offline
    report = {'pages': app['pages'], 'native_wxml_wxss': True, 'web_view_wrappers': 0, 'package_bytes': size, 'package_under_2_MiB': True, 'built_in_entries': len(data['entries']), 'built_in_aliases': len(data['aliases']), 'oxford_content_in_public_package': False, 'login_or_profile_permission_calls': 0, 'full_dictionary': 'read-only local/HTTPS API plus on-device cache', 'phone_runtime_tested': False}
    (ROOT / 'output').mkdir(exist_ok=True)
    (ROOT / 'output/project-verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), 'utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
