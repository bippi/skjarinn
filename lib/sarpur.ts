// Breytir Sarpi RÚV (api.ruv.is/api/programs/…) yfir í granna mynd sem sjónvarpið ræður við.
// Þættir fá sama form og Programme í epg.ts svo spilarinn geti meðhöndlað þá eins og tímaflakk.

import { toMs } from './epg';

export type SarpurEpisode = {
  id: string;
  title: string; // heiti þáttaraðar
  subtitle: string | null; // heiti þáttar
  number: number | null;
  description: string;
  start: number; // fyrst sýnt, ms epoch
  end: number; // start + lengd
  image: string | null;
  vod: string;
  vodExpires: string | null;
  domesticOnly: boolean;
};

export type SarpurProgram = {
  id: number;
  title: string;
  subtitle: string | null; // erlent heiti
  description: string;
  image: string | null;
  multi: boolean;
  count: number;
  /** Nýjasti þátturinn; nóg til að spila stakar myndir án þess að sækja þáttaröðina */
  ep: SarpurEpisode | null;
};

export type SarpurPanel = { title: string; items: SarpurProgram[] };

type RuvEpisode = {
  id: string;
  title?: string | null;
  number?: string | number | null;
  firstrun?: string | null;
  duration?: string | number | null;
  description?: string[] | string | null;
  short_description?: string | null;
  image?: string | null;
  scope?: string | null;
  file?: string | null;
  file_expires?: string | null;
};

type RuvProgram = {
  id: number;
  title: string;
  foreign_title?: string | null;
  image?: string | null;
  description?: string[] | string | null;
  short_description?: string | null;
  multiple_episodes?: boolean;
  vod_available_episodes?: number;
  episodes?: RuvEpisode[] | null;
};

function text(d: string[] | string | null | undefined, fallback?: string | null): string {
  const list = Array.isArray(d) ? d : d ? [d] : [];
  return list.filter(Boolean).slice(-1)[0] ?? fallback ?? '';
}

function mapEpisode(p: RuvProgram, e: RuvEpisode): SarpurEpisode | null {
  if (!e.file) return null;
  const start = e.firstrun ? toMs(e.firstrun) : NaN;
  const secs = Number(e.duration) || 0;
  const num = Number(e.number);
  const sub = e.title && e.title !== p.title ? e.title : null;
  return {
    id: e.id,
    title: p.title,
    subtitle: sub,
    number: Number.isFinite(num) && num > 0 ? num : null,
    description: text(e.description, e.short_description) || text(p.description, p.short_description),
    start: Number.isFinite(start) ? start : 0,
    end: (Number.isFinite(start) ? start : 0) + secs * 1000,
    image: e.image ?? p.image ?? null,
    vod: e.file,
    // 9999-12-31 = rennur ekki út
    vodExpires: e.file_expires && !e.file_expires.startsWith('9999') ? e.file_expires : null,
    domesticOnly: (e.scope ?? '').toLowerCase() === 'domestic',
  };
}

function mapProgram(p: RuvProgram): SarpurProgram | null {
  const ep = p.episodes?.[0] ? mapEpisode(p, p.episodes[0]) : null;
  const count = p.vod_available_episodes ?? p.episodes?.length ?? 0;
  // Forsíðan vantelur stundum þættina, svo þáttaraðir eru alltaf opnaðar
  const multi = !!p.multiple_episodes;
  if (!ep && !multi) return null;
  return {
    id: p.id,
    title: p.title,
    subtitle: p.foreign_title && p.foreign_title !== p.title ? p.foreign_title : null,
    description: text(p.description, p.short_description),
    image: p.image ?? null,
    multi,
    count,
    // Lýsing og mynd þáttaraðarinnar duga í yfirlitinu; munar um helming á stærðinni
    ep: ep && { ...ep, description: '', image: null },
  };
}

export function mapFeatured(json: { panels?: { title: string; programs?: RuvProgram[] }[] }): SarpurPanel[] {
  const out: SarpurPanel[] = [];
  for (const panel of json?.panels ?? []) {
    const items = (panel.programs ?? []).map(mapProgram).filter((x): x is SarpurProgram => !!x);
    if (items.length) out.push({ title: panel.title, items });
  }
  return out;
}

export function mapProgramEpisodes(p: RuvProgram) {
  return {
    id: p.id,
    title: p.title,
    episodes: (p.episodes ?? []).map((e) => mapEpisode(p, e)).filter((x): x is SarpurEpisode => !!x),
  };
}
