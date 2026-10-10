// Headless screenshot helper for development.
//   node aot/tools/shot.mjs <path-under-repo e.g. aot/dev/titan-test.html> <out.png> [waitMs=4000] [WxH=1280x720]
// Serves the repo root, opens the page in headless Chromium (SwiftShader WebGL), prints console errors, saves a PNG.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { serve } from '../../tools/serve.mjs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const [page_, out = 'shot.png', wait = '4000', size = '1280x720'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
const { srv, url } = await serve(ROOT);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', e => console.log('[pageerror]', e.message, e.stack?.split('\n').slice(0, 3).join(' | ')));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}]`, m.text()); });
await page.goto(`${url}/${page_}`);
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
console.log('saved', out);
await browser.close();
srv.close();
