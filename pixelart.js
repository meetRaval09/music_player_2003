/*
  PIXEL ART STAGE for Pixel Tunes 2003
  A tiny 96x48 screen that plays a looping pixel animation for the current song.

  - If the song file has a cover picture inside (most MP3s do), it is shrunk into
    chunky pixels and shown with a glowing frame, sweeping scan-line and sparkles.
  - Every song also gets its own pixel scene (neon road, night city or space),
    picked from the song name, so no two songs look the same.
  - The animation moves while music plays, freezes (dimmed) on pause.

  Other code (for example a future Spotify link) can call:
      PixelArt.setSong({ title: 'Song name', cover: <Blob | image URL | null> })
      PixelArt.setPlaying(true/false)
*/
(function () {
  const W = 96, H = 48, FPS = 12;
  let canvas, g;
  let playing = false, started = false;
  let seed = 1, hue = 200, scene = 0, t = 0, trans = 99, lastFrame = 0;
  let coverPx = null, coverHue = null;      // 40x40 pixelated cover, if any
  let level = 0, smooth = 0;                // loudness 0..1
  let songToken = 0;
  const api = { levelFn: null };

  /* ---------- tiny helpers ---------- */
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(s) {                           // small repeatable random numbers
    let a = s >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let x = a; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  }
  function hsl(h, s, l) { return 'hsl(' + ((h % 360 + 360) % 360) + ',' + s + '%,' + l + '%)'; }
  function px(x, y, w, h, c) { g.fillStyle = c; g.fillRect(x | 0, y | 0, w || 1, h || 1); }

  /* ---------- read the cover picture hidden inside an MP3 (ID3 tag) ---------- */
  async function readCover(blob) {
    try {
      const head = new Uint8Array(await blob.slice(0, 10).arrayBuffer());
      if (head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return null;   // "ID3"
      const ver = head[3];
      if (ver !== 3 && ver !== 4) return null;
      const size = ((head[6] & 127) << 21) | ((head[7] & 127) << 14) | ((head[8] & 127) << 7) | (head[9] & 127);
      const buf = new Uint8Array(await blob.slice(10, 10 + Math.min(size, 6 * 1024 * 1024)).arrayBuffer());
      let p = 0;
      if (head[5] & 0x40) {                    // skip extended header
        const es = ver === 4 ? ((buf[0] & 127) << 21) | ((buf[1] & 127) << 14) | ((buf[2] & 127) << 7) | (buf[3] & 127)
                             : (buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3];
        p = ver === 4 ? es : es + 4;
      }
      while (p + 10 < buf.length) {
        const id = String.fromCharCode(buf[p], buf[p + 1], buf[p + 2], buf[p + 3]);
        if (!/^[A-Z0-9]{4}$/.test(id)) break;
        const fs = ver === 4 ? ((buf[p + 4] & 127) << 21) | ((buf[p + 5] & 127) << 14) | ((buf[p + 6] & 127) << 7) | (buf[p + 7] & 127)
                             : ((buf[p + 4] << 24) | (buf[p + 5] << 16) | (buf[p + 6] << 8) | buf[p + 7]) >>> 0;
        const start = p + 10, end = start + fs;
        if (fs <= 0 || end > buf.length) break;
        if (id === 'APIC') {
          const enc = buf[start];
          let q = start + 1;
          let mime = '';
          while (q < end && buf[q] !== 0) mime += String.fromCharCode(buf[q++]);
          q++;                                  // end of mime
          q++;                                  // picture type
          if (enc === 1 || enc === 2) {         // description in UTF-16: ends with 00 00
            while (q + 1 < end && !(buf[q] === 0 && buf[q + 1] === 0)) q += 2;
            q += 2;
          } else {
            while (q < end && buf[q] !== 0) q++;
            q++;
          }
          if (q >= end) return null;
          if (!/^image\//.test(mime)) mime = (buf[q] === 0x89) ? 'image/png' : 'image/jpeg';
          return new Blob([buf.slice(q, end)], { type: mime });
        }
        p = end;
      }
    } catch (e) { }
    return null;
  }

  /* ---------- shrink a picture into chunky 40x40 pixels with few colours ---------- */
  function pixelate(imgBlobOrUrl) {
    return new Promise(res => {
      const img = new Image();
      let url = null;
      img.onload = () => {
        try {
          const c = document.createElement('canvas'); c.width = c.height = 40;
          const x = c.getContext('2d', { willReadFrequently: true });
          x.imageSmoothingEnabled = true;
          const s = Math.min(img.width, img.height);                    // centre square crop
          x.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 40, 40);
          const d = x.getImageData(0, 0, 40, 40), a = d.data;
          let r = 0, gg = 0, b = 0;
          for (let i = 0; i < a.length; i += 4) {                         // posterize: 5 levels per colour
            for (let k = 0; k < 3; k++) a[i + k] = Math.round(a[i + k] / 63.75) * 63.75;
            r += a[i]; gg += a[i + 1]; b += a[i + 2];
          }
          const n = a.length / 4;
          r /= n; gg /= n; b /= n;
          const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
          let h = 0;
          if (mx !== mn) {
            if (mx === r) h = ((gg - b) / (mx - mn)) % 6; else if (mx === gg) h = (b - r) / (mx - mn) + 2; else h = (r - gg) / (mx - mn) + 4;
            h = Math.round(h * 60);
          }
          x.putImageData(d, 0, 0);
          if (url) URL.revokeObjectURL(url);
          res({ canvas: c, hue: (h + 360) % 360, gray: (mx - mn) < 18 });
        } catch (e) { res(null); }
      };
      img.onerror = () => { if (url) URL.revokeObjectURL(url); res(null); };
      if (typeof imgBlobOrUrl === 'string') img.src = imgBlobOrUrl;
      else { url = URL.createObjectURL(imgBlobOrUrl); img.src = url; }
    });
  }

  /* ---------- scenes ---------- */
  const mount = (() => { const r = rng(7); const a = []; for (let i = 0; i < 96; i++) a.push(r()); return a; })();

  function sceneRoad(f) {                       // synthwave sun, mountains, moving grid
    const horizon = 28;
    for (let b = 0; b < 7; b++) px(0, b * 4, W, 4, hsl(hue + b * 6, 70, 8 + b * 4));          // sky bands
    const sr = 15 + smooth * 3, cx = 48, cy = horizon;                                         // sun
    for (let y = -sr; y < 0; y++) {
      const half = Math.sqrt(sr * sr - y * y);
      if ((y + sr) % 4 === 3 && y > -sr * 0.6) continue;                                      // sun stripes
      px(cx - half, cy + y, half * 2, 1, hsl(hue + 40 + (y + sr) * 3, 95, 60));
    }
    for (let x = 0; x < W; x++) {                                                              // mountains
      const m = 1 + mount[(x + Math.floor(seed % 20)) % 96] * 2 + Math.abs(Math.sin(x / 11)) * 5;
      px(x, horizon - m, 1, m, hsl(hue + 200, 60, 10));
    }
    px(0, horizon, W, H - horizon, hsl(hue + 220, 70, 6));                                     // ground
    for (let i = 0; i < 6; i++) {                                                              // lines coming at you
      const k = ((i + f * 0.1) % 6) / 6, y = horizon + 1 + k * k * (H - horizon - 1);
      px(0, y, W, 1, hsl(hue + 300, 90, 45 + smooth * 20));
    }
    for (let i = -6; i <= 6; i++) {                                                            // lines going away
      const bottom = 48 + i * 22;
      for (let y = horizon + 1; y < H; y++) {
        const k = (y - horizon) / (H - horizon);
        px(48 + (bottom - 48) * k, y, 1, 1, hsl(hue + 300, 90, 45));
      }
    }
  }

  function sceneCity(f) {                       // night skyline, blinking windows, rain
    for (let b = 0; b < 6; b++) px(0, b * 8, W, 8, hsl(hue + 230, 55, 5 + b * 2));
    const r = rng(seed);
    for (let i = 0; i < 26; i++) { const x = r() * W, y = r() * 22; if ((f + i * 5) % 14 > 1) px(x, y, 1, 1, '#cfd6ff'); }   // stars
    px(74, 5, 7, 7, hsl(hue + 50, 30, 85)); px(76, 4, 3, 1, hsl(hue + 50, 30, 85)); px(76, 12, 3, 1, hsl(hue + 50, 30, 85)); // moon
    let x = 0, bi = 0;
    while (x < W) {                                                                            // buildings
      const w = 7 + Math.floor(r() * 8), h = 14 + Math.floor(r() * 22);
      px(x, H - h, w, h, hsl(hue + 240, 40, 8 + (bi % 3) * 3));
      for (let wy = H - h + 3; wy < H - 3; wy += 4)
        for (let wx = x + 2; wx < x + w - 2; wx += 3) {
          const on = ((hash(wx + ',' + wy + seed) + Math.floor(f / 24)) % 5) > 1;
          if (on) px(wx, wy, 1, 2, hsl(hue + 60 + (wx % 3) * 20, 90, 65));
        }
      x += w + 1; bi++;
    }
    const neon = (f % 30 < 25) || smooth > 0.5;                                                // flickering sign
    if (neon) px(10, 14, 12, 2, hsl(hue + 330, 100, 65));
    const rr = rng(seed + 99);
    for (let i = 0; i < 28; i++) {                                                             // rain
      const rx = rr() * W, sp = 1 + rr() * 2, ry = (rr() * H + f * sp * 2) % H;
      px(rx - ry * 0.15, ry, 1, 2, 'rgba(180,200,255,0.55)');
    }
  }

  function sceneSpace(f) {                      // starfield, planet, little rocket
    px(0, 0, W, H, hsl(hue + 250, 60, 5));
    for (let layer = 0; layer < 3; layer++) {
      const r = rng(seed + layer * 31), sp = (layer + 1) * 0.5;
      for (let i = 0; i < 22; i++) {
        const x = ((r() * W - f * sp) % W + W) % W, y = r() * H;
        px(x, y, 1, 1, layer === 2 ? '#ffffff' : hsl(hue + 40, 40, 60 - layer * 15));
      }
    }
    const py = 24 + Math.sin(f / 18) * 2, pr = 13 + smooth * 1.5;                              // planet
    for (let y = -pr; y <= pr; y++) {
      const half = Math.floor(Math.sqrt(pr * pr - y * y));
      const band = Math.floor((y + pr) / 4) % 2;
      px(70 - half, py + y, half * 2, 1, hsl(hue + 20 + band * 25, 70, 40 + band * 10));
    }
    px(55, py + 1, 32, 1, hsl(hue + 60, 60, 70));                                              // ring
    const rx = 12 + Math.sin(f / 10) * 3, ry = 22 + Math.cos(f / 14) * 5;                      // rocket
    px(rx, ry, 8, 3, '#dfe4ff'); px(rx + 8, ry + 1, 2, 1, '#ff5a8a'); px(rx + 2, ry - 1, 3, 1, '#9aa6ff');
    for (let i = 1; i < 7; i++) if ((f + i) % 3) px(rx - i * 2, ry + 1, 1, 1, hsl(30 - i * 4, 100, 60 - i * 4));
  }

  /* ---------- cover art on top of a scene ---------- */
  function drawCover(f) {
    const ox = 5, oy = 4, S = 40;
    const flash = smooth > 0.62;
    px(ox - 3, oy - 3, S + 6, S + 6, '#000');
    px(ox - 2, oy - 2, S + 4, S + 4, hsl(coverHue, 90, flash ? 75 : 55));
    px(ox - 1, oy - 1, S + 2, S + 2, '#000');
    g.drawImage(coverPx, ox, oy);
    const sy = (f * 1.2) % (S + 14) - 7;                                                       // scan-line sweep
    for (let k = 0; k < 3; k++) {
      const y = Math.floor(sy) + k;
      if (y >= 0 && y < S) { g.fillStyle = 'rgba(255,255,255,' + (0.28 - k * 0.08) + ')'; g.fillRect(ox, oy + y, S, 1); }
    }
    if (smooth > 0.45) { g.fillStyle = 'rgba(255,255,255,' + ((smooth - 0.45) * 0.5) + ')'; g.fillRect(ox, oy, S, S); }   // beat flash
    const r = rng(seed + Math.floor(f / 6));
    for (let i = 0; i < 4; i++) px(ox + r() * S, oy + r() * S, 1, 1, '#fff');                  // sparkles
    const bars = 8, bw = 4;                                                                    // mini equalizer on the right
    for (let i = 0; i < bars; i++) {
      const hgt = 2 + Math.floor((Math.sin(f / 3 + i * 1.7) * 0.5 + 0.5) * (6 + smooth * 22));
      px(54 + i * (bw + 1), H - 4 - hgt, bw, hgt, hsl(coverHue + i * 8, 90, 55));
    }
  }

  /* ---------- main drawing ---------- */
  function frame() {
    const f = Math.floor(t);
    if (scene === 0) sceneRoad(f); else if (scene === 1) sceneCity(f); else sceneSpace(f);
    if (coverPx) drawCover(f);
    if (trans < 14) {                                                                          // pixel dissolve between songs
      const cut = 1 - trans / 14;
      for (let by = 0; by < H; by += 4) for (let bx = 0; bx < W; bx += 4)
        if ((hash(bx + ':' + by + ':' + seed) % 100) / 100 < cut) px(bx, by, 4, 4, '#000');
    }
    if (!playing) {                                                                            // paused: dim with a checker pattern
      g.fillStyle = 'rgba(0,0,0,0.55)';
      for (let y = 0; y < H; y++) for (let x = (y % 2); x < W; x += 2) g.fillRect(x, y, 1, 1);
    }
  }

  function tick(ts) {
    requestAnimationFrame(tick);
    if (ts - lastFrame < 1000 / FPS) return;
    lastFrame = ts;
    if (document.hidden) return;
    let lv = 0;
    try { if (api.levelFn && playing) lv = api.levelFn(); } catch (e) { }
    level = lv;
    smooth += (level - smooth) * 0.5;
    if (playing) { t += 1; if (trans < 14) trans += 1; }
    else if (trans < 14) trans += 1;
    frame();
  }

  /* ---------- public ---------- */
  function applySeed(title) {
    seed = hash(title || 'PIXEL TUNES');
    hue = seed % 360;
    scene = Math.floor(seed / 360) % 3;
  }

  api.init = function (c) {
    canvas = c; canvas.width = W; canvas.height = H;
    g = canvas.getContext('2d'); g.imageSmoothingEnabled = false;
    applySeed('PIXEL TUNES 2003'); trans = 99;
    if (!started) { started = true; requestAnimationFrame(tick); }
  };

  api.setPlaying = function (p) { playing = !!p; };

  api.setSong = async function (song) {
    const token = ++songToken;
    const title = typeof song === 'string' ? song : (song.title || '');
    const cover = typeof song === 'string' ? null : song.cover;
    applySeed(title); trans = 0; t = 0; coverPx = null;
    let src = null;
    if (cover && typeof cover === 'string') src = cover;
    else if (cover) src = (cover.type && cover.type.indexOf('image/') === 0) ? cover : await readCover(cover);
    if (token !== songToken) return;
    if (src) {
      const r = await pixelate(src);
      if (token !== songToken) return;
      if (r && !r.gray) { coverPx = r.canvas; coverHue = r.hue; hue = r.hue; }
      else if (r) { coverPx = r.canvas; coverHue = hue; }
    }
  };

  window.PixelArt = api;
})();
