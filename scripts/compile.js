// Syntax-check native templates with the official wcc/wcsc Node wrapper.
const fs = require('node:fs');
const path = require('node:path');
const { wxmlToJs, wxssToJs } = require('miniprogram-compiler');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'miniprogram');
const output = path.join(root, 'output');
fs.mkdirSync(output, { recursive: true });
const wxml = wxmlToJs(source, { maxBuffer: 8 * 1024 * 1024 });
const wxss = wxssToJs(source, { maxBuffer: 8 * 1024 * 1024 });
if (wxml.includes('Error:') || wxss.includes('Error:')) throw new Error('Native template compilation failed');
fs.writeFileSync(path.join(output, 'wxml-compiled.js'), wxml);
fs.writeFileSync(path.join(output, 'wxss-compiled.js'), wxss);
new Function('global', wxml); new Function('global', wxss);
const report = { compiler: 'miniprogram-compiler 0.2.3 (official wcc/wcsc wrapper)', native_wxml: 'passed', native_wxss: 'passed', template_count: 5, wechat_devtools_runtime: 'not tested; tool not installed', phone_runtime: 'not tested' };
fs.writeFileSync(path.join(output, 'compilation-verification.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
