// Headless playtest driver. Needs Node + Playwright with Chromium, and the CDN libraries reachable
// (or mapped locally via LIBS=/path/to/node_modules). Builds the single-file page first:
//   node tools/build-artifact.mjs /tmp/kippwelt.html
//   node tools/playtest.cjs /tmp/kippwelt.html [runs] [maxDist]
// Human-like player: H=1.0 D=0.25 L=0.04 node tools/playtest.cjs ...  (horizon s, reaction delay s, lapse rate)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const page_ = process.argv[2], runs = +process.argv[3] || 4, maxDist = +process.argv[4] || 2500;
const NM = process.env.LIBS;
const map = NM ? {
  'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js': NM + '/gsap/dist/gsap.min.js',
  'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js': NM + '/three/build/three.module.min.js',
  'https://cdn.jsdelivr.net/npm/animejs@4.0.2/lib/anime.esm.min.js': NM + '/animejs/lib/anime.esm.min.js',
} : {};
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await (await browser.newContext({ viewport: { width: 200, height: 300 } })).newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  page.on('console', (m) => { if (m.text().startsWith('RUN ')) console.log(m.text()); });
  await page.route('**/*', (r) => {
    const u = r.request().url();
    if (map[u]) return r.fulfill({ path: map[u], contentType: 'application/javascript' });
    if (u === 'http://local/') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"></head><body>' + fs.readFileSync(page_, 'utf8') + '</body></html>' });
    return NM ? r.abort() : r.continue();
  });
  await page.goto('http://local/');
  await page.waitForTimeout(1500);
  await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, 'playtest-bot.js'), 'utf8') });
  const opts = [runs, maxDist, +(process.env.H || 1.4), +(process.env.D || 0), +(process.env.L || 0)];
  const res = await page.evaluate(async ([runs, maxDist, horizon, delay, lapse]) => window.kippweltBot.run({
    runs, maxDist, horizon, delay, lapse,
    onLog: (r) => console.log('RUN ' + JSON.stringify({ dist: r.dist, reason: r.reason, unexpected: r.unexpected, noSolution: r.noSolution.slice(-2) })),
  }), opts);
  const died = res.filter((r) => r.reason !== 'max');
  console.log(`${res.length} runs, ${died.length} deaths, ${res.filter((r) => r.unexpected).length} unexpected, median distance ${res.map((r) => r.dist).sort((a, b) => a - b)[res.length >> 1]} m`);
  await browser.close();
})();
