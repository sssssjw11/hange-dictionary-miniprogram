"""Audit the tracked Git files rather than assuming .gitignore is sufficient."""
from pathlib import Path
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def main():
    names = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode('utf-8').split('\x00')
    names = [name for name in names if name]
    forbidden = {'.mdx', '.mdd', '.db', '.apk', '.pem', '.key', '.keystore', '.zip'}
    secrets = [r'github_pat_[A-Za-z0-9_]{40,}', r'gh[pousr]_[A-Za-z0-9]{20,}', r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----']
    total = 0
    for name in names:
        path = ROOT / name
        assert not name.startswith(('server/data/', 'server/models/', 'server/runtime/', 'server/.optional-python/', 'output/', 'node_modules/', 'private/')), name
        assert path.suffix.lower() not in forbidden and not name.endswith(('.db.gz', '.db-wal', '.db-shm')), name
        assert path.stat().st_size < 1024 * 1024, name
        content = path.read_bytes(); total += len(content)
        if path.suffix != '.png':
            value = content.decode('utf-8-sig')
            assert not any(re.search(pattern, value) for pattern in secrets), name
            assert not re.search(r'[A-Z]:[\\/]Users[\\/]', value), name
    assert names
    print(json.dumps({'tracked_files': len(names), 'tracked_bytes': total, 'private_dictionary_files': 0, 'signing_keys_or_tokens': 0, 'personal_learning_records': 0}))


if __name__ == '__main__':
    main()
