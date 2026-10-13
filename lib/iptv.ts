import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseM3u, type IptvChannel } from './m3u';

// M3U-listinn getur verið tugir MB og verið mínútur að berast, svo síðan má aldrei bíða
// eftir honum: hann er sóttur í bakgrunni (líka við ræsingu, sjá instrumentation.ts),
// geymdur á diski svo endurræsing sé tafarlaus, og gamall listi notaður á meðan nýr berst.

const TTL = 60 * 60 * 1000;
const FILE = process.env.IPTV_CACHE_FILE || '.cache/iptv.json';

type Cache = { at: number; channels: IptvChannel[] };
let cache: Cache | null = null;
let loading: Promise<Cache> | null = null;
let lastError: string | null = null;

async function download(src: string): Promise<Cache> {
  const res = await fetch(src, {
    cache: 'no-store',
    headers: { 'user-agent': 'VLC/3.0.20 LibVLC/3.0.20' },
    signal: AbortSignal.timeout(15 * 60 * 1000),
  });
  if (!res.ok) throw new Error(`IPTV-þjónn svaraði ${res.status}`);
  const fresh = { at: Date.now(), channels: parseM3u(await res.text()) };
  // Þjónustan sendir stundum hálfan lista (slitið niðurhal): halda þá þeim gamla,
  // nema hann sé orðinn sólarhrings gamall og minnkunin því líklega raunveruleg
  const old = cache;
  if (old && fresh.channels.length < old.channels.length / 2 && fresh.at - old.at < 24 * TTL) {
    throw new Error(`fékk bara ${fresh.channels.length} rásir (áður ${old.channels.length}) – held gamla listanum`);
  }
  try {
    await mkdir(dirname(FILE), { recursive: true });
    await writeFile(FILE, JSON.stringify(fresh));
  } catch (err) {
    console.warn('IPTV: gat ekki vistað lista á disk:', err);
  }
  return fresh;
}

/** Ræsir niðurhal ef þess þarf (bara eitt í einu) og skilar loforði um nýjan lista. */
function refresh(src: string): Promise<Cache> {
  if (!loading) {
    loading = download(src)
      .then((c) => { cache = c; lastError = null; return c; })
      .catch((err) => { lastError = String(err); console.warn('IPTV:', lastError); throw err; })
      .finally(() => { loading = null; });
    loading.catch(() => {});
  }
  return loading;
}

async function fromDisk(): Promise<void> {
  if (cache) return;
  try {
    cache = JSON.parse(await readFile(FILE, 'utf8')) as Cache;
  } catch {
    // enginn listi vistaður enn
  }
}

/** Kallað við ræsingu þjónsins: les vistaðan lista og byrjar að sækja nýjan ef hann er gamall. */
export async function warm(): Promise<void> {
  const src = process.env.IPTV_M3U_URL;
  if (!src) return;
  await fromDisk();
  if (!cache || Date.now() - cache.at > TTL) refresh(src);
}

/**
 * Rásalistinn eins og hann er núna. Ef enginn listi er til er beðið í mesta lagi `waitMs`;
 * `null` þýðir að hann er enn að berast (eða að síðasta tilraun mistókst, sjá `error`).
 */
export async function getChannels(src: string, waitMs: number): Promise<{ channels: IptvChannel[] | null; error: string | null }> {
  await fromDisk();
  if (cache) {
    if (Date.now() - cache.at > TTL) refresh(src);
    return { channels: cache.channels, error: null };
  }
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), waitMs));
  const got = await Promise.race([refresh(src).catch(() => null), timeout]);
  return { channels: got ? got.channels : null, error: lastError };
}
