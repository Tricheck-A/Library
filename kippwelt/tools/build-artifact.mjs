// Inlines logic.js + main.js into index.html and strips the document shell,
// producing a single-file page for hosts that wrap content in their own <html>/<body>.
// Usage: node tools/build-artifact.mjs <out.html>
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const logic = read('logic.js').replace(/^export /gm, '');
const main = read('main.js').replace(/^import \{[^}]*\} from '\.\/logic\.js';\n/m, '');
const html = read('index.html');
const head = html.split('<!--BUILD:HEAD-->')[1].split('<!--BUILD:HEADEND-->')[0];
const body = html.split('<body>')[1].split('</body>')[0]
  .replace('<script type="module" src="./main.js"></script>', () => `<script type="module">\n${logic}\n${main}\n</script>`)
  .replace(/<!--BUILD:[A-Z]+-->\n?/g, '');
writeFileSync(process.argv[2], head.trim() + '\n' + body.trim() + '\n');
