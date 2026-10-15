import { getChannels } from '../../../lib/iptv';
import { filterChannels, groupMatches } from '../../../lib/m3u';

// GET /api/iptv – JavaScript sem bætir rásum úr IPTV-áskrift aftan við
// window.SKJARINN_CHANNELS. Hlaðið með <script> á undan tv.js.
//
// Stillt í .env.local (ekki í channels.js – straumslóðirnar innihalda lykilorðið):
//   IPTV_M3U_URL   – M3U-slóðin frá þjónustunni
//   IPTV_GROUPS    – (valfrjálst) flokkar sem á að taka með, kommuaðskildir; „Iceland“ nær líka yfir „Iceland - …“ (listi: /api/iptv?groups)
//   IPTV_CHANNELS  – (valfrjálst) rásanöfn sem á að taka með, kommuaðskilin
//   IPTV_SPORT_GROUPS – (valfrjálst) flokkar þar sem bara íþróttarásir eru teknar með
//   IPTV_EXCLUDE   – (valfrjálst) flokkar sem á aldrei að taka með, t.d. „Germany - Pluto TV“
//   IPTV_MAX       – (valfrjálst) hámarksfjöldi rása, sjálfgefið 2000

export const dynamic = 'force-dynamic';

function js(body: string) {
  return new Response(body, {
    headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function GET(req: Request) {
  const src = process.env.IPTV_M3U_URL;
  if (!src) return js('/* IPTV ekki stillt */');
  // Á opinni Vercel-síðu myndu straumslóðirnar (með lykilorði) blasa við öllum
  if (process.env.VERCEL && process.env.IPTV_ALLOW_PUBLIC !== '1') {
    return js('/* IPTV óvirkt á Vercel – keyrðu Skjáinn heima */');
  }

  try {
    const wantGroups = new URL(req.url).searchParams.has('groups');
    // Sjónvarpið bíður ekki lengi: án IPTV-rása frekar en að síðan hangi
    const { channels, error } = await getChannels(src, wantGroups ? 60000 : 5000);
    if (!channels) {
      const msg = error ? 'IPTV: ' + error : 'IPTV-listinn er enn að berast – endurhlaðið eftir smástund';
      return wantGroups ? new Response(msg + '\n', { status: 503 }) : js(`console.warn(${JSON.stringify(msg)});`);
    }
    // /api/iptv?groups – flokkarnir í listanum og fjöldi rása, til að velja IPTV_GROUPS
    if (wantGroups) {
      const count = new Map<string, number>();
      for (const c of channels) count.set(c.group, (count.get(c.group) || 0) + 1);
      const lines = [...count].sort((a, b) => a[0].localeCompare(b[0])).map(([g, n]) => `${n}\t${g || '(enginn flokkur)'}`);
      return new Response(lines.join('\n') + '\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    const max = parseInt(process.env.IPTV_MAX || '', 10) || 2000;
    // Flokkar í sömu röð og í IPTV_GROUPS og svo IPTV_SPORT_GROUPS; rásir sem komu inn á nafni aftast
    const env = process.env;
    const order = `${env.IPTV_GROUPS || ''},${env.IPTV_SPORT_GROUPS || ''}`.split(',').map((x) => x.trim()).filter(Boolean);
    const rank = (g: string) => { const r = order.findIndex((x) => groupMatches(g, x)); return r < 0 ? order.length : r; };
    const list = filterChannels(channels, {
      groups: env.IPTV_GROUPS, names: env.IPTV_CHANNELS, sportGroups: env.IPTV_SPORT_GROUPS, exclude: env.IPTV_EXCLUDE,
    })
      .map((c, i) => ({ c, i }))
      .sort((a, b) => rank(a.c.group) - rank(b.c.group) || a.i - b.i)
      .slice(0, max)
      // „UK: BBC One“ → „BBC One“; flokkafyrirsögnin segir landið
      .map(({ c }, i) => ({
        id: 'iptv-' + i,
        name: c.name.replace(/^[A-Z]{2,3}\s*[:|]\s*/, '') || c.name,
        group: c.group || 'IPTV',
        live: c.live,
        logo: c.logo || undefined,
      }));

    // Númerað frá næsta hundraði fyrir ofan rásirnar í channels.js (101, 102, …)
    return js(`(function () {
  var C = window.SKJARINN_CHANNELS = window.SKJARINN_CHANNELS || [];
  var list = ${JSON.stringify(list)};
  var top = 0;
  for (var i = 0; i < C.length; i++) if (C[i].num > top) top = C[i].num;
  var base = Math.floor(top / 100) * 100 + 100;
  for (var j = 0; j < list.length; j++) { list[j].num = base + j + 1; C.push(list[j]); }
})();`);
  } catch (err) {
    return js(`console.warn(${JSON.stringify('IPTV: ' + String(err))});`);
  }
}
