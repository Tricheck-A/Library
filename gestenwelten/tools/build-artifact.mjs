// Inlines main.js into index.html and strips the document shell, producing a
// single-file page for hosts that wrap content in their own <html>/<body>.
// Usage: node tools/build-artifact.mjs <out.html>
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const js = readFileSync(join(root, 'main.js'), 'utf8');
const head = html.split('<!--BUILD:HEAD-->')[1].split('<!--BUILD:HEADEND-->')[0];
const body = html.split('<body>')[1].split('</body>')[0]
  .replace('<script type="module" src="./main.js"></script>', `<script type="module">\n${js}\n</script>`)
  .replace(/<!--BUILD:[A-Z]+-->\n?/g, '');
writeFileSync(process.argv[2], head.trim() + '\n' + body.trim() + '\n');
