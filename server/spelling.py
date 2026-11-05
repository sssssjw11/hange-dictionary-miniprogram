"""Rank actual dictionary headwords; suggestions never replace the query."""
import unicodedata


def eligible(key, minimum=2):
    latin = lambda char: unicodedata.name(char, '').startswith('LATIN ')
    return (minimum <= len(key) <= 256 and any(latin(char) for char in key)
            and all(latin(char) or unicodedata.category(char).startswith('M') or char in "0123456789' -" for char in key))


def distance(left, right, limit):
    if abs(len(left) - len(right)) > limit:
        return limit + 1
    older, previous = None, list(range(len(right) + 1))
    for i, char in enumerate(left, 1):
        current = [limit + 1] * (len(right) + 1)
        current[0] = i
        for j in range(max(1, i - limit), min(len(right), i + limit) + 1):
            current[j] = min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (char != right[j - 1]))
            if i > 1 and j > 1 and char == right[j - 2] and left[i - 2] == right[j - 1]:
                current[j] = min(current[j], older[j - 2] + 1)
        if min(current) > limit:
            return limit + 1
        older, previous = previous, current
    return min(limit + 1, previous[-1])


def rank(query, items, limit=8):
    if not eligible(query):
        return []
    tolerance, best = 1 if len(query) < 5 else 2, []
    for item in items:
        key = item['key']
        if key == query:
            return []
        if not eligible(key, 1) or abs(len(query) - len(key)) > tolerance:
            continue
        cost = distance(query, key, tolerance)
        if cost > tolerance:
            continue
        prefix = 0
        while prefix < len(query) and prefix < len(key) and query[prefix] == key[prefix]:
            prefix += 1
        candidate = dict(item, score=(cost, abs(len(query) - len(key)), -prefix, int(item['word'] != key), key))
        duplicate = next((index for index, row in enumerate(best) if row['key'] == key), None)
        if duplicate is not None:
            if best[duplicate]['score'] <= candidate['score']:
                continue
            del best[duplicate]
        best.append(candidate)
        best.sort(key=lambda row: row['score'])
        del best[limit:]
    return best
