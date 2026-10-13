import { mapFeatured, mapProgramEpisodes } from '../../../lib/sarpur';

// GET /api/sarpur             – flokkar Sarpsins (forsíða RÚV-spilarans) með þáttaröðum
// GET /api/sarpur?program=123 – allir þættir einnar þáttaraðar
// Proxy á api.ruv.is svo sjónvarpið lendi ekki í CORS og fái granna JSON.

const MAX_AGE = 600;

export async function GET(req: Request) {
  const program = new URL(req.url).searchParams.get('program');
  if (program !== null && !/^\d{1,9}$/.test(program)) {
    return Response.json({ error: 'ógilt þáttanúmer' }, { status: 400 });
  }
  const src = program
    ? `https://api.ruv.is/api/programs/program/${program}/all`
    : 'https://api.ruv.is/api/programs/featured/tv';

  try {
    const res = await fetch(src, { headers: { accept: 'application/json' }, next: { revalidate: MAX_AGE } });
    if (!res.ok) {
      return Response.json({ error: `RÚV svaraði ${res.status}` }, { status: 502 });
    }
    const json = await res.json();
    const body = program ? mapProgramEpisodes(json) : { panels: mapFeatured(json) };
    return Response.json(body, {
      headers: {
        'access-control-allow-origin': '*',
        'cache-control': `public, s-maxage=${MAX_AGE}, stale-while-revalidate=600`,
      },
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 });
  }
}
