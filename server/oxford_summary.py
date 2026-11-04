"""Choose actual definitions for previews while retaining the full source body."""
from bs4 import BeautifulSoup

IGNORED = {'script', 'style', 'link', 'meta', 'base', 'iframe', 'object',
           'embed', 'img', 'audio', 'video', 'source', 'audio-wr'}


def oxford_summary(source):
    soup = BeautifulSoup(source, 'html.parser') if isinstance(source, str) else source
    definitions, fallback = [], []
    for node in soup.find_all('chn'):
        ancestors = list(node.parents)
        if any(parent.name in IGNORED for parent in ancestors):
            continue
        value = ' '.join(node.get_text().split())
        target = definitions if any(parent.name == 'deft' for parent in ancestors) else fallback
        if value and value not in target and len(target) < 4:
            target.append(value)
    return ' / '.join(definitions or fallback[:1])[:240]
