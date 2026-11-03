const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
require('esbuild').buildSync({ entryPoints: [path.join(root, 'client-lib/codec.js')], outfile: path.join(root, 'miniprogram/vendor/codec.js'), bundle: true, platform: 'browser', format: 'cjs', target: 'es2018', minify: true, legalComments: 'eof' });
for (const [name, target] of [['fflate/LICENSE','fflate-LICENSE.txt'],['htmlparser2/LICENSE','htmlparser2-LICENSE.txt'],['@noble/hashes/LICENSE','noble-hashes-LICENSE.txt'],...['domhandler','domutils','domelementtype','dom-serializer','entities'].map(name=>[name+'/LICENSE',name+'-LICENSE.txt'])]) {
  fs.copyFileSync(path.join(root, 'node_modules', name), path.join(root, 'licenses', target));
}
console.log('Built mini-program codec without Node runtime dependencies.');
