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
const appConfig=JSON.parse(fs.readFileSync(path.join(source,'app.json'),'utf8'));const pageCount=appConfig.pages.length,componentCount=Object.keys(appConfig.usingComponents||{}).length+(appConfig.tabBar.custom?1:0);
const report = { compiler: 'miniprogram-compiler 0.2.3 (official wcc/wcsc wrapper)', native_wxml: 'passed', native_wxss: 'passed', page_count:pageCount,component_count:componentCount,template_count:pageCount+componentCount, wechat_devtools_runtime: 'not covered by this compiler check; see docs/VERIFICATION.md', phone_runtime: 'not tested' };
fs.writeFileSync(path.join(output, 'compilation-verification.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
