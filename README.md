# Skjárinn

Sjónvarpsviðmót fyrir vafrann í Samsung-sjónvarpinu: rásaskipti, dagskrá og tímaflakk á opnum íslenskum straumum.

- **RÚV / RÚV 2** – bein útsending, dagskrá 7 daga aftur og tímaflakk (þættir sem RÚV hefur sett inn í Spilarann)
- **Alþingi, Vísir, K100** – bein útsending (engin dagskrá)
- **DW, France 24 (EN/FR), TRT World, CBS News, Bloomberg, NASA** – erlendar opnar útsendingar (engin dagskrá)
- **IPTV-áskrift** (valfrjálst) – rásir úr M3U-lista, á rásanúmerum 101 og upp úr

## Uppbygging

| Skrá                                   | Hlutverk                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `app/api/epg/route.ts`                 | Proxy á `api.ruv.is/api/schedule/{rás}/{dags}` → grannur JSON-listi             |
| `lib/epg.ts`                           | Möppun á dagskrá RÚV (tími, VOD-slóð, réttindi)                                 |
| `public/index.html`, `tv.css`, `tv.js` | Sjálft viðmótið – hreint ES5, ekkert React, svo það keyri í Tizen 2017 vafranum |
| `public/channels.js`                   | Rásalistinn – breyttu og endurhlaðaðu, engin endurbygging                       |
| `app/api/iptv/route.ts`, `lib/m3u.ts`  | Les M3U frá IPTV-áskrift og bætir rásunum aftan við listann                     |
| `app/api/sarpur/route.ts`, `lib/sarpur.ts` | Sarpur RÚV: flokkar (`/api/sarpur`) og þættir (`/api/sarpur?program=ID`)    |

## Keyra

```bash
npm install
npm run dev        # http://localhost:3000
npm run check:es5  # staðfestir að tv.js sé ES5
```

Á Vercel: `vercel deploy` og opna slóðina í vafra sjónvarpsins (gott að setja hana sem bókamerki/heimasíðu).

## IPTV-áskrift

Búðu til `.env.local` (fer ekki í git):

```bash
IPTV_M3U_URL=http://þjónn:8080/get.php?username=XXX&password=XXX&type=m3u_plus&output=m3u8
IPTV_GROUPS=Iceland,United Kingdom   # valfrjálst: flokkar (group-title); undirflokkar „Iceland - …“ fylgja með
IPTV_CHANNELS=Sky News               # valfrjálst: auk þess rásir með þessu í nafninu
IPTV_SPORT_GROUPS=India,Japan        # valfrjálst: flokkar þar sem bara íþróttarásir eru teknar með
IPTV_EXCLUDE=Germany - Pluto TV      # valfrjálst: flokkar sem eru aldrei teknir með
IPTV_MAX=2000                        # valfrjálst: hámarksfjöldi rása
```

Keyrðu svo Skjáinn á tölvu heima og opnaðu hann í sjónvarpinu á staðarnetinu:

```bash
npm run build && npm start   # opna http://<IP-tala tölvunnar>:3000 í sjónvarpinu
```

- Straumslóðirnar innihalda lykilorðið, svo IPTV er óvirkt á Vercel (nema `IPTV_ALLOW_PUBLIC=1`).
- Flestar IPTV-þjónustur streyma á `http://`, sem vafrinn leyfir ekki á `https://`-síðu – önnur ástæða til að keyra heima.
- Xtream-slóðum (`/notandi/lykilorð/123` eða `.ts`) er breytt í `/live/…/123.m3u8` svo þær spilist; upprunalega slóðin er til vara.
- Listinn er sóttur einu sinni á klukkustund. Flokkana og fjölda rása í hverjum sérðu á `/api/iptv?groups`.
- Notaðu `type=m3u_plus` – venjulegt `type=m3u` hefur engin flokkaheiti.

## Docker og NVIDIA Shield

Keyra Skjáinn heima í Docker (les `.env.local` ef hún er til):

```bash
docker compose up -d --build   # http://192.168.0.23:3000
```

Á aðra vél gegnum SSH (byggir hér, sendir myndina og `.env.local` yfir; vélin þarf bara Docker og SSH-lykil):

```bash
bash scripts/deploy.sh j148@192.168.0.23
```

IPTV-listinn er sóttur í bakgrunni við ræsingu og geymdur á diski, svo síðan bíður aldrei eftir honum. Fyrst eftir uppsetningu geta liðið nokkrar mínútur þar til IPTV-rásirnar birtast.

**Shield-appið** (`android/`) er lítið Android TV app: heilskjás WebView sem opnar Skjáinn á vélinni heima og þýðir takka fjarstýringarinnar (Til baka, ⏯, ⏪ ⏩) yfir á það sem `tv.js` þekkir. Viðmótið sjálft kemur alltaf frá þjóninum, svo breytingar á vefnum þurfa ekki nýtt app. APK-ið er byggt í Docker, ekkert Android Studio:

```bash
docker compose run --rm apk    # → android/dist/skjarinn.apk
```

Setja upp á Shield:

1. Á Shield: _Stillingar → Tækjastillingar → Um_ → ýta 7× á _Build_ til að fá forritaravalkosti, svo _Forritaravalkostir → Netkembing (Network debugging)_ á.
2. `SHIELD=<IP-tala Shield> docker compose run --rm -e SHIELD apk` – byggir og setur upp. Samþykktu tenginguna á skjánum í fyrsta sinn.
3. Opnaðu _Skjárinn_ á heimaskjánum og sláðu inn slóðina, t.d. `http://192.168.0.23:3000`.

- **≡ (Menu)** á fjarstýringunni – breyta slóð þjónsins · **halda inni Til baka** – loka appinu (eða Home).
- Gott er að gefa vélinni fasta IP-tölu í routernum svo slóðin breytist ekki.
- Undirritunarlykillinn `android/skjarinn.keystore` verður til við fyrstu byggingu (fer ekki í git). Geymdu hann – án hans þarf að fjarlægja appið áður en ný útgáfa er sett upp.

## Fjarstýring

**Að horfa**

- ▲ ▼ – skipta um rás · tölustafir – beint á rás
- ◀ ▶ – spóla 30 sek; endurtekin ýtt hraða á (30 → 60 → 120 → 300 sek)
- OK – opna dagskrá
- ⏯ – pása (ef sjónvarpið sendir takkann í vafrann)
- Til baka – aftur í beina útsendingu

**Dagskrá**

- ▲ ▼ – þættir · ◀ – rásalisti · ▲ efst – dagar (◀ ▶ skiptir um dag)
- Rás upp/niður í rásalistanum – stökkva á milli flokka (IPTV)
- OK á liðnum þætti – tímaflakk frá byrjun
- OK á þætti í gangi – beint · ▶ – frá byrjun
- Þegar tímaflakksþáttur klárast tekur næsti við, og beina útsendingin þegar þú nærð henni

## Takmarkanir

- Tímaflakk fyrir liðna þætti byggir á Spilara RÚV: ef RÚV hefur ekki réttindi eftir á birtist „Ekki í boði“.
- „Frá byrjun“ á þætti í gangi spólar beinu útsendingunni ef VOD er ekki kominn – hve langt aftur fer eftir því hvað straumurinn geymir.
- Erlent efni RÚV er bundið við Ísland; straumarnir virka því aðeins á íslenskri IP-tölu.
- Vafrinn á sjónvarpinu getur gleypt suma takka (⏯, rásarofa). ◀ ▶ og OK virka alltaf.
