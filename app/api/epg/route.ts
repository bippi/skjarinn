import { mapRuvSchedule } from '../../../lib/epg';

// GET /api/epg?channel=ruv&date=2026-10-12
// Proxy á api.ruv.is svo sjónvarpið lendi ekki í CORS og fái granna JSON.

const ALLOWED = new Set(['ruv', 'ruv2']);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const channel = url.searchParams.get('channel') ?? 'ruv';
  const date = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);

  if (!ALLOWED.has(channel) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: 'ógild rás eða dagsetning' }, { status: 400 });
  }

  const isToday = date === new Date().toISOString().slice(0, 10);

  try {
    const res = await fetch(`https://api.ruv.is/api/schedule/${channel}/${date}`, {
      headers: { accept: 'application/json' },
      // Dagurinn í dag breytist (beinar útsendingar, VOD bætist við); eldri dagar síður.
      next: { revalidate: isToday ? 120 : 3600 },
    });
    if (!res.ok) {
      return Response.json({ error: `RÚV svaraði ${res.status}` }, { status: 502 });
    }
    const programmes = mapRuvSchedule(await res.json());
    return Response.json(
      { channel, date, programmes },
      {
        headers: {
          'access-control-allow-origin': '*',
          'cache-control': `public, s-maxage=${isToday ? 120 : 3600}, stale-while-revalidate=600`,
        },
      },
    );
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 });
  }
}
