# Skjárinn

Sjónvarpsviðmót fyrir vafrann í Samsung-sjónvarpinu: rásaskipti, dagskrá og tímaflakk á opnum íslenskum straumum.

- **RÚV / RÚV 2** – bein útsending, dagskrá 7 daga aftur og tímaflakk (þættir sem RÚV hefur sett inn í Spilarann)
- **Alþingi, Vísir, K100** – bein útsending (engin dagskrá)

## Uppbygging

| Skrá | Hlutverk |
|---|---|
| `app/api/epg/route.ts` | Proxy á `api.ruv.is/api/schedule/{rás}/{dags}` → grannur JSON-listi |
| `lib/epg.ts` | Möppun á dagskrá RÚV (tími, VOD-slóð, réttindi) |
| `public/index.html`, `tv.css`, `tv.js` | Sjálft viðmótið – hreint ES5, ekkert React, svo það keyri í Tizen 2017 vafranum |
| `public/channels.js` | Rásalistinn – breyttu og endurhlaðaðu, engin endurbygging |

## Keyra

```bash
npm install
npm run dev        # http://localhost:3000
npm run check:es5  # staðfestir að tv.js sé ES5
```

Á Vercel: `vercel deploy` og opna slóðina í vafra sjónvarpsins (gott að setja hana sem bókamerki/heimasíðu).

## Fjarstýring

**Að horfa**
- ▲ ▼ – skipta um rás · tölustafir – beint á rás
- ◀ ▶ – spóla 30 sek; endurtekin ýtt hraða á (30 → 60 → 120 → 300 sek)
- OK – opna dagskrá
- ⏯ – pása (ef sjónvarpið sendir takkann í vafrann)
- Til baka – aftur í beina útsendingu

**Dagskrá**
- ▲ ▼ – þættir · ◀ – rásalisti · ▲ efst – dagar (◀ ▶ skiptir um dag)
- OK á liðnum þætti – tímaflakk frá byrjun
- OK á þætti í gangi – beint · ▶ – frá byrjun
- Þegar tímaflakksþáttur klárast tekur næsti við, og beina útsendingin þegar þú nærð henni

## Takmarkanir

- Tímaflakk fyrir liðna þætti byggir á Spilara RÚV: ef RÚV hefur ekki réttindi eftir á birtist „Ekki í boði“.
- „Frá byrjun“ á þætti í gangi spólar beinu útsendingunni ef VOD er ekki kominn – hve langt aftur fer eftir því hvað straumurinn geymir.
- Erlent efni RÚV er bundið við Ísland; straumarnir virka því aðeins á íslenskri IP-tölu.
- Vafrinn á sjónvarpinu getur gleypt suma takka (⏯, rásarofa). ◀ ▶ og OK virka alltaf.
