// Tryggir að framendinn sé hreint ES5 (Tizen 2017 = Chromium 47).
import { readFileSync } from 'node:fs';
import { parse } from 'acorn';

let failed = false;
for (const f of ['public/tv.js', 'public/channels.js']) {
  try {
    parse(readFileSync(f, 'utf8'), { ecmaVersion: 5, sourceType: 'script' });
    console.log('ES5 í lagi:', f);
  } catch (e) {
    failed = true;
    console.error('EKKI ES5:', f, e.message);
  }
}
process.exit(failed ? 1 : 0);
