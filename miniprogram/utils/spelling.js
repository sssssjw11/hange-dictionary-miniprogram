// Bounded spelling suggestions. Callers normalize keys before ranking.
function eligible(key, minimum = 2) {
  return Array.from(key).length >= minimum && key.length <= 256 && /\p{Script=Latin}/u.test(key) && /^[\p{Script=Latin}\p{M}0-9' -]+$/u.test(key);
}
function distance(left, right, limit) {
  const a = Array.isArray(left) ? left : Array.from(left), b = Array.isArray(right) ? right : Array.from(right);
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let older = null, previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = Array(b.length + 1).fill(limit + 1); current[0] = i;
    let smallest = current[0];
    for (let j = Math.max(1, i - limit); j <= Math.min(b.length, i + limit); j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) current[j] = Math.min(current[j], older[j - 2] + 1);
      smallest = Math.min(smallest, current[j]);
    }
    if (smallest > limit) return limit + 1;
    older = previous; previous = current;
  }
  return Math.min(limit + 1, previous[b.length]);
}
function compare(a, b) {
  for (let i = 0; i < a.score.length; i++) if (a.score[i] !== b.score[i]) return a.score[i] - b.score[i];
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}
function rank(query, items, limit = 8) {
  if (!eligible(query)) return [];
  const chars = Array.from(query), tolerance = chars.length < 5 ? 1 : 2, best = [];
  for (const item of items) {
    if (item.key === query) return [];
    if (!eligible(item.key, 1)) continue;
    const target = Array.from(item.key);
    if (Math.abs(chars.length - target.length) > tolerance) continue;
    const cost = distance(chars, target, tolerance); if (cost > tolerance) continue;
    let prefix = 0; while (prefix < chars.length && chars[prefix] === target[prefix]) prefix++;
    const candidate = Object.assign({}, item, { score: [cost, Math.abs(chars.length - target.length), -prefix, item.word === item.key ? 0 : 1] });
    const duplicate = best.findIndex(row => row.key === item.key);
    if (duplicate >= 0) { if (compare(candidate, best[duplicate]) >= 0) continue; best.splice(duplicate, 1); }
    best.push(candidate); best.sort(compare); if (best.length > limit) best.pop();
  }
  return best;
}
module.exports = { eligible, distance, rank };
