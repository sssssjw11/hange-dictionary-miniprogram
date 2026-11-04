import { parseDocument } from 'htmlparser2';
import { unzlibSync, strFromU8 } from 'fflate';
import { sha256 } from '@noble/hashes/sha256';

export { unzlibSync, strFromU8, sha256 };
export function utf8Length(value) {
  let size = 0; for (const char of value) { const c = char.codePointAt(0); size += c < 128 ? 1 : c < 2048 ? 2 : c < 65536 ? 3 : 4; } return size;
}
export function utf8(value) {
  const result = [];
  for (const char of value) { const c = char.codePointAt(0); if (c < 128) result.push(c); else if (c < 2048) result.push(192 | (c >> 6), 128 | (c & 63)); else if (c < 65536) result.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); else result.push(240 | (c >> 18), 128 | ((c >> 12) & 63), 128 | ((c >> 6) & 63), 128 | (c & 63)); }
  return new Uint8Array(result);
}
export function hashBucket(value) { let hash = 2166136261; for (const byte of utf8(value)) hash = Math.imul(hash ^ byte, 16777619); return hash & 255; }
export function hex(value) { return Array.from(value).map(x => x.toString(16).padStart(2, '0')).join(''); }
export function decodeDeltas(value) {
  const result = []; let number = 0, shift = 0, previous = 0;
  for (let i = 0; i < value.length; i += 2) { const byte = parseInt(value.slice(i, i + 2), 16); number |= (byte & 127) << shift; if (byte & 128) shift += 7; else { previous += number; result.push(previous); number = 0; shift = 0; } }
  if (shift) throw new Error('词库索引不完整'); return result;
}
const ignored = new Set(['script','style','link','meta','base','iframe','object','embed','img','audio','video','source','audio-wr']);
const allowed = new Set(['div','span','p','b','strong','i','em','u','s','sub','sup','br','hr','ul','ol','li','h1','h2','h3','h4','blockquote']);
function text(node) { return node.type === 'text' ? node.data : (node.children || []).filter(child => !ignored.has(child.name)).map(text).join(''); }
function inlineTranslation(node) {
  for(let parent=node.parent;parent;parent=parent.parent){
    if(['deft','xt','at','ot'].includes(parent.name))return false;
    if(['subjt','dis-gt','shcutt'].includes(parent.name)||/\b(labels|grammar|registerlab|regionlab|dis-g|shcut|heading|unbox-title)\b/.test((parent.attribs||{}).class||''))return true;
  }
  return false;
}
export function plainText(html) { return text(parseDocument(html, { decodeEntities: true })); }
function summaryParts(root) {
  const definitions=[],fallback=[];
  function visit(node,definition=false) {
    if(ignored.has(node.name))return;
    definition=definition||node.name==='deft';
    if(node.name==='chn'){
      const value=text(node).replace(/\s+/g,' ').trim();
      if(value){const target=definition?definitions:fallback;if(!target.includes(value)&&target.length<4)target.push(value);}
    }
    for(const child of node.children||[])visit(child,definition);
  }
  visit(root);return {definitions,fallback};
}
function summary(parts) { return Array.from((parts.definitions.length?parts.definitions:parts.fallback.slice(0,1)).join(' / ')).slice(0,240).join(''); }
export function oxfordSummary(html) { return summary(summaryParts(parseDocument(html,{decodeEntities:true}))); }
export function renderOxford(pages) {
  const blocks = [], related = [], phonetics = {}, examples = [], parts={definitions:[],fallback:[]}; let chineseNodes = 0, senses = 0;
  pages.forEach((page, pageIndex) => {
    const root = parseDocument(page.html, { decodeEntities: true });
    const currentSummary=summaryParts(root);
    for(const type of ['definitions','fallback'])for(const value of currentSummary[type])if(parts[type].length<4&&!parts[type].includes(value))parts[type].push(value);
    function convert(node) {
      if (node.type === 'text') return { type: 'text', text: node.data };
      if (node.type === 'comment' || ignored.has(node.name)) return null;
      const name = node.name || 'div', classes = new Set(((node.attribs || {}).class || '').split(/\s+/));
      if (name === 'chn') chineseNodes++;
      if (classes.has('sense')) senses++;
      if(classes.has('x')){let next=node.next;while(next&&next.type==='text'&&!next.data.trim())next=next.next;const en=text(node).trim(),zh=next&&next.name==='xt'?text(next).trim():'';if(en)examples.push({en,zh,source:'牛津十版'});}
      if (classes.has('audio_play_button')) return null;
      const href = (node.attribs || {}).href || '';
      if (/^sound:/i.test(href)) return null;
      if (/^(entry|dic|bword):\/\//i.test(href)) { try { const word = decodeURIComponent(href.split('://')[1].split('#')[0]); if (word.length > 0 && word.length <= 256 && !word.startsWith('@')) related.push(word); } catch (_) {} }
      if (classes.has('phons_br') || classes.has('phons_n_am')) {
        const find = current => ((current.attribs || {}).class || '').split(/\s+/).includes('phon') ? text(current) : (current.children || []).map(find).find(Boolean);
        const value = find(node); if (value) phonetics[classes.has('phons_br') ? 'uk' : 'us'] = value;
      }
      let tag = allowed.has(name) ? name : 'span', style = 'max-width:100%;word-break:normal;overflow-wrap:break-word;line-height:1.75;';
      if (['html','body','section','article','table','tbody','thead','tfoot','tr','deft','xt'].includes(name)) tag = 'div';
      if (['td','th'].includes(name)) { tag = 'span'; style += 'display:inline-block;padding-right:12px;'; }
      if (name === 'chn') style += inlineTranslation(node)?'display:inline;opacity:.8;margin-left:5px;':'display:block;opacity:.85;margin:2px 0 7px;';
      if (['deft','xt'].includes(name)) style += 'margin:3px 0 9px;';
      if (classes.has('sense')) style += 'margin:14px 0;';
      if (classes.has('webtop')) style += 'display:block;padding-bottom:8px;margin-bottom:10px;border-bottom:1px solid #9dbbd233;';
      if (classes.has('headword')) style += 'font-size:20px;font-weight:600;margin:0 0 4px;';
      if (classes.has('phonetics')) style += 'display:block;margin:4px 0;';
      if (classes.has('phons_br')||classes.has('phons_n_am')) style += 'display:inline-block;margin-right:12px;';
      if (classes.has('labels')) style += 'display:block;margin:4px 0;';
      if (classes.has('link-right')) style += 'display:block;font-size:11px;text-align:right;opacity:.55;margin:4px 0;';
      if (['pos','grammar','labels','registerlab','regionlab'].some(x => classes.has(x))) style += 'font-size:13px;opacity:.8;';
      if (classes.has('pos')) style += 'font-style:italic;margin-left:6px;';
      if (classes.has('unbox') || classes.has('collapse')) style += 'margin:10px 0;padding:10px;border:1px solid #9dbbd244;border-radius:8px;';
      if (['heading','sensetop','unbox-title'].some(x => classes.has(x))) style += 'font-weight:600;';
      if (['ol','ul'].includes(name)) style += 'padding-left:20px;margin:6px 0;';
      const children = (node.children || []).map(convert).filter(Boolean);
      if (classes.has('phons_br')) children.unshift({ type: 'text', text: '英 ' });
      if (classes.has('phons_n_am')) children.unshift({ type: 'text', text: '美 ' });
      return { type: 'node', name: tag, attrs: { style }, children };
    }
    function fragments(node) {
      if (utf8Length(JSON.stringify(node)) <= 18000) return [node];
      if (node.type === 'text') { const chunks = []; for (let i = 0; i < node.text.length; i += 3000) { let end = Math.min(node.text.length, i + 3000); if (end < node.text.length && /[\uD800-\uDBFF]/.test(node.text[end - 1])) end--; chunks.push({ type:'text', text:node.text.slice(i,end) }); i = end - 3000; } return chunks; }
      return (node.children || []).flatMap(child => fragments(child).map(fragment => Object.assign({}, node, { children: [fragment] })));
    }
    let current = [], size = 0;
    for (const child of root.children) {
      const node = convert(child); if (!node) continue;
      for (const fragment of fragments(node)) { const length = utf8Length(JSON.stringify(fragment)); if (current.length && size + length > 22000) { blocks.push({ id: pageIndex + '-' + blocks.length, nodes: current }); current = []; size = 0; } current.push(fragment); size += length; }
    }
    if (current.length) blocks.push({ id: pageIndex + '-' + blocks.length, nodes: current });
  });
  return { title: '牛津高阶英汉双解 · 第10版', documents: pages.length, blocks, related: Array.from(new Set(related)), phonetics, chineseNodes, senses, examples, brief:summary(parts) };
}
