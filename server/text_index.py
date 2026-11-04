"""Shared normalization and Chinese search terms for the service and pack builder."""
import re
import unicodedata

HAN = re.compile(r'[\u3400-\u9fff\uf900-\ufaff\U00020000-\U0003ffff]+')


def normalize(value):
    return ' '.join(unicodedata.normalize('NFC', value).replace('_', ' ').replace('’', "'").lower().split())


def has_han(value):
    return HAN.search(value) is not None


def index_terms(value):
    terms = set()
    for phrase in HAN.findall(normalize(value)):
        terms.update(phrase)
        terms.update(phrase[index:index + 2] for index in range(len(phrase) - 1))
    return terms


def query_terms(value, single_character=True):
    terms = set()
    for phrase in HAN.findall(normalize(value)):
        if len(phrase) == 1 and single_character:
            terms.add(phrase)
        terms.update(phrase[index:index + 2] for index in range(len(phrase) - 1))
    return sorted(terms)


def meaning_rank(brief, term):
    brief, term = normalize(brief), normalize(term)
    if brief == term or any(part.strip() == term for part in re.split(r'[/；;、，,]', brief)):
        return 0
    if brief.startswith(term):
        return 1
    return 2 if term in brief else 3
