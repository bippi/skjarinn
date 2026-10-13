// Lesur M3U-rásalista frá IPTV-áskrift (t.d. get.php?...&type=m3u_plus).

export type IptvChannel = { id: string; name: string; group: string; logo?: string; live: string[] };

function attr(line: string, key: string): string | undefined {
  const m = line.match(new RegExp(`${key}="([^"]*)"`, 'i'));
  return m ? m[1].trim() || undefined : undefined;
}

// Xtream Codes skilar oft MPEG-TS (`/notandi/lykilorð/123` eða `.ts`) sem vafrinn
// spilar ekki. Sami þjónn gefur HLS ef beðið er um `/live/.../123.m3u8`.
export function hlsVariants(url: string): string[] {
  try {
    const u = new URL(url);
    if (/\.m3u8$/i.test(u.pathname)) return [url];
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] === 'live') parts.shift();
    if (parts.length === 3 && /^\d+(\.ts)?$/i.test(parts[2])) {
      const id = parts[2].replace(/\.ts$/i, '');
      const hls = new URL(`/live/${parts[0]}/${parts[1]}/${id}.m3u8`, u).toString();
      return [hls, url];
    }
  } catch {}
  return [url];
}

// Listar án group-title (type=m3u) skipta flokkum með gervirásum á borð við „===== Iceland =====“
const HEADER = /^[=#*~-]{3,}\s*(.*?)\s*[=#*~-]{3,}$/;

export function parseM3u(text: string): IptvChannel[] {
  const out: IptvChannel[] = [];
  let info: string | null = null;
  let section = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) { info = line; continue; }
    if (line.startsWith('#') || !info) continue;
    const comma = info.lastIndexOf(',');
    const name = (comma >= 0 ? info.slice(comma + 1).trim() : '') || attr(info, 'tvg-name') || 'Rás';
    const header = name.match(HEADER);
    const entry = info;
    info = null;
    if (header) { section = header[1]; continue; }
    // Bara beinar útsendingar, ekki kvikmyndir og þáttaraðir (VOD)
    if (/\/(movie|series)\//i.test(line)) continue;
    out.push({
      id: attr(entry, 'tvg-id') || name,
      name,
      group: attr(entry, 'group-title') || section,
      logo: attr(entry, 'tvg-logo'),
      live: hlsVariants(line),
    });
  }
  return out;
}

/**
 * Passar flokkurinn við síuna `want`? Undirflokkar teljast með: „Iceland“ nær líka
 * yfir „Iceland - Síminn Pass“ og „Iceland - Viaplay“.
 */
export function groupMatches(group: string, want: string): boolean {
  const g = group.toLowerCase(), w = want.toLowerCase();
  return g === w || g.startsWith(w + ' - ');
}

// Íþróttarás, metið út frá nafni og flokki (t.d. „IN: STAR SPORTS 1 HD“, „Japan - DAZN“)
const SPORT = /sport|spor\b|bein|dazn|espn|eurosport|setanta|arena|golf|tennis|cricket|football|soccer|\bbola\b|badminton|\bnba\b|\bf1\b|racing|fight|wwe|ufc|premier ?league|stadium|grandstand|desporto|varzish|sony ten|\bten (1|2|3|4|5)|\bspotv|\bmio\b|ais play|mono tpl/i;

export function isSport(c: IptvChannel): boolean {
  return SPORT.test(c.name) || SPORT.test(c.group);
}

export type ChannelFilter = {
  groups?: string;      // flokkar sem eru teknir með í heild
  names?: string;       // rásanöfn, hvar sem þau eru
  sportGroups?: string; // flokkar þar sem bara íþróttarásir eru teknar með
  exclude?: string;     // flokkar sem eru alltaf skildir eftir
};

// Síar eftir flokkum og/eða nöfnum (kommuaðskilið, hástafaóháð). Flokkur passar nákvæmlega
// eða sem yfirflokkur (sjá /api/iptv?groups), nafn passar sem hlutstrengur sem byrjar
// í upphafi orðs („US: AMC“ nær í „US: AMC HD“ en ekki „RUS: AMC“).
export function filterChannels(list: IptvChannel[], f: ChannelFilter): IptvChannel[] {
  const split = (s?: string) => (s || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const g = split(f.groups), s = split(f.sportGroups), x = split(f.exclude);
  const n = split(f.names).map((w) => new RegExp('(^|[^\\p{L}\\p{N}])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu'));
  if (!g.length && !n.length && !s.length && !x.length) return list;
  const any = g.length || n.length || s.length;
  return list.filter((c) =>
    !x.some((w) => groupMatches(c.group, w)) && (!any ||
      g.some((w) => groupMatches(c.group, w)) ||
      n.some((re) => re.test(c.name)) ||
      (s.some((w) => groupMatches(c.group, w)) && isSport(c))));
}
