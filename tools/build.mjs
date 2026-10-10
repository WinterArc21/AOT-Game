// Bundles the game into ONE self-contained HTML file (aot/dist/wings-of-freedom.html): double-click to play,
// no server needed.   node aot/tools/build.mjs   (needs esbuild + three resolvable, e.g. `npm i -D esbuild three`)
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const AOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const vendorPlugin = {
  name: 'vendor-three',
  setup(b) {
    b.onResolve({ filter: /^three$/ }, () => ({ path: path.join(AOT, 'vendor/three.module.min.js') }));
    b.onResolve({ filter: /^three\/addons\// }, (a) => ({ path: path.join(AOT, 'vendor/addons', a.path.slice('three/addons/'.length)) }));
  },
};
// main.js loads subsystems with dynamic import() so a broken module can't kill the game; esbuild inlines them.
const res = await build({
  entryPoints: [path.join(AOT, 'src/main.js')], bundle: true, format: 'esm', minify: true, write: false,
  plugins: [vendorPlugin], target: 'es2022', splitting: false, legalComments: 'none',
});
const js = res.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
let html = fs.readFileSync(path.join(AOT, 'index.html'), 'utf8');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\n?/, '');
html = html.replace(/<script type="module" src="\.\/src\/main\.js"><\/script>/, () => `<script type="module">\n${js}\n</script>`);
fs.mkdirSync(path.join(AOT, 'dist'), { recursive: true });
const out = path.join(AOT, 'dist/wings-of-freedom.html');
fs.writeFileSync(out, html);
console.log('wrote', out, (html.length / 1024).toFixed(0), 'KB');

// --artifact <file>: the same page without the document shell, for hosts that wrap the content in their own
// <!doctype>/<head>/<body> skeleton (title and styles first, then the markup and the inline module).
const ai = process.argv.indexOf('--artifact');
if (ai > 0 && process.argv[ai + 1]) {
  let frag = html
    .replace(/<!doctype html>\s*/i, '')
    .replace(/<html[^>]*>\s*/i, '').replace(/<\/html>\s*/i, '')
    .replace(/<head>\s*/i, '').replace(/<\/head>\s*/i, '')
    .replace(/<body>\s*/i, '').replace(/<\/body>\s*/i, '')
    .replace(/<meta charset="utf-8">\s*/i, '')
    .replace(/<meta name="viewport"[^>]*>\s*/i, '');
  const title = frag.match(/<title>[\s\S]*?<\/title>\s*/i)[0];
  frag = title + frag.replace(title, '');
  fs.writeFileSync(process.argv[ai + 1], frag);
  console.log('wrote', process.argv[ai + 1], (frag.length / 1024).toFixed(0), 'KB (artifact fragment)');
}
