// Breytir dagskrá frá api.ruv.is yfir í granna mynd sem sjónvarpið ræður við.

export type Programme = {
  id: number;
  title: string;
  subtitle: string | null;
  description: string;
  start: number; // ms epoch (UTC)
  end: number;
  image: string | null;
  /** HLS-slóð fyrir tímaflakk (VOD), ef RÚV leyfir */
  vod: string | null;
  vodExpires: string | null;
  domesticOnly: boolean;
  live: boolean;
};

type RuvEvent = {
  id: number;
  start_time: string;
  end_time: string;
  title: string;
  original_title: string | null;
  description?: string[];
  is_header?: boolean;
  is_live?: boolean;
  vod_accessible?: boolean;
  web_scope?: string;
  duration?: number;
  image?: string | null;
  rights?: { vod?: { action?: string; expires?: string | null } };
  program?: {
    episodes?: { file?: string | null; scope?: string }[];
  } | null;
};

// RÚV sendir tíma án tímabeltis. Ísland er alltaf UTC+0.
function toMs(t: string): number {
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : t + 'Z');
}

export function mapRuvSchedule(json: { events?: RuvEvent[] }): Programme[] {
  const events = Array.isArray(json?.events) ? json.events : [];
  const out: Programme[] = [];

  for (const e of events) {
    if (e.is_header) continue;
    const start = toMs(e.start_time);
    const end = toMs(e.end_time);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;

    const ep = e.program?.episodes?.[0];
    const vodAllowed = e.vod_accessible !== false && e.rights?.vod?.action === 'allowed';
    const vod = vodAllowed && ep?.file ? ep.file : null;

    // "Hausar" eins og KrakkaRÚV-blokkin: örstutt og án efnis — undirþættirnir koma sér.
    if (!vod && (e.duration ?? 9999) < 120) continue;

    out.push({
      id: e.id,
      title: e.title,
      subtitle: e.original_title && e.original_title !== e.title ? e.original_title : null,
      description: (e.description ?? []).filter(Boolean).slice(-1)[0] ?? '',
      start,
      end,
      image: e.image ?? null,
      vod,
      vodExpires: e.rights?.vod?.expires ?? null,
      domesticOnly: (ep?.scope ?? e.web_scope ?? '').toLowerCase() === 'domestic',
      live: !!e.is_live,
    });
  }

  out.sort((a, b) => a.start - b.start);
  return out;
}
