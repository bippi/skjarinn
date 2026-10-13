/* Skjárinn — sjónvarpsviðmót með rásaskiptum og tímaflakki.
 * Skrifað í hreinu ES5 (var, function, XHR) svo það keyri í Tizen 2017 vafranum.
 * Allur tími er sýndur í UTC = íslenskum tíma, óháð stillingum sjónvarpsins.
 */
(function () {
  'use strict';

  var CHANNELS = window.SKJARINN_CHANNELS || [];
  var DAYS_BACK = 7, DAYS_FWD = 1;
  var SEEK_STEPS = [30, 30, 60, 120, 300, 600]; // sek, vex við endurtekin ýtt
  var BAR_TIMEOUT = 5000;

  var KEY = {
    LEFT: [37], UP: [38], RIGHT: [39], DOWN: [40],
    OK: [13, 32 /* space til prófunar í tölvu */],
    BACK: [10009, 8, 27, 461],
    CH_UP: [427, 33], CH_DOWN: [428, 34],
    PLAY: [415], PAUSE: [19], PLAYPAUSE: [10252, 179, 80 /* P */],
    REW: [412, 227], FF: [417, 228],
    STOP: [413],
    GUIDE: [458, 71 /* G */],
    SARPUR: [406 /* blár */, 83 /* S */]
  };
  function is(code, name) { return KEY[name].indexOf(code) !== -1; }

  // ---------- Hjálparföll ----------
  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(ms) { var d = new Date(ms); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); }
  function dur(sec) {
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ':' + pad(m) : m) + ':' + pad(s);
  }
  function now() { return Date.now(); }
  function isoDate(offsetDays) {
    var d = new Date(now() + offsetDays * 864e5);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  var WD = ['sun', 'mán', 'þri', 'mið', 'fim', 'fös', 'lau'];
  var MO = ['jan', 'feb', 'mar', 'apr', 'maí', 'jún', 'júl', 'ágú', 'sep', 'okt', 'nóv', 'des'];
  function dayLabel(off) {
    if (off === 0) return 'Í dag';
    if (off === -1) return 'Í gær';
    if (off === 1) return 'Á morgun';
    var d = new Date(now() + off * 864e5);
    return WD[d.getUTCDay()] + ' ' + d.getUTCDate() + '. ' + MO[d.getUTCMonth()];
  }
  // „13. okt“, með ártali ef það er ekki í ár
  function dateLabel(ms) {
    var d = new Date(ms), y = d.getUTCFullYear();
    return d.getUTCDate() + '. ' + MO[d.getUTCMonth()] + (y !== new Date(now()).getUTCFullYear() ? ' ' + y : '');
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  var toastTimer;
  function toast(msg, ms) {
    var t = $('toast'); t.innerHTML = esc(msg); t.className = 'toast';
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = 'toast hidden'; }, ms || 3500);
  }
  function spinner(on) { $('spinner').className = on ? 'spinner' : 'spinner hidden'; }

  // ---------- Dagskrá (EPG) ----------
  var epgCache = {}; // key "ruv|2026-10-12" -> {at, list}
  function getEpg(ch, off, cb) {
    if (!ch.epg) { cb([]); return; }
    var date = isoDate(off), key = ch.epg + '|' + date, c = epgCache[key];
    var maxAge = off === 0 ? 120000 : (off < 0 ? 3600000 : 600000);
    if (c && now() - c.at < maxAge) { cb(c.list); return; }
    var x = new XMLHttpRequest();
    x.open('GET', '/api/epg?channel=' + encodeURIComponent(ch.epg) + '&date=' + date, true);
    x.timeout = 10000;
    x.onload = function () {
      var list = [];
      try { list = JSON.parse(x.responseText).programmes || []; } catch (e) { /* tómt */ }
      if (x.status === 200) epgCache[key] = { at: now(), list: list };
      cb(list);
    };
    x.onerror = x.ontimeout = function () { cb(c ? c.list : []); };
    x.send();
  }
  function findAt(list, t) {
    for (var i = 0; i < list.length; i++) if (list[i].start <= t && t < list[i].end) return i;
    return -1;
  }
  // Þátturinn sem er í gangi á tíma t (lítur líka á gærdaginn yfir miðnætti)
  function progAt(ch, t, cb) {
    if (!ch.epg) { cb(null, null); return; }
    var off = Math.floor((t - Date.parse(isoDate(0) + 'T00:00:00Z')) / 864e5);
    getEpg(ch, off, function (list) {
      var i = findAt(list, t);
      if (i >= 0) { cb(list[i], list[i + 1] || null); return; }
      getEpg(ch, off - 1, function (prev) {
        var j = findAt(prev, t);
        cb(j >= 0 ? prev[j] : null, j >= 0 ? (prev[j + 1] || list[0] || null) : null);
      });
    });
  }

  // ---------- Spilari ----------
  var video = $('video');
  var hls = null;
  var canNative = !!(video.canPlayType && video.canPlayType('application/vnd.apple.mpegurl'));
  var hlsOk = !!(window.Hls && window.Hls.isSupported && window.Hls.isSupported());

  var state = {
    ch: 0,
    mode: 'live',        // 'live' | 'vod'
    prog: null,          // þátturinn sem spilast í vod-ham
    progList: null,      // dagskrá dagsins sem prog kom úr (fyrir sjálfvirkt næsta)
    view: 'watch',       // 'watch' | 'guide'
    liveProg: null, liveNext: null,
    src: null            // { url, resolved } straumsins sem tókst að spila
  };

  // Vafrinn bannar oft sjálfvirka spilun með hljóði áður en notandi hefur ýtt á takka.
  // Þá er reynt aftur hljóðlaust og fyrsti takki kveikir á hljóðinu (eða spilar, ef það var líka bannað).
  var needGesture = false;
  function blocked() {
    if (needGesture) return;
    needGesture = true;
    video.muted = true;
    var q = video.play();
    if (q && q['catch']) q['catch'](function () {});
    // Eldri vafrar (Tizen 2017) skila engu loforði: athuga stöðuna eftir smástund
    setTimeout(function () {
      if (!needGesture) return;
      toast(video.paused ? 'Ýttu á OK til að spila' : 'Ýttu á takka til að fá hljóð', 8000);
    }, 800);
  }
  function tryPlay() {
    var token = load.current;
    var p = video.play();
    if (p && p['catch']) p['catch'](function (err) { if (err && err.name === 'NotAllowedError') blocked(); });
    // Óháð loforði: ef ekkert spilar eftir smástund og notandi pásaði ekki, er spilun bönnuð
    setTimeout(function () {
      if (load.current === token && video.paused && !state.userPaused) blocked();
    }, 2500);
  }
  function onGesture() {
    if (!needGesture) return false;
    needGesture = false;
    var wasPaused = video.paused;
    video.muted = false;
    var p = video.play(); if (p && p['catch']) p['catch'](function () {});
    return wasPaused; // gleypa takkann ef hann fór í að ræsa spilun
  }

  function destroyHls() { if (hls) { try { hls.destroy(); } catch (e) {} hls = null; } }

  // Reynir slóðir í röð; hverja fyrst innbyggt (Tizen) og svo með hls.js
  function load(urls, startAt, onReady) {
    var attempts = [];
    for (var i = 0; i < urls.length; i++) {
      if (canNative) attempts.push({ url: urls[i], how: 'native' });
      if (hlsOk) attempts.push({ url: urls[i], how: 'hls' });
      if (!canNative && !hlsOk) attempts.push({ url: urls[i], how: 'native' });
    }
    saveSeen();
    seen.cur = null;
    var token = {};
    load.current = token;
    state.userPaused = false;
    spinner(true);

    function next(k) {
      if (load.current !== token) return;
      if (k >= attempts.length) { spinner(false); toast('Náði ekki að spila þessa útsendingu'); return; }
      var a = attempts[k], done = false;
      destroyHls();
      video.removeAttribute('src');

      function ok() {
        if (done || load.current !== token) return; done = true;
        cleanup(); spinner(false);
        state.src = { url: a.url, resolved: resolved };
        if (srcKind() === 'foreign' && state.mode === 'live') toast('Erlendur straumur RÚV: innlent efni er lokað', 6000);
        if (startAt != null) seekTo(startAt);
        tryPlay();
        if (onReady) onReady();
      }
      function fail() {
        if (done || load.current !== token) return; done = true;
        cleanup(); next(k + 1);
      }
      function cleanup() {
        video.removeEventListener('loadedmetadata', ok);
        video.removeEventListener('error', fail);
        clearTimeout(timer);
      }
      var timer = setTimeout(fail, 15000);
      var resolved = null; // endanleg slóð eftir framsendingu, ef hls.js gefur hana
      video.addEventListener('loadedmetadata', ok);
      video.addEventListener('error', fail);

      if (a.how === 'hls') {
        hls = new window.Hls({ liveBackBufferLength: 0, maxBufferLength: 30, backBufferLength: 30 });
        hls.on(window.Hls.Events.ERROR, function (ev, data) { if (data && data.fatal) fail(); });
        hls.on(window.Hls.Events.MANIFEST_LOADED, function (ev, data) {
          var nd = data && data.networkDetails;
          resolved = (nd && (nd.responseURL || nd.url)) || null;
        });
        hls.loadSource(a.url);
        hls.attachMedia(video);
      } else {
        video.src = a.url;
        video.load();
      }
    }
    next(0);
  }

  function seekable() {
    var s = video.seekable;
    if (!s || !s.length) return null;
    return { start: s.start(0), end: s.end(s.length - 1) };
  }
  function liveEdge() { var s = seekable(); return s ? s.end : video.currentTime; }
  function behindLive() { return state.mode === 'live' ? Math.max(0, liveEdge() - video.currentTime) : 0; }
  function seekTo(t) {
    var s = seekable();
    if (s) t = Math.max(s.start, Math.min(t, s.end - (state.mode === 'live' ? 3 : 0.5)));
    try { video.currentTime = Math.max(0, t); } catch (e) {}
  }

  // switcher.cdn.ruv.is skilar JSON {"location": "...m3u8"} en ekki spilunarlista, og velur
  // innlendan/erlendan straum eftir IP-tölu. Því þarf sjónvarpið sjálft að spyrja hann.
  var SWITCHER = /^https:\/\/switcher\.cdn\.ruv\.is\/resolve\//;
  function resolveUrls(urls, cb) {
    var out = [], i = 0;
    function step() {
      if (i >= urls.length) { cb(out); return; }
      var u = urls[i++];
      if (!SWITCHER.test(u)) { out.push(u); step(); return; }
      var x = new XMLHttpRequest(), fin = false;
      function done(loc) { if (fin) return; fin = true; if (loc) out.push(loc); step(); }
      x.open('GET', u, true);
      x.timeout = 6000;
      x.onload = function () {
        var loc = null;
        try { loc = JSON.parse(x.responseText).location; } catch (e) { /* ekki JSON */ }
        done(x.status === 200 && typeof loc === 'string' && /^https:\/\//.test(loc) ? loc : null);
      };
      x.onerror = x.ontimeout = function () { done(null); };
      x.send();
    }
    step();
  }

  // ---------- Aðgerðir ----------
  var liveReq = 0;
  function playLive(chIndex, fromStartOfProg) {
    state.ch = (chIndex + CHANNELS.length) % CHANNELS.length;
    state.mode = 'live'; state.prog = null; state.progList = null;
    store('skjarinn.ch', String(state.ch));
    var ch = CHANNELS[state.ch], req = ++liveReq;
    spinner(true);
    resolveUrls(ch.live, function (urls) {
      if (req !== liveReq || state.mode !== 'live') return; // búið að skipta um rás á meðan
      startLive(urls, fromStartOfProg);
    });
    refreshLiveProg();
    showBar();
  }
  function startLive(urls, fromStartOfProg) {
    load(urls, null, function () {
      // seekable-gluggi beinnar útsendingar fyllist ekki strax við loadedmetadata
      if (fromStartOfProg) setTimeout(function () { jumpLiveTo(fromStartOfProg.start); }, 1500);
    });
  }

  // Spóla beinni útsendingu aftur að ákveðnum klukkutíma, ef straumurinn geymir nógu mikið
  function jumpLiveTo(ms) {
    var back = (now() - ms) / 1000, s = seekable();
    if (!s) { toast('Þessi straumur leyfir ekki að spóla til baka'); return; }
    var target = liveEdge() - back;
    if (target < s.start) {
      toast('Straumurinn geymir bara ' + Math.floor((s.end - s.start) / 60) + ' mín. aftur í tímann');
      target = s.start;
    }
    seekTo(target);
    showBar();
  }

  function playVod(prog, list) {
    if (!prog.vod) { toast('Þessi þáttur er ekki aðgengilegur í tímaflakki'); return; }
    var r = seenOf(prog), from = r && !r.done && r.pos > 30 ? r.pos - 5 : null;
    state.mode = 'vod'; state.prog = prog; state.progList = list || null;
    load([prog.vod], from, function () { seen.cur = prog; saveSeen(); });
    if (from != null) toast('Held áfram frá ' + dur(from) + '  ·  ◀ spólar til baka');
    showBar();
  }

  // ---------- Áhorf ----------
  // Man hvar var hætt í hverjum þætti (tímaflakk og Sarpur), nýjast fremst, í localStorage sjónvarpsins.
  var SEEN_KEY = 'skjarinn.seen', SEEN_MAX = 60;
  var seen = { list: null, cur: null, at: 0 };
  function seenList() {
    if (!seen.list) { try { seen.list = JSON.parse(store(SEEN_KEY)) || []; } catch (e) { seen.list = []; } }
    return seen.list;
  }
  function seenOf(p) {
    var l = seenList();
    for (var i = 0; p && i < l.length; i++) if (l[i].id === p.id) return l[i];
    return null;
  }
  // seen.cur er þátturinn sem er hlaðinn í spilarann; null á meðan skipt er um straum
  function saveSeen(done) {
    var p = seen.cur;
    if (!p) return;
    var pos = video.currentTime || 0, len = isFinite(video.duration) && video.duration > 0 ? video.duration : (p.end - p.start) / 1000;
    var l = seenList(), r = seenOf(p);
    if (!done && pos < 10 && !r) return; // rétt kíkt á þáttinn
    if (r) l.splice(l.indexOf(r), 1);
    r = {
      id: p.id, title: p.title, subtitle: p.subtitle || null, number: p.number || null, description: p.description || '',
      image: p.image || null, vod: p.vod, start: p.start, end: p.end, domesticOnly: !!p.domesticOnly, vodExpires: p.vodExpires || null,
      pos: done ? 0 : Math.round(pos), len: Math.round(len), at: now(),
      done: !!(done || (r && r.done) || (len > 0 && (pos > len - 90 || pos / len > 0.95)))
    };
    l.unshift(r);
    if (l.length > SEEN_MAX) l.length = SEEN_MAX;
    seen.at = now();
    store(SEEN_KEY, JSON.stringify(l));
  }
  // Hlutfall séð (0–1), eða -1 ef aldrei horft
  function seenPct(p) {
    var r = seenOf(p);
    if (!r) return -1;
    return r.done ? 1 : r.len ? Math.min(1, r.pos / r.len) : 0;
  }
  function seenTag(p, fallback) {
    var f = seenPct(p);
    return f >= 1 ? '✓ Séð' : f >= 0 ? Math.max(1, Math.round(f * 100)) + '% séð' : fallback;
  }
  function seenBar(p) {
    var f = seenPct(p);
    return f > 0 && f < 1 ? '<i class="pg"><i style="width:' + Math.round(f * 100) + '%"></i></i>' : '';
  }
  function seenHint(p) {
    var r = seenOf(p);
    if (!r) return null;
    if (r.done) return 'OK  Horfa aftur (þegar séð)';
    return r.pos > 30 ? 'OK  Halda áfram frá ' + dur(r.pos) + ' af ' + dur(r.len) : null;
  }
  video.addEventListener('timeupdate', function () { if (now() - seen.at > 10000) saveSeen(); });
  video.addEventListener('pause', function () { saveSeen(); });

  // Þegar tímaflakksþáttur klárast: næsti þáttur, eða aftur í beina ef við erum búin að ná henni
  video.addEventListener('ended', function () {
    saveSeen(true);
    seen.cur = null;
    if (state.mode !== 'vod' || !state.progList) return;
    var l = state.progList, i = l.indexOf(state.prog), n = l[i + 1];
    if (state.prog.sarpur) { if (n) playVod(n, l); else openSarpur(); return; }
    if (!n) { playLive(state.ch); return; }
    if (n.start <= now() && now() < n.end) { toast('Náðir beinni útsendingu'); playLive(state.ch); return; }
    if (n.vod && n.end <= now()) playVod(n, l); else playLive(state.ch);
  });

  function goLive() {
    if (state.mode === 'vod') { playLive(state.ch); return; }
    seekTo(liveEdge()); if (video.paused) video.play();
    showBar();
  }

  function togglePause() {
    if (video.paused) { state.userPaused = false; var p = video.play(); if (p && p['catch']) p['catch'](function () {}); }
    else { state.userPaused = true; video.pause(); }
    showBar(true);
  }

  // Spólun safnast upp og er framkvæmd þegar hætt er að ýta (betra fyrir HLS)
  var seekAcc = 0, seekCount = 0, seekTimer = null, seekResetTimer = null;
  function seekBy(dir) {
    if (!seekable() && state.mode === 'live') { toast('Þessi straumur leyfir ekki að spóla'); return; }
    var step = SEEK_STEPS[Math.min(seekCount, SEEK_STEPS.length - 1)];
    seekCount++;
    seekAcc += dir * step;
    clearTimeout(seekTimer); clearTimeout(seekResetTimer);
    seekTimer = setTimeout(function () {
      seekTo(video.currentTime + seekAcc);
      seekAcc = 0;
    }, 650);
    seekResetTimer = setTimeout(function () { seekCount = 0; }, 1200);
    showBar(true);
  }

  // ---------- Upplýsingastika ----------
  var barTimer = null;
  function showBar(sticky) {
    $('bar').className = 'bar';
    renderBar();
    clearTimeout(barTimer);
    if (!sticky || !video.paused) barTimer = setTimeout(hideBar, BAR_TIMEOUT);
  }
  function hideBar() { if (!video.paused && !seekAcc) $('bar').className = 'bar hidden'; }
  function barVisible() { return $('bar').className.indexOf('hidden') === -1; }

  function refreshLiveProg() {
    var ch = CHANNELS[state.ch];
    progAt(ch, now() - behindLive() * 1000, function (p, n) {
      state.liveProg = p; state.liveNext = n;
      if (barVisible()) renderBar();
    });
  }

  // Hvaða RÚV-straumur spilar: 'foreign' (ruverl – rétthafalokað innlent efni), 'domestic', 'auto' (switcher, óþekkt niðurstaða)
  function srcKind() {
    var s = state.src;
    if (!s || state.mode !== 'live' || !CHANNELS[state.ch].epg) return null;
    var u = s.resolved || s.url;
    if (/ruverl|erlend/i.test(u)) return 'foreign';
    if (/switcher\.cdn\.ruv\.is/.test(u)) return 'auto';
    return 'domestic';
  }
  function renderSrc() {
    var k = srcKind(), el = $('bar-src');
    if (!k) { el.className = 'src hidden'; return; }
    el.className = 'src ' + k;
    el.innerHTML = k === 'foreign' ? 'Erlendur straumur' : k === 'domestic' ? 'Innlendur straumur' : 'Sjálfval RÚV';
  }

  function setBadge(cls, text) { var b = $('bar-badge'); b.className = 'badge ' + cls; b.innerHTML = esc(text); }

  function renderBar() {
    var ch = CHANNELS[state.ch], fromSarpur = state.mode === 'vod' && state.prog && state.prog.sarpur;
    $('bar-num').innerHTML = ch.num;
    $('bar-num').style.display = fromSarpur ? 'none' : '';
    $('bar-chname').innerHTML = esc(fromSarpur ? 'Sarpurinn' : ch.name);
    $('bar-clock').innerHTML = hhmm(now());
    var fill = 0, head = 0, liveAt = 100, left = '', right = '', status = '', title = '', sub = '', next = '';
    var pending = seekAcc;

    if (state.mode === 'vod' && state.prog) {
      var p = state.prog, total = video.duration || (p.end - p.start) / 1000;
      var pos = Math.max(0, Math.min(total, video.currentTime + pending));
      title = p.title;
      if (p.sarpur) sub = (p.subtitle ? p.subtitle + ' · ' : '') + (p.start ? 'Sýnt ' + dateLabel(p.start) : '');
      else sub = (p.subtitle ? p.subtitle + ' · ' : '') + 'Sýnt ' + dayLabel(dayOffsetOf(p.start)).toLowerCase() + ' kl. ' + hhmm(p.start);
      fill = head = total ? pos / total * 100 : 0; liveAt = -10;
      left = dur(pos); right = '−' + dur(total - pos);
      setBadge(video.paused ? 'paused' : 'shift', video.paused ? 'Í bið' : 'Tímaflakk');
      if (pending) status = (pending > 0 ? '+' : '−') + dur(Math.abs(pending));
      var l = state.progList, nx = l ? l[l.indexOf(p) + 1] : null;
      if (nx) next = 'Næst: ' + (p.sarpur ? (nx.subtitle || nx.title) : hhmm(nx.start) + ' ' + nx.title);
    } else {
      var lp = state.liveProg, behind = behindLive() - pending;
      behind = Math.max(0, behind);
      var t = now() - behind * 1000;
      if (lp) {
        title = lp.title; sub = (lp.subtitle || '');
        var len = lp.end - lp.start;
        fill = head = Math.max(0, Math.min(100, (t - lp.start) / len * 100));
        liveAt = Math.max(0, Math.min(100, (now() - lp.start) / len * 100));
        left = hhmm(lp.start); right = hhmm(lp.end);
        if (state.liveNext) next = 'Næst: ' + hhmm(state.liveNext.start) + ' ' + state.liveNext.title;
      } else {
        title = ch.name; sub = ch.epg ? 'Sæki dagskrá…' : 'Bein útsending';
        fill = head = liveAt = 100;
      }
      if (video.paused) setBadge('paused', 'Í bið');
      else if (behind > 20) setBadge('shift', 'Tímaflakk');
      else setBadge('live', 'Í beinni');
      if (behind > 20) status = dur(behind) + ' á eftir beinni';
    }
    $('bar-title').innerHTML = esc(title);
    $('bar-sub').innerHTML = esc(sub);
    $('bar-fill').style.width = fill + '%';
    $('bar-head').style.left = head + '%';
    $('bar-live').style.left = liveAt + '%';
    $('bar-live').style.display = liveAt < 0 ? 'none' : 'block';
    $('bar-left').innerHTML = left;
    $('bar-right').innerHTML = right;
    $('bar-status').innerHTML = esc(status);
    $('bar-next').innerHTML = esc(next);
    renderSrc();
  }
  function dayOffsetOf(ms) { return Math.floor((ms - Date.parse(isoDate(0) + 'T00:00:00Z')) / 864e5); }

  // ---------- Dagskrárvalmynd ----------
  var g = { ch: 0, day: 0, idx: 0, zone: 'progs', list: [], scroll: 0 };

  function openGuide() {
    state.view = 'guide';
    hideSarpur();
    $('bar').className = 'bar hidden';
    $('guide').className = 'guide';
    g.ch = state.ch; g.zone = 'progs';
    var focusT = state.mode === 'vod' && state.prog ? state.prog.start : now() - behindLive() * 1000;
    g.day = Math.max(-DAYS_BACK, Math.min(DAYS_FWD, dayOffsetOf(focusT)));
    loadGuideList(focusT);
  }
  function closeGuide() {
    state.view = 'watch';
    $('guide').className = 'guide hidden';
    showBar();
  }

  function loadGuideList(focusT) {
    var ch = CHANNELS[g.ch];
    renderGuideFrame();
    if (!ch.epg) {
      g.list = [{ id: 'live', title: 'Bein útsending', start: 0, end: 0, liveOnly: true, description: 'Engin dagskrá eða tímaflakk í boði fyrir ' + ch.name + '.' }];
      g.idx = 0; renderGuideList(); return;
    }
    $('g-progs').innerHTML = '<li class="g-empty">Sæki dagskrá…</li>';
    var reqCh = g.ch, reqDay = g.day;
    getEpg(ch, g.day, function (list) {
      if (reqCh !== g.ch || reqDay !== g.day) return;
      g.list = list;
      var i = focusT != null ? findAt(list, focusT) : -1;
      if (i < 0) i = g.day === 0 ? findAt(list, now()) : 0;
      if (i < 0) i = 0;
      g.idx = i; g.scroll = null;
      renderGuideList();
    });
  }

  function renderGuideFrame() {
    var html = '', d;
    for (d = -DAYS_BACK; d <= DAYS_FWD; d++) {
      html += '<div class="g-day' + (d === g.day ? ' sel' : '') + (d === g.day && g.zone === 'days' ? ' focus' : '') + '">' + esc(dayLabel(d)) + '</div>';
    }
    $('g-days').innerHTML = html;
    // haldið "í dag" sýnilegu: skruna dögum þannig að valinn dagur sjáist
    var days = $('g-days'), sel = days.children[g.day + DAYS_BACK];
    if (sel) days.scrollLeft = Math.max(0, sel.offsetLeft - days.offsetWidth / 2);
    $('g-sarpur').className = 'g-day g-sarpur' + (g.zone === 'sarpur' ? ' focus' : '');

    // Rásalistinn er byggður einu sinni (hann getur verið þúsundir lína); eftir það er
    // bara valin lína færð til
    var box = $('g-channels');
    if (!chEls) buildChannelList(box);
    if (chSel) chSel.className = 'g-ch';
    chSel = chEls[g.ch];
    chSel.className = 'g-ch sel' + (g.zone === 'channels' ? ' focus' : '');
    $('guide').className = 'guide' + (g.zone === 'channels' ? ' zone-ch' : '');
    // Halda valinni rás fyrir miðju þegar listinn er lengri en skjárinn
    box.scrollTop = Math.max(0, chSel.offsetTop - box.clientHeight / 2 + chSel.offsetHeight / 2);
    $('g-clock').innerHTML = hhmm(now());
  }

  var chEls = null, chSel = null;
  // Flokkafyrirsagnir þegar rásir eru í fleiri en einum flokki (t.d. IPTV)
  function buildChannelList(box) {
    var html = '', grouped = groupOf(0) !== groupOf(CHANNELS.length - 1);
    for (var i = 0; i < CHANNELS.length; i++) {
      if (grouped && (i === 0 || groupOf(i) !== groupOf(i - 1))) {
        html += '<li class="g-grp"><span>' + esc(groupOf(i)) + '</span><span class="g-grp-n">' + groupSize(i) + '</span></li>';
      }
      html += '<li class="g-ch"><span class="num">' + CHANNELS[i].num + '</span><span class="nm">' + esc(CHANNELS[i].name) + '</span></li>';
    }
    box.innerHTML = html;
    chEls = box.querySelectorAll('.g-ch');
  }

  function groupOf(i) { return CHANNELS[i].group || 'Opnar rásir'; }
  function groupSize(i) { var n = 0; for (var j = i; j < CHANNELS.length && groupOf(j) === groupOf(i); j++) n++; return n; }
  // Fyrsta rás í næsta (dir=1) eða þessum/fyrri (dir=-1) flokki
  function groupJump(i, dir) {
    var grp = groupOf(i), j = i;
    if (dir > 0) { while (j < CHANNELS.length - 1 && groupOf(j) === grp) j++; return j; }
    if (j > 0 && groupOf(j - 1) !== grp) { j--; grp = groupOf(j); } // efst í flokki: í fyrri flokk
    while (j > 0 && groupOf(j - 1) === grp) j--;
    return j;
  }

  function progState(p) {
    if (p.liveOnly) return 'now';
    var t = now();
    if (p.end <= t) return 'past';
    if (p.start <= t) return 'now';
    return 'future';
  }

  function renderGuideList() {
    var html = '', l = g.list;
    if (!l.length) html = '<li class="g-empty">Engin dagskrá fannst fyrir þennan dag.</li>';
    for (var i = 0; i < l.length; i++) {
      var p = l[i], st = progState(p), cls = 'g-prog ' + st, tag = '';
      if (st === 'past') { tag = p.vod ? seenTag(p, 'Tímaflakk') : 'Ekki í boði'; if (!p.vod) cls += ' novod'; else if (seenPct(p) >= 1) cls += ' seen'; }
      else if (st === 'now') tag = '● Í beinni';
      if (state.mode === 'vod' && state.prog && state.prog.id === p.id) cls += ' playing';
      if (i === g.idx && g.zone === 'progs') cls += ' focus';
      html += '<li class="' + cls + '"><span class="t">' + (p.liveOnly ? '' : hhmm(p.start)) + '</span><span class="n">' + esc(p.title) + '</span><span class="s">' + tag + '</span>' + (p.vod ? seenBar(p) : '') + '</li>';
    }
    $('g-progs').innerHTML = html;
    scrollGuide();
    renderDetail();
  }

  function scrollGuide() { scrollList($('g-progs'), g.idx); }
  function scrollList(ul, idx) {
    var wrap = ul.parentNode, item = ul.children[idx];
    if (!item) { ul.style.top = '0px'; return; }
    var h = wrap.offsetHeight, top = item.offsetTop, ih = item.offsetHeight;
    // Haldið valinni línu í efri þriðjungi
    var target = Math.max(0, top - h / 3 + ih / 2);
    var maxScroll = Math.max(0, ul.offsetHeight - h);
    ul.style.top = -Math.min(target, maxScroll) + 'px';
  }

  function renderDetail() {
    var p = g.list[g.idx], ch = CHANNELS[g.ch];
    if (!p) { $('g-dtitle').innerHTML = ''; $('g-dmeta').innerHTML = ''; $('g-ddesc').innerHTML = ''; $('g-dhint').innerHTML = ''; $('g-img').style.backgroundImage = ''; return; }
    var st = progState(p), hint = '', meta = '';
    $('g-img').style.backgroundImage = p.image ? 'url("' + p.image + '")' : '';
    $('g-dtitle').innerHTML = esc(p.title);
    if (!p.liveOnly) {
      meta = ch.name + ' · ' + dayLabel(g.day) + ' ' + hhmm(p.start) + '–' + hhmm(p.end) + ' · ' + Math.round((p.end - p.start) / 60000) + ' mín.';
      if (p.subtitle) meta = p.subtitle + ' · ' + meta;
    }
    $('g-dmeta').innerHTML = esc(meta);
    $('g-ddesc').innerHTML = esc(p.description || '');
    if (st === 'past') hint = p.vod ? seenHint(p) || 'OK  Horfa frá byrjun' : 'RÚV býður ekki upp á þennan þátt eftir á';
    else if (st === 'now') hint = p.liveOnly ? 'OK  Horfa' : 'OK  Beint   ·   ▶  Frá byrjun';
    else hint = 'Hefst kl. ' + hhmm(p.start);
    if (p.vod && p.domesticOnly && st === 'past') hint += '   (aðeins á Íslandi)';
    $('g-dhint').innerHTML = esc(hint);
  }

  function guideKey(k) {
    if (g.zone === 'progs') {
      if (is(k, 'UP')) {
        if (g.idx > 0) { g.idx--; renderGuideList(); }
        else { g.zone = 'days'; renderGuideFrame(); renderGuideList(); }
      } else if (is(k, 'DOWN')) {
        if (g.idx < g.list.length - 1) { g.idx++; renderGuideList(); }
      } else if (is(k, 'LEFT')) {
        g.zone = 'channels'; renderGuideFrame(); renderGuideList();
      } else if (is(k, 'RIGHT')) {
        var cur = g.list[g.idx];
        if (cur && progState(cur) === 'now' && !cur.liveOnly) startProg(cur, true);
      } else if (is(k, 'OK')) {
        var p = g.list[g.idx]; if (p) startProg(p, false);
      } else if (is(k, 'CH_UP') || is(k, 'CH_DOWN')) {
        // síðu upp/niður í listanum
        g.idx = Math.max(0, Math.min(g.list.length - 1, g.idx + (is(k, 'CH_UP') ? -8 : 8))); renderGuideList();
      }
    } else if (g.zone === 'channels') {
      if (is(k, 'UP') && g.ch > 0) { g.ch--; loadGuideList(g.day === 0 ? now() : null); }
      else if (is(k, 'DOWN') && g.ch < CHANNELS.length - 1) { g.ch++; loadGuideList(g.day === 0 ? now() : null); }
      else if (is(k, 'CH_UP') || is(k, 'CH_DOWN')) {
        var to = groupJump(g.ch, is(k, 'CH_DOWN') ? 1 : -1);
        if (to !== g.ch) { g.ch = to; loadGuideList(g.day === 0 ? now() : null); }
      }
      else if (is(k, 'RIGHT')) { g.zone = 'progs'; renderGuideFrame(); renderGuideList(); }
      else if (is(k, 'OK')) { closeGuide(); playLive(g.ch); }
    } else if (g.zone === 'days') {
      if (is(k, 'LEFT') && g.day > -DAYS_BACK) { g.day--; loadGuideList(null); }
      else if (is(k, 'RIGHT') && g.day < DAYS_FWD) { g.day++; loadGuideList(g.day === 0 ? now() : null); }
      else if (is(k, 'UP')) { g.zone = 'sarpur'; renderGuideFrame(); }
      else if (is(k, 'DOWN') || is(k, 'OK')) { g.zone = 'progs'; renderGuideFrame(); renderGuideList(); }
    } else if (g.zone === 'sarpur') {
      if (is(k, 'OK') || is(k, 'RIGHT')) openSarpur();
      else if (is(k, 'DOWN')) { g.zone = 'days'; renderGuideFrame(); }
    }
  }

  function startProg(p, fromStart) {
    var st = progState(p);
    if (st === 'future') { toast('Þessi þáttur hefst kl. ' + hhmm(p.start)); return; }
    if (st === 'past' && !p.vod) { toast('Þessi þáttur er ekki aðgengilegur eftir á'); return; }
    var list = g.list, chIdx = g.ch;
    closeGuide();
    if (st === 'past') { state.ch = chIdx; playVod(p, list); return; }
    // Í gangi núna
    if (!fromStart) { if (chIdx !== state.ch || state.mode !== 'live') playLive(chIdx); else goLive(); return; }
    // Frá byrjun: helst VOD ef RÚV hefur þegar sett hann inn, annars spóla beinu útsendingunni
    if (p.vod) { state.ch = chIdx; playVod(p, list); }
    else if (chIdx === state.ch && state.mode === 'live') jumpLiveTo(p.start);
    else playLive(chIdx, p);
  }

  // ---------- Sarpurinn (efnisveita RÚV) ----------
  // Vinstri: flokkar. Miðja: þáttaraðir flokksins, eða þættir einnar þáttaraðar (sp.show).
  var sp = { panels: null, raw: null, at: 0, panel: 0, zone: 'items', idx: 0, show: null, showIdx: 0, eps: null };
  var spCache = {};
  function getJson(url, maxAge, cb) {
    var c = spCache[url];
    if (c && now() - c.at < maxAge) { cb(c.data); return; }
    var x = new XMLHttpRequest();
    x.open('GET', url, true);
    x.timeout = 15000;
    x.onload = function () {
      var d = null;
      try { d = JSON.parse(x.responseText); } catch (e) { /* tómt */ }
      if (x.status === 200 && d) { spCache[url] = { at: now(), data: d }; cb(d); } else cb(c ? c.data : null);
    };
    x.onerror = x.ontimeout = function () { cb(c ? c.data : null); };
    x.send();
  }

  // Þættir sem hefur verið horft á, sem stakir liðir svo OK spili þá beint
  function historyPanel() {
    var l = seenList(), items = [];
    for (var i = 0; i < l.length; i++) {
      var r = l[i];
      if (r.vodExpires && Date.parse(r.vodExpires) < now()) continue;
      items.push({ id: 'h' + r.id, title: r.title, subtitle: r.subtitle, description: r.description, image: r.image, multi: false, count: 1, ep: r, history: true });
    }
    return items.length ? { title: 'Nýlega horft', items: items, history: true } : null;
  }
  // sp.raw = flokkar af þjóninum; sp.panels = sömu flokkar með „Nýlega horft“ fremst
  function setPanels() {
    if (!sp.raw) return;
    var h = historyPanel(), had = !!(sp.panels && sp.panels[0].history);
    if (sp.panels) {
      if (h && !had) sp.panel++;
      else if (!h && had) sp.panel = Math.max(0, sp.panel - 1);
    }
    sp.panels = h ? [h].concat(sp.raw) : sp.raw;
    sp.panel = Math.min(sp.panel, sp.panels.length - 1);
    if (!sp.show) sp.idx = sp.panels[sp.panel].history ? 0 : Math.min(sp.idx, sp.panels[sp.panel].items.length - 1);
  }

  function openSarpur() {
    if (state.view === 'guide') $('guide').className = 'guide hidden';
    state.view = 'sarpur';
    $('bar').className = 'bar hidden';
    $('sarpur').className = 'guide sarpur';
    saveSeen();
    setPanels();
    if (sp.panels) renderSarpur(); // gamall listi strax, sá nýi kemur í staðinn
    if (sp.panels && now() - sp.at < 1800000) return;
    if (!sp.panels) { $('s-panels').innerHTML = ''; $('s-items').innerHTML = '<li class="g-empty">Sæki Sarpinn…</li>'; renderSarpurDetail(); }
    getJson('/api/sarpur', 600000, function (d) {
      if (!d || !d.panels || !d.panels.length) {
        if (!sp.panels && state.view === 'sarpur') $('s-items').innerHTML = '<li class="g-empty">Náði ekki sambandi við Sarpinn.</li>';
        return;
      }
      sp.raw = d.panels; sp.at = now();
      setPanels();
      if (state.view === 'sarpur') renderSarpur();
    });
  }
  function hideSarpur() { $('sarpur').className = 'guide sarpur hidden'; }
  function closeSarpur() {
    hideSarpur();
    state.view = 'watch';
    if (!load.current) playLive(state.ch); else showBar(); // komið beint af upphafsskjá
  }

  function spList() { return sp.show ? (sp.eps || []) : sp.panels[sp.panel].items; }
  function isPlaying(ep) { return !!(ep && state.mode === 'vod' && state.prog && state.prog.sarpur && state.prog.id === ep.id); }

  function renderSarpur() {
    var html = '', box = $('s-panels');
    for (var i = 0; i < sp.panels.length; i++) {
      html += '<li class="g-ch' + (i === sp.panel ? ' sel' + (sp.zone === 'panels' ? ' focus' : '') : '') + '"><span class="nm">' + esc(sp.panels[i].title) + '</span></li>';
    }
    box.innerHTML = html;
    var cur = box.children[sp.panel];
    if (cur) box.scrollTop = Math.max(0, cur.offsetTop - box.clientHeight / 2 + cur.offsetHeight / 2);
    $('s-crumb').innerHTML = esc(sp.show ? sp.panels[sp.panel].title + '  ›  ' + sp.show.title : '');
    $('s-clock').innerHTML = hhmm(now());
    renderSarpurItems();
  }

  function renderSarpurItems() {
    var l = spList(), html = '';
    if (sp.show && !sp.eps) html = '<li class="g-empty">Sæki þætti…</li>';
    else if (!l.length) html = '<li class="g-empty">Ekkert efni í boði.</li>';
    for (var i = 0; i < l.length; i++) {
      var it = l[i], t = '', tag = '', name = it.title;
      if (sp.show) {
        t = it.start ? dateLabel(it.start) : '';
        name = it.subtitle || (it.number ? 'Þáttur ' + it.number : it.title);
        tag = seenTag(it, Math.round((it.end - it.start) / 60000) + ' mín.');
      } else if (it.multi && it.count > 1) tag = it.count + ' þættir';
      else if (it.ep) tag = seenTag(it.ep, '');
      if (it.history && it.subtitle) name = it.title + ' – ' + it.subtitle;
      var ep = sp.show ? it : !it.multi && it.ep;
      var cls = 'g-prog' + (isPlaying(ep) ? ' playing' : '') + (ep && seenPct(ep) >= 1 ? ' seen' : '') + (i === sp.idx && sp.zone === 'items' ? ' focus' : '');
      html += '<li class="' + cls + '"><span class="t">' + esc(t) + '</span><span class="n">' + esc(name) + '</span><span class="s">' + esc(tag) + '</span>' + (ep ? seenBar(ep) : '') + '</li>';
    }
    $('s-items').innerHTML = html;
    scrollList($('s-items'), sp.idx);
    renderSarpurDetail();
  }

  function renderSarpurDetail() {
    var it = sp.panels ? spList()[sp.idx] : null;
    if (!it) { $('s-img').style.backgroundImage = ''; $('s-dtitle').innerHTML = $('s-dmeta').innerHTML = $('s-ddesc').innerHTML = $('s-dhint').innerHTML = ''; return; }
    var ep = sp.show ? it : (it.multi ? null : it.ep), meta = [], hint;
    $('s-img').style.backgroundImage = it.image ? 'url("' + it.image.replace(/"/g, '%22') + '")' : '';
    $('s-dtitle').innerHTML = esc(sp.show ? (it.subtitle || it.title) : it.title);
    if (sp.show) meta.push(it.title);
    else if (it.subtitle) meta.push(it.subtitle);
    if (it.history) meta.push('Horft ' + dateLabel(it.ep.at));
    if (ep && ep.number && sp.show) meta.push('Þáttur ' + ep.number);
    if (ep && ep.start) meta.push(dateLabel(ep.start));
    if (ep && ep.end > ep.start) meta.push(Math.round((ep.end - ep.start) / 60000) + ' mín.');
    if (!ep && it.count > 1) meta.push(it.count + ' þættir');
    $('s-dmeta').innerHTML = esc(meta.join(' · '));
    $('s-ddesc').innerHTML = esc(it.description || '');
    if (sp.zone === 'panels') hint = '▶  Skoða flokkinn';
    else if (!ep) hint = 'OK  Sjá þætti';
    else {
      hint = seenHint(ep) || 'OK  Horfa';
      if (ep.domesticOnly) hint += '   (aðeins á Íslandi)';
      if (ep.vodExpires) hint += '   ·   Í boði til ' + dateLabel(Date.parse(ep.vodExpires));
    }
    $('s-dhint').innerHTML = esc(hint);
  }

  function sarpurOpen(it) {
    if (!it) return;
    if (sp.show) { playSarpur(it, sp.eps); return; }
    if (!it.multi && it.ep) { playSarpur(it.ep, [it.ep]); return; }
    sp.show = it; sp.showIdx = sp.idx; sp.eps = null; sp.idx = 0;
    renderSarpur();
    getJson('/api/sarpur?program=' + it.id, 600000, function (d) {
      if (sp.show !== it) return;
      sp.eps = d && d.episodes ? d.episodes : [];
      // Byrja á þættinum sem er í spilun, ef hann er í listanum
      for (var i = 0; i < sp.eps.length; i++) if (isPlaying(sp.eps[i])) sp.idx = i;
      if (state.view === 'sarpur') renderSarpurItems();
    });
  }

  // Til baka um eitt þrep; false ef komið er efst
  function sarpurBack() {
    if (sp.show) { sp.show = null; sp.eps = null; sp.idx = sp.showIdx; renderSarpur(); return true; }
    if (sp.zone === 'items') { sp.zone = 'panels'; renderSarpur(); return true; }
    return false;
  }

  function playSarpur(ep, list) {
    if (!ep.vod) { toast('Þessi þáttur er ekki aðgengilegur'); return; }
    // Spilað í tímaröð svo næsti þáttur taki við þegar þessi klárast
    var chrono = list.slice().sort(function (a, b) { return a.start - b.start; });
    for (var i = 0; i < chrono.length; i++) chrono[i].sarpur = true;
    hideSarpur();
    state.view = 'watch';
    playVod(ep, chrono);
  }

  function sarpurKey(k) {
    if (!sp.panels) return;
    if (sp.zone === 'panels') {
      if (is(k, 'UP') && sp.panel > 0) { sp.panel--; sp.idx = 0; renderSarpur(); }
      else if (is(k, 'DOWN') && sp.panel < sp.panels.length - 1) { sp.panel++; sp.idx = 0; renderSarpur(); }
      else if (is(k, 'RIGHT') || is(k, 'OK')) { sp.zone = 'items'; renderSarpur(); }
      return;
    }
    var l = spList();
    if (is(k, 'UP') && sp.idx > 0) { sp.idx--; renderSarpurItems(); }
    else if (is(k, 'DOWN') && sp.idx < l.length - 1) { sp.idx++; renderSarpurItems(); }
    else if (is(k, 'CH_UP') || is(k, 'CH_DOWN')) { sp.idx = Math.max(0, Math.min(l.length - 1, sp.idx + (is(k, 'CH_UP') ? -8 : 8))); renderSarpurItems(); }
    else if (is(k, 'LEFT')) sarpurBack();
    else if (is(k, 'OK') || is(k, 'RIGHT')) sarpurOpen(l[sp.idx]);
  }

  // ---------- Fjarstýring ----------
  var numBuf = '', numTimer = null;
  function numberKey(d) {
    numBuf += d; clearTimeout(numTimer);
    toast('Rás ' + numBuf, 1500);
    numTimer = setTimeout(function () {
      var n = parseInt(numBuf, 10); numBuf = '';
      for (var i = 0; i < CHANNELS.length; i++) if (CHANNELS[i].num === n) {
        if (state.view === 'guide') closeGuide();
        else if (state.view === 'sarpur') { hideSarpur(); state.view = 'watch'; }
        playLive(i); return;
      }
      toast('Engin rás númer ' + n);
    }, 1200);
  }

  function handleBack() {
    if (state.view === 'guide') {
      if (g.zone !== 'progs') { g.zone = 'progs'; renderGuideFrame(); renderGuideList(); }
      else closeGuide();
      return;
    }
    if (state.view === 'sarpur') { if (!sarpurBack()) closeSarpur(); return; }
    // Úr þætti í Sarpinum aftur í Sarpinn, þangað sem frá var horfið
    if (state.mode === 'vod' && state.prog && state.prog.sarpur) { openSarpur(); return; }
    if (state.mode === 'vod' || behindLive() > 20) { goLive(); toast('Aftur í beina útsendingu'); return; }
    if (barVisible()) $('bar').className = 'bar hidden';
  }

  function onKey(e) {
    var k = e.keyCode;
    if (state.view === 'start') { e.preventDefault(); startKey(k); return; }
    if (onGesture()) { e.preventDefault(); return; }
    if (k >= 48 && k <= 57) { numberKey(String(k - 48)); e.preventDefault(); return; }
    if (is(k, 'BACK')) { e.preventDefault(); handleBack(); return; }
    if (is(k, 'PLAYPAUSE') || is(k, 'PLAY') || is(k, 'PAUSE')) { e.preventDefault(); if (state.view === 'watch') togglePause(); return; }
    if (is(k, 'GUIDE')) { e.preventDefault(); if (state.view === 'guide') closeGuide(); else openGuide(); return; }
    if (is(k, 'SARPUR')) { e.preventDefault(); if (state.view === 'sarpur') closeSarpur(); else openSarpur(); return; }

    if (state.view === 'guide') { e.preventDefault(); guideKey(k); return; }
    if (state.view === 'sarpur') { e.preventDefault(); sarpurKey(k); return; }

    if (is(k, 'UP') || is(k, 'CH_UP')) { e.preventDefault(); playLive(state.ch + 1); }
    else if (is(k, 'DOWN') || is(k, 'CH_DOWN')) { e.preventDefault(); playLive(state.ch - 1); }
    else if (is(k, 'LEFT') || is(k, 'REW')) { e.preventDefault(); seekBy(-1); }
    else if (is(k, 'RIGHT') || is(k, 'FF')) { e.preventDefault(); seekBy(1); }
    else if (is(k, 'OK')) {
      e.preventDefault();
      // OK heldur áfram ef notandinn pásaði; annars opnar dagskrá
      if (state.userPaused) togglePause(); else openGuide();
    }
    else if (is(k, 'STOP')) { e.preventDefault(); goLive(); }
  }
  document.addEventListener('keydown', onKey);

  // Tizen: skrá miðlunar- og rásatakka ef vafrinn/appið leyfir það
  try {
    if (window.tizen && tizen.tvinputdevice) {
      ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaRewind', 'MediaFastForward', 'MediaStop', 'ChannelUp', 'ChannelDown', 'Guide', 'ColorF3Blue',
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].forEach(function (n) { try { tizen.tvinputdevice.registerKey(n); } catch (e) {} });
    }
  } catch (e) {}

  // Til baka-takkinn í vafra: grípa hann með history svo síðan lokist ekki
  try {
    history.pushState({ skjarinn: 1 }, '');
    window.addEventListener('popstate', function () {
      history.pushState({ skjarinn: 1 }, '');
      handleBack();
    });
  } catch (e) {}

  // Músarsmellur (til prófunar í tölvu): opna/loka dagskrá
  document.addEventListener('click', function () {
    if (state.view === 'start') { leaveStart(); return; }
    if (onGesture()) return;
    if (state.view === 'guide') closeGuide(); else if (state.view === 'sarpur') closeSarpur(); else showBar();
  });

  // Uppfæra klukku/stiku reglulega
  setInterval(function () {
    if (state.view === 'guide') { $('g-clock').innerHTML = hhmm(now()); }
    else if (state.view === 'sarpur') { $('s-clock').innerHTML = hhmm(now()); }
    else if (barVisible()) renderBar();
  }, 1000);
  setInterval(function () { if (state.mode === 'live') refreshLiveProg(); }, 30000);

  video.addEventListener('waiting', function () { spinner(true); });
  video.addEventListener('playing', function () { spinner(false); });
  video.addEventListener('pause', function () { if (state.view === 'watch') showBar(true); });

  // ---------- Upphafsskjár ----------
  // Ekkert spilar fyrr en notandi ýtir á takka: þá má vafrinn spila með hljóði.
  var startReq = 0;
  function showStart(chIndex) {
    state.view = 'start';
    state.ch = (chIndex + CHANNELS.length) % CHANNELS.length;
    var ch = CHANNELS[state.ch], req = ++startReq;
    $('start').className = 'start';
    $('start-num').innerHTML = ch.num;
    $('start-chname').innerHTML = esc(ch.name);
    $('start-title').innerHTML = esc(ch.name);
    $('start-sub').innerHTML = ch.epg ? 'Sæki dagskrá…' : 'Bein útsending';
    $('start-img').style.backgroundImage = '';
    progAt(ch, now(), function (p, n) {
      if (req !== startReq || state.view !== 'start') return;
      if (!p) { $('start-sub').innerHTML = 'Bein útsending'; return; }
      $('start-title').innerHTML = esc(p.title);
      $('start-sub').innerHTML = esc('Í beinni ' + hhmm(p.start) + '–' + hhmm(p.end) + (n ? '  ·  Næst: ' + hhmm(n.start) + ' ' + n.title : ''));
      if (p.image) $('start-img').style.backgroundImage = 'url("' + p.image.replace(/"/g, '%22') + '")';
    });
  }
  function leaveStart(chIndex) {
    $('start').className = 'start hidden';
    state.view = 'watch';
    playLive(chIndex == null ? state.ch : chIndex);
  }
  function startKey(k) {
    if (is(k, 'UP') || is(k, 'CH_UP')) showStart(state.ch + 1);
    else if (is(k, 'DOWN') || is(k, 'CH_DOWN')) showStart(state.ch - 1);
    else if (is(k, 'OK') || is(k, 'PLAY') || is(k, 'PLAYPAUSE')) leaveStart();
    else if (is(k, 'LEFT') || is(k, 'SARPUR')) { $('start').className = 'start hidden'; openSarpur(); }
    else if (k >= 49 && k <= 57) {
      for (var i = 0; i < CHANNELS.length; i++) if (CHANNELS[i].num === k - 48) { leaveStart(i); return; }
    }
  }

  // ---------- Ræsing ----------
  if (!CHANNELS.length) { toast('Enginn rásalisti (channels.js)'); return; }
  var saved = parseInt(store('skjarinn.ch'), 10);
  showStart(isNaN(saved) ? 0 : Math.min(saved, CHANNELS.length - 1));
})();
