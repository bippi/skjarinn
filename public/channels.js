/* Rásalisti. Bættu við eða breyttu hér — engin endurbygging þarf.
 *  num   – rásanúmer á fjarstýringu
 *  live  – HLS-slóðir, prófaðar í röð ef sú fyrsta virkar ekki
 *  epg   – auðkenni fyrir /api/epg (bara RÚV-rásir hafa dagskrá og tímaflakk)
 */
window.SKJARINN_CHANNELS = [
  {
    id: 'ruv', num: 1, name: 'RÚV', epg: 'ruv',
    live: [
      // switcher velur innlendan eða erlendan straum eftir IP-tölu
      'https://switcher.cdn.ruv.is/resolve/ruv/index.m3u8',
      'https://ruv-web-live.akamaized.net/streymi/ruverl/ruverl.m3u8'
    ]
  },
  {
    id: 'ruv2', num: 2, name: 'RÚV 2', epg: 'ruv2',
    live: [
      'https://switcher.cdn.ruv.is/resolve/ruv2/index.m3u8',
      'https://ruvlive.akamaized.net/out/v1/2ff7673de40f419fa5164498fae89089/index.m3u8'
    ]
  },
  {
    id: 'althingi', num: 3, name: 'Alþingi',
    live: ['https://althingi-live.secure.footprint.net/althingi/live/index.m3u8']
  },
  {
    id: 'visir', num: 4, name: 'Vísir',
    live: ['https://live.visir.is/hls-live/visir.smil/playlist.m3u8']
  },
  {
    id: 'k100', num: 5, name: 'K100',
    live: ['https://k100streymi.mbl.is/beint/k100/index.m3u8']
  }
];
