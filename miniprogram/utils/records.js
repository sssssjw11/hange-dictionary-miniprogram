// Two rotating user-file slots: a failed write never replaces the committed copy.
const store = require('./store');
const NAMES = new Set(['study','library','sentences','chat','daily','tools']);
const HEADS='hange.records.heads.v1';
function heads(){return wx.getStorageSync(HEADS)||{files:{},fallback:{}};}
function check(name) { if (!NAMES.has(name)) throw new Error('未知的本地数据类型'); }
function files() { if (!wx.env || !wx.getFileSystemManager) return null; const fs = wx.getFileSystemManager(); return fs.readFileSync && fs.writeFileSync && fs.mkdirSync ? fs : null; }
function root() { return wx.env.USER_DATA_PATH + '/hange-learning'; }
function read(name, fallback) {
  check(name); const head=heads();const slot=head.files&&head.files[name];const pointer=slot===0||slot===1?{slot}:wx.getStorageSync('hange.records.' + name); const fs = files();
  if (!fs) return JSON.parse(JSON.stringify((head.fallback||{})[name]||wx.getStorageSync('hange.records.fallback.' + name)||fallback));
  if (!pointer) return JSON.parse(JSON.stringify((head.fallback||{})[name]||wx.getStorageSync('hange.records.fallback.' + name)||fallback));
  for (const slot of [pointer.slot, 1-pointer.slot]) {
    try { const data = JSON.parse(fs.readFileSync(root() + '/' + name + '-' + slot + '.json','utf8')); if (data.version !== 1) throw new Error('版本不支持'); return data.value; } catch (_) {}
  }
  throw new Error('本地' + name + '数据无法读取，请保留文件并从备份恢复');
}
function prepare(name, value) {
  check(name); const text = JSON.stringify({ version: 1, value });
  if (store.bytes(text) > 2*1024*1024) throw new Error('这类学习记录已达到 2 MiB，请导出后整理内容');
  const fs = files();
  if (!fs) { if (store.bytes(text) > 850000) throw new Error('当前运行环境的本地缓存不足'); return {name,value}; }
  try { fs.mkdirSync(root(), true); } catch (_) {}
  const head=heads(),oldSlot=head.files&&head.files[name];const previous=oldSlot===0||oldSlot===1?{slot:oldSlot}:wx.getStorageSync('hange.records.' + name), slot = previous ? 1-previous.slot : 0;
  fs.writeFileSync(root() + '/' + name + '-' + slot + '.json', text, 'utf8');
  return {name,slot};
}
function commit(prepared,learning){const head=heads();head.files=head.files||{};head.fallback=head.fallback||{};for(const item of prepared){check(item.name);if(item.slot===0||item.slot===1){head.files[item.name]=item.slot;delete head.fallback[item.name];}else head.fallback[item.name]=item.value;}if(learning!==undefined)head.learning=learning;if(store.bytes(JSON.stringify(head))>950000)throw new Error('本地记录索引容量不足，请先导出并整理数据');wx.setStorageSync(HEADS,head);}
function write(name,value){commit([prepare(name,value)]);}
function snapshot(){const head=heads(),result={};for(const name of NAMES)if(Object.prototype.hasOwnProperty.call(head.files||{},name)||Object.prototype.hasOwnProperty.call(head.fallback||{},name)||wx.getStorageSync('hange.records.'+name)||wx.getStorageSync('hange.records.fallback.'+name))result[name]=read(name,{});return result;}
module.exports = { read, write, prepare, commit, snapshot, names: Array.from(NAMES) };
