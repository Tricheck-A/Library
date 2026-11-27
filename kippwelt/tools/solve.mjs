// Proves every level is winnable: node tools/solve.mjs
import { LEVELS, solve } from '../logic.js';
let ok = true;
for (const def of LEVELS) {
  const { win, unreachableShards } = solve(def);
  if (!win) ok = false;
  console.log(def.id.padEnd(5), win ? `lösbar in ${win.length} Zügen: ${win.join(' ')}` : 'NICHT LÖSBAR',
    unreachableShards.length ? `| unerreichbare Splitter: ${unreachableShards.map((s) => s.b + ' ' + s.u).join('; ')}` : '');
}
process.exit(ok ? 0 : 1);
