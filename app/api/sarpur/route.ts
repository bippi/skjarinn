import { mapFeatured, mapProgramEpisodes } from '../../../lib/sarpur';

// GET /api/sarpur             – flokkar Sarpsins (forsíða RÚV-spilarans) með þáttaröðum
// GET /api/sarpur?program=123 – allir þættir einnar þáttaraðar
// Proxy á api.ruv.is svo sjónvarpið lendi ekki í CORS og fái granna JSON.

const MAX_AGE = 600;

// Forsíða RÚV er yfir 6 MB, of stór fyrir gagnaskyndiminni Next (2 MB), svo
// granna útgáfan er geymd hér í minni
const cache = new Map<string, { at: number; body: unknown }>();

export async function GET(req: Request) {
  const program = new URL(req.url).searchParams.get('program');
  if (program !== null && !/^\d{1,9}$/.test(program)) {
    return Response.json({ error: 'ógilt þáttanúmer' }, { status: 400 });
  }
  const src = program
    ? `https://api.ruv.is/api/programs/program/${program}/all`
    : 'https://api.ruv.is/api/programs/featured/tv';

  try {
    let hit = cache.get(src);
    if (!hit || Date.now() - hit.at > MAX_AGE * 1000) {
      const res = await fetch(src, { headers: { accept: 'application/json' }, cache: 'no-store' });
      if (!res.ok) {
        if (!hit) return Response.json({ error: `RÚV svaraði ${res.status}` }, { status: 502 });
      } else {
        const json = await res.json();
        hit = { at: Date.now(), body: program ? mapProgramEpisodes(json) : { panels: mapFeatured(json) } };
        cache.set(src, hit);
        if (cache.size > 200) cache.delete(cache.keys().next().value!);
      }
    }
    return Response.json(hit.body, {
      headers: {
        'access-control-allow-origin': '*',
        'cache-control': `public, s-maxage=${MAX_AGE}, stale-while-revalidate=600`,
      },
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 });
  }
}
