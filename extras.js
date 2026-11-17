/*
  EXTRAS for Pixel Tunes 2003
    PET      a pixel pet that hatches, grows while you listen, and gets sad if you stop
    LYRICS   synced lyrics (from a .lrc file you drop in, or looked up online)
    SKIN     change the colours of the whole player, or make your own
    CLIP     saves a short video of the pixel animation to share
    AMBIENT  full screen pixel scene with the song name and a clock
  Talks to the player through window.PT (see the bottom of index.html).
*/
(function () {
  'use strict';
  const PT = window.PT;
  if (!PT) return;
  const $ = (id) => document.getElementById(id);
  const api = window.api || {};
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } },
  };
  const cleanName = (n) => n.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').toUpperCase();
  const fmtMS = (t) => { t = Math.max(0, Math.floor(t || 0)); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };

  /* ---------- little stylesheet for everything below ---------- */
  const css = document.createElement('style');
  css.textContent = `
  .px{padding:8px;font-size:7px;line-height:12px;color:var(--lcd-on)}
  .px .back{color:var(--pink);cursor:pointer;margin-bottom:6px}
  .px .mut{color:var(--lcd-dim)}
  .px input{width:100%;font-family:inherit;font-size:8px;padding:5px;background:#000;color:var(--lcd-on);border:2px solid var(--lcd-dim);outline:none;text-transform:uppercase}
  .pet-top{display:flex;gap:8px;align-items:flex-start}
  .pet-top canvas{width:96px;height:96px;image-rendering:pixelated;background:#000;border:2px solid var(--lcd-dim);cursor:pointer;flex:none}
  .pet-stats{flex:1;min-width:0}
  .pet-stats div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:5px}
  .pet-stats b{font-weight:normal;color:var(--pink)}
  .meter{height:8px;background:#000;border:2px solid var(--lcd-dim);margin-top:6px}
  .meter i{display:block;height:100%;background:repeating-linear-gradient(90deg,var(--lcd-on) 0 4px,#0000 4px 5px)}
  .ly-line{height:16px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--lcd-dim);text-align:center}
  .ly-line.cur{color:var(--lcd);background:var(--lcd-on)}
  .ly-line.n1{color:var(--lcd-on)}
  .ly-plain{white-space:pre-wrap;line-height:12px;text-align:center}
  .sk{display:flex;align-items:center;gap:8px;padding:7px 6px;font-size:8px;cursor:pointer;border-bottom:1px dashed var(--lcd-dim)}
  .sk:hover{background:#133313}
  .sk .sw{display:flex;gap:0;flex:none;border:2px solid #000}
  .sk .sw i{display:block;width:9px;height:12px}
  .sk .nm{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sk.on .nm{color:var(--pink)}
  #amb{position:fixed;inset:0;z-index:50;background:#05050f;display:none;overflow:hidden;font-family:'Press Start 2P',monospace}
  body.ambient .player{display:none}
  body.ambient #amb{display:block}
  body.ambient{padding:0}
  #amb canvas#ambcv{position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated}
  #amb::after{content:"";position:absolute;inset:0;pointer-events:none;
    background:repeating-linear-gradient(#0000 0 3px,#0000002e 3px 4px),radial-gradient(ellipse at center,#0000 55%,#000000b0 100%)}
  #amb .t{position:absolute;left:4vw;bottom:13vh;right:4vw;z-index:2;color:#fff;text-shadow:.5vw .5vw 0 #000}
  #amb .t h1{font-weight:normal;font-size:min(4.2vw,64px);line-height:1.4;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  #amb .t p{font-size:min(1.9vw,26px);margin-top:1.4vw;color:var(--lcd-on)}
  #amb .clk{position:absolute;right:4vw;top:4vh;z-index:2;color:#fff;font-size:min(4vw,60px);text-shadow:.5vw .5vw 0 #000}
  #amb .pt{position:absolute;left:4vw;top:4vh;z-index:2;width:min(12vw,170px);height:min(12vw,170px);image-rendering:pixelated}
  #amb .hint{position:absolute;right:4vw;top:calc(4vh + min(5.6vw,84px));z-index:2;color:#ffffffaa;font-size:min(1.2vw,16px);transition:opacity .6s}
  #amb.idle{cursor:none}
  #amb.idle .hint{opacity:0}
  `;
  document.head.appendChild(css);

  /* =====================================================================
     SKINS
     ===================================================================== */
  const SKIN_KEYS = ['chassis', 'chassis-hi', 'chassis-lo', 'lcd', 'lcd-on', 'lcd-dim', 'accent', 'pink', 'ink', 'tb1', 'tb2'];
  const BUILTIN = [
    { name: 'CLASSIC', v: {} },
    { name: 'WALKMAN', v: { chassis: '#e0a41c', 'chassis-hi': '#ffe27a', 'chassis-lo': '#7a5408', lcd: '#1a1405', 'lcd-on': '#ffcf4a', 'lcd-dim': '#7a5a1a', accent: '#2f7fd0', pink: '#ff6a2a', ink: '#2a1800', tb1: '#7a3a00', tb2: '#d98a10' } },
    { name: 'GAMEBOY', v: { chassis: '#b9b9ab', 'chassis-hi': '#e4e4d6', 'chassis-lo': '#6e6e60', lcd: '#9bbc0f', 'lcd-on': '#0f380f', 'lcd-dim': '#5f7f1a', accent: '#a8326a', pink: '#a8326a', ink: '#222222', tb1: '#3a3a6a', tb2: '#6a3a8a' } },
    { name: 'MIDNIGHT', v: { chassis: '#2c2c52', 'chassis-hi': '#5c5c92', 'chassis-lo': '#0e0e24', lcd: '#05050f', 'lcd-on': '#00f0ff', 'lcd-dim': '#0a5a66', accent: '#ff2fd0', pink: '#ff2fd0', ink: '#e6e6ff', tb1: '#0a0a3a', tb2: '#5a1a7a' } },
    { name: 'SAKURA', v: { chassis: '#f2b5c8', 'chassis-hi': '#ffe0ea', 'chassis-lo': '#b06a85', lcd: '#2a1020', 'lcd-on': '#ff9ccf', 'lcd-dim': '#7a3a58', accent: '#ff5a8a', pink: '#ff2f7e', ink: '#4a1028', tb1: '#c0507a', tb2: '#ff9ccf' } },
  ];
  let skins = BUILTIN.slice();
  let skinName = store.get('pt_skin', 'CLASSIC');

  function applySkin(name) {
    const s = skins.find((x) => x.name === name) || skins[0];
    const root = document.documentElement;
    SKIN_KEYS.forEach((k) => root.style.removeProperty('--' + k));
    Object.keys(s.v).forEach((k) => { if (SKIN_KEYS.includes(k)) root.style.setProperty('--' + k, s.v[k]); });
    skinName = s.name;
    store.set('pt_skin', skinName);
  }
  applySkin(skinName);
  async function loadCustomSkins() {
    try {
      if (!api.skinsList) return;
      const list = await api.skinsList();
      if (!Array.isArray(list)) return;
      skins = BUILTIN.concat(list.filter((x) => x && x.name && x.v && !BUILTIN.some((b) => b.name === x.name)).map((x) => ({ name: x.name, v: x.v, custom: true })));
      if (skins.some((x) => x.name === skinName)) applySkin(skinName);
    } catch (e) { }
  }
  loadCustomSkins();

  function paintSkins(L) {
    L.innerHTML = '';
    const w = mk('div', 'px');
    const bk = mk('div', 'back', '< BACK TO PLAYLIST'); bk.onclick = () => closeView(); w.appendChild(bk);
    L.appendChild(w);
    const cs = getComputedStyle(document.documentElement);
    skins.forEach((s) => {
      const row = mk('div', 'sk' + (s.name === skinName ? ' on' : ''));
      const sw = mk('span', 'sw');
      ['chassis', 'lcd', 'lcd-on', 'accent', 'pink'].forEach((k) => {
        const i = document.createElement('i');
        i.style.background = (s.v[k]) || (s.name === 'CLASSIC' ? ({ chassis: '#8b8fa8', lcd: '#0c1a0c', 'lcd-on': '#5dff6a', accent: '#ff7a1a', pink: '#ff3d8b' })[k] : cs.getPropertyValue('--' + k));
        sw.appendChild(i);
      });
      row.appendChild(sw);
      row.appendChild(mk('span', 'nm', (s.name === skinName ? '> ' : '') + s.name + (s.custom ? '  (YOURS)' : '')));
      row.onclick = () => { applySkin(s.name); paintSkins(L); };
      L.appendChild(row);
    });
    const mine = mk('div', 'sk'); mine.appendChild(mk('span', 'nm', '[ MAKE YOUR OWN SKIN ]'));
    mine.onclick = async () => {
      if (api.skinsOpen) { await api.skinsOpen(); PT.marq('*** EDIT THE JSON FILE, THEN REOPEN SKINS ***'); setTimeout(loadCustomSkins, 800); }
      else PT.marq('*** MAKING SKINS NEEDS THE DESKTOP APP ***');
    };
    L.appendChild(mine);
    $('plt').textContent = 'SKINS'; $('count').textContent = skins.length + ' LOOKS';
  }

  /* =====================================================================
     PIXEL PET
     ===================================================================== */
  const STAGES = [
    { name: 'EGG', at: 0 },
    { name: 'BLIP', at: 300 },        // 5 min of music
    { name: 'BOP', at: 1800 },        // 30 min
    { name: 'GROOVY', at: 7200 },     // 2 hours
    { name: 'MAESTRO', at: 21600 },   // 6 hours
  ];
  const HUES = [330, 150, 200, 28, 275, 55];
  const dayKey = (d) => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  let pet = store.get('pt_pet', null);
  if (!pet || typeof pet.xp !== 'number') {
    const seed = Math.floor(Math.random() * 1e6);
    pet = { born: Date.now(), seed, name: 'PIXEL', xp: 0, last: Date.now(), streak: 0, lastDay: '', taps: 0 };
    store.set('pt_pet', pet);
  }
  let tapUntil = 0;
  const stageOf = (xp) => { let i = 0; STAGES.forEach((s, k) => { if (xp >= s.at) i = k; }); return i; };
  function petMood(now) {
    const st = PT.state();
    if (st.playing) return 'DANCING';
    const h = new Date(now).getHours();
    if (h < 5) return 'SLEEPY';
    const since = (now - pet.last) / 3600000;
    if (since < 20) return 'HAPPY';
    if (since < 48) return 'HUNGRY';
    return 'SAD';
  }
  function petSecond() {
    const now = Date.now();
    if (PT.state().playing) {
      pet.xp += 1; pet.last = now;
      const dk = dayKey(now);
      if (pet.lastDay !== dk) {
        pet.streak = (pet.lastDay === dayKey(now - 86400000)) ? pet.streak + 1 : 1;
        pet.lastDay = dk;
      }
      const before = stageOf(pet.xp - 1), after = stageOf(pet.xp);
      if (after > before) { PT.marq('*** YOUR PET GREW INTO ' + STAGES[after].name + '! ***'); tapUntil = now + 4000; }
      if (pet.xp % 10 === 0) store.set('pt_pet', pet);
    }
  }
  setInterval(petSecond, 1000);
  window.addEventListener('beforeunload', () => store.set('pt_pet', pet));

  // Draws the pet on a 32x32 canvas.
  function drawPet(cv, o) {
    const g = cv.getContext('2d');
    g.clearRect(0, 0, 32, 32);
    const { stage, mood, t, hue, hearts, prog } = o;
    const body = 'hsl(' + hue + ',70%,62%)', dark = 'hsl(' + hue + ',60%,34%)', lite = 'hsl(' + hue + ',85%,84%)';
    const ink = '#1a1030';
    const R = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), w, h); };
    const E = (cx, cy, rx, ry, c) => {
      g.fillStyle = c;
      for (let y = -ry; y <= ry; y++) { const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry + 0.01)))); g.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1); }
    };
    const dancing = mood === 'DANCING';
    const bob = dancing ? Math.round(Math.sin(t * 9) * 2) : Math.round(Math.sin(t * 2.2) * 0.8);
    const sway = dancing ? Math.round(Math.sin(t * 4.5) * 2) : 0;

    if (stage === 0) {                                   // ---- EGG ----
      let wig = 0;
      if (prog > 0.8 && (t % 3) < 0.5) wig = Math.round(Math.sin(t * 30));
      if (dancing) wig = Math.round(Math.sin(t * 8));
      const cx = 16 + wig, by = bob > 0 ? 0 : bob;
      E(cx, 21 + by, 9, 10, dark); E(cx, 15 + by, 7, 9, dark);
      E(cx, 21 + by, 8, 9, lite); E(cx, 15 + by, 6, 8, lite);
      [[-4, 12], [3, 17], [-2, 23], [5, 23], [0, 9]].forEach(([dx, y]) => R(cx + dx, y + by, 3, 2, body));
      R(cx - 4, 10 + by, 2, 2, '#fff');
      if (prog > 0.6) { const c = [[0, 8], [1, 9], [-1, 10], [1, 11], [-1, 12], [2, 13]]; c.forEach(([dx, y]) => R(cx + dx, y + by, 1, 1, ink)); }
      if (prog > 0.85) { [[-3, 14], [-2, 15], [-3, 16]].forEach(([dx, y]) => R(cx + dx, y + by, 1, 1, ink)); }
      if (mood === 'SLEEPY') zzz(R, 22, 6, t, '#fff');
      if (dancing) notes(R, t, '#ffd23f');
      if (hearts) heartsAnim(R, t);
      return;
    }

    const rx = [0, 7, 8, 9, 10][stage], ry = [0, 6, 7, 8, 9][stage];
    const cx = 16 + sway, cy = 26 - ry + bob;
    // feet
    const fl = dancing && Math.sin(t * 9) > 0 ? -1 : 0, fr = dancing && Math.sin(t * 9) <= 0 ? -1 : 0;
    R(cx - 6, 26 + fl, 4, 2, dark); R(cx + 3, 26 + fr, 4, 2, dark);
    // body
    E(cx, cy, rx + 1, ry + 1, dark); E(cx, cy, rx, ry, body);
    E(cx, cy + Math.round(ry / 3), Math.round(rx * 0.55), Math.round(ry * 0.5), lite);
    R(cx - rx + 2, cy - ry + 2, 2, 1, lite); R(cx - rx + 1, cy - ry + 3, 1, 2, lite);
    // arms (kid and up)
    if (stage >= 2) {
      const up = dancing ? Math.round(Math.sin(t * 9) * 2) : 0;
      R(cx - rx - 2, cy + 1 - up, 2, 3, dark); R(cx + rx + 1, cy + 1 + up, 2, 3, dark);
    }
    // eyes + mouth
    const ey = cy - Math.round(ry * 0.25), ex1 = cx - 3, ex2 = cx + 3;
    const eye = (ex) => {
      if (mood === 'HAPPY') { R(ex - 1, ey + 1, 1, 1, ink); R(ex, ey, 1, 1, ink); R(ex + 1, ey + 1, 1, 1, ink); }
      else if (mood === 'SLEEPY') { R(ex - 1, ey + 1, 3, 1, ink); }
      else if (mood === 'SAD') { R(ex, ey + 1, 2, 2, ink); R(ex, ey + 1, 1, 1, '#fff'); }
      else { const bl = (t % 4) < 0.15; if (bl) R(ex - 1, ey + 2, 3, 1, ink); else { R(ex - 1, ey, 2, 3, ink); R(ex - 1, ey, 1, 1, '#fff'); } }
    };
    eye(ex1); eye(ex2);
    const my = ey + 4;
    if (mood === 'HAPPY') { R(cx - 2, my, 1, 1, ink); R(cx - 1, my + 1, 3, 1, ink); R(cx + 2, my, 1, 1, ink); }
    else if (mood === 'DANCING') { R(cx - 1, my, 3, 2, '#2a0a20'); R(cx, my + 1, 1, 1, '#ff6a8a'); }
    else if (mood === 'SAD') { R(cx - 1, my, 3, 1, ink); R(cx - 2, my + 1, 1, 1, ink); R(cx + 2, my + 1, 1, 1, ink); }
    else if (mood === 'SLEEPY') { R(cx, my + 1, 1, 1, ink); }
    else { R(cx - 1, my + 1, 3, 1, ink); }
    if (mood === 'HAPPY' || mood === 'DANCING') { R(cx - 6, my - 1, 2, 1, '#ff7aa8'); R(cx + 5, my - 1, 2, 1, '#ff7aa8'); }
    if (mood === 'SAD' || mood === 'HUNGRY') { const ty = ey + 2 + Math.floor((t * 5) % 5); R(ex2 + 2, ty, 1, 2, '#6ab8ff'); }
    // growth extras
    if (stage === 2) { R(cx + sway * 0, cy - ry - 3, 1, 3, dark); R(cx - 1, cy - ry - 5, 3, 2, '#ffb347'); }
    if (stage >= 3) {                                      // headphones
      for (let x = -rx; x <= rx; x++) R(cx + x, Math.round(cy - ry - 1 + (x * x) / (rx * rx) * (ry * 0.45)), 1, 1, '#222');
      R(cx - rx - 1, cy - 2, 3, 5, '#222'); R(cx + rx - 1, cy - 2, 3, 5, '#222');
      R(cx - rx, cy - 1, 1, 3, '#ff7a1a'); R(cx + rx, cy - 1, 1, 3, '#ff7a1a');
    }
    if (stage === 4) {                                     // crown + bow tie
      R(cx - 4, cy - ry - 3, 9, 3, '#ffd23f'); R(cx - 4, cy - ry - 5, 1, 2, '#ffd23f'); R(cx, cy - ry - 6, 1, 3, '#ffd23f'); R(cx + 4, cy - ry - 5, 1, 2, '#ffd23f');
      R(cx, cy - ry - 2, 1, 1, '#ff3d8b');
      R(cx - 3, cy + ry - 3, 2, 2, '#ff3d8b'); R(cx + 2, cy + ry - 3, 2, 2, '#ff3d8b'); R(cx - 1, cy + ry - 3, 3, 2, '#c0206a');
    }
    if (mood === 'SLEEPY') zzz(R, 22, 4, t, '#fff');
    if (dancing) notes(R, t, '#ffd23f');
    if (hearts) heartsAnim(R, t);
  }
  function zzz(R, x, y, t, c) {
    for (let i = 0; i < 2; i++) { const k = (t * 0.8 + i * 0.5) % 1, xx = x + i * 3 + Math.round(k * 3), yy = y + 6 - Math.round(k * 8) - i * 2; R(xx, yy, 3, 1, c); R(xx + 1, yy + 1, 1, 1, c); R(xx, yy + 2, 3, 1, c); }
  }
  function notes(R, t, c) {
    for (let i = 0; i < 3; i++) { const k = (t * 0.9 + i / 3) % 1, x = 4 + i * 10 + Math.round(Math.sin(k * 6 + i) * 2), y = 18 - Math.round(k * 16); R(x, y, 1, 3, c); R(x - 1, y + 3, 2, 1, c); R(x + 1, y, 1, 1, c); }
  }
  function heartsAnim(R, t) {
    for (let i = 0; i < 3; i++) { const k = (t * 1.1 + i / 3) % 1, x = 9 + i * 7, y = 14 - Math.round(k * 13); const c = '#ff3d8b'; R(x, y, 1, 1, c); R(x + 2, y, 1, 1, c); R(x, y + 1, 3, 1, c); R(x + 1, y + 2, 1, 1, c); }
  }
  const petInfo = (now) => {
    const stage = stageOf(pet.xp), nextAt = STAGES[stage + 1] ? STAGES[stage + 1].at : null;
    const prog = nextAt ? (pet.xp - STAGES[stage].at) / (nextAt - STAGES[stage].at) : 1;
    return { stage, prog, mood: petMood(now), hue: HUES[pet.seed % HUES.length], hearts: now < tapUntil };
  };
  const hm = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? h + 'H ' + m + 'M' : m + 'M ' + (s % 60) + 'S'; };

  let petUI = null;
  function paintPet(L) {
    L.innerHTML = '';
    const w = mk('div', 'px');
    const bk = mk('div', 'back', '< BACK TO PLAYLIST'); bk.onclick = () => closeView(); w.appendChild(bk);
    const top = mk('div', 'pet-top');
    const cv = document.createElement('canvas'); cv.width = 32; cv.height = 32; cv.title = 'Pet me!';
    cv.onclick = () => { tapUntil = Date.now() + 2500; pet.taps++; store.set('pt_pet', pet); };
    top.appendChild(cv);
    const stats = mk('div', 'pet-stats');
    const nameIn = mk('input'); nameIn.maxLength = 10; nameIn.value = pet.name;
    nameIn.onchange = () => { pet.name = (nameIn.value || 'PIXEL').toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 10) || 'PIXEL'; nameIn.value = pet.name; store.set('pt_pet', pet); };
    stats.appendChild(nameIn);
    const rows = {};
    ['stage', 'mood', 'age', 'heard', 'streak'].forEach((k) => { const d = mk('div'); rows[k] = d; stats.appendChild(d); });
    top.appendChild(stats); w.appendChild(top);
    const meter = mk('div', 'meter'); const fill = document.createElement('i'); meter.appendChild(fill); w.appendChild(meter);
    const tip = mk('div', 'mut'); tip.style.marginTop = '6px'; w.appendChild(tip);
    L.appendChild(w);
    petUI = { cv, rows, fill, tip };
    $('plt').textContent = 'PIXEL PET'; $('count').textContent = 'LV ' + (stageOf(pet.xp) + 1);
    updatePetPanel();
  }
  function updatePetPanel() {
    if (!petUI) return;
    const now = Date.now(), info = petInfo(now), st = STAGES[info.stage];
    drawPet(petUI.cv, { ...info, t: now / 1000 });
    const r = petUI.rows;
    r.stage.innerHTML = ''; r.stage.append('STAGE: ', Object.assign(mk('b', null, st.name)));
    r.mood.innerHTML = ''; r.mood.append('MOOD: ', mk('b', null, info.stage === 0 && info.mood !== 'DANCING' ? 'WAITING' : info.mood));
    const days = Math.max(1, Math.ceil((now - pet.born) / 86400000));
    r.age.textContent = 'AGE: ' + days + (days === 1 ? ' DAY' : ' DAYS');
    r.heard.textContent = 'MUSIC: ' + hm(pet.xp);
    r.streak.textContent = 'STREAK: ' + pet.streak + (pet.streak === 1 ? ' DAY' : ' DAYS');
    petUI.fill.style.width = Math.round(info.prog * 100) + '%';
    $('count').textContent = 'LV ' + (info.stage + 1);
    const nx = STAGES[info.stage + 1];
    const tips = { DANCING: 'I LOVE THIS SONG!', HAPPY: 'TAP ME! PLAY MUSIC TO MAKE ME GROW.', HUNGRY: 'I AM HUNGRY. PLAY SOME MUSIC!', SAD: 'I MISSED YOU... PLAY A SONG?', SLEEPY: 'ZZZ... SHHH, IT IS LATE.' };
    petUI.tip.textContent = (nx ? 'GROWS INTO ' + nx.name + ' AT ' + hm(nx.at) + '. ' : 'FULLY GROWN! ') + (tips[info.mood] || '');
  }

  /* =====================================================================
     LYRICS
     ===================================================================== */
  const lyr = { key: '', status: 'idle', lines: [], plain: '', src: '', off: 0 };
  const id3cache = new WeakMap();

  function decodeText(b, enc) {
    try {
      if (enc === 1 || enc === 2) { const be = enc === 2 || (b[0] === 0xFE && b[1] === 0xFF); const a = (b[0] === 0xFF && b[1] === 0xFE) || (b[0] === 0xFE && b[1] === 0xFF) ? b.subarray(2) : b; return new TextDecoder(be ? 'utf-16be' : 'utf-16le').decode(a); }
      return new TextDecoder(enc === 3 ? 'utf-8' : 'windows-1252').decode(b);
    } catch (e) { return ''; }
  }
  async function readId3(blob) {
    if (!blob) return {};
    if (id3cache.has(blob)) return id3cache.get(blob);
    const out = {};
    try {
      const buf = new Uint8Array(await blob.slice(0, 262144).arrayBuffer());
      if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
        const ver = buf[3], size = ((buf[6] & 127) << 21) | ((buf[7] & 127) << 14) | ((buf[8] & 127) << 7) | (buf[9] & 127);
        let p = 10; const end = Math.min(buf.length, 10 + size);
        while (p + 10 < end && ver >= 3) {
          const id = String.fromCharCode(buf[p], buf[p + 1], buf[p + 2], buf[p + 3]);
          if (!/^[A-Z0-9]{4}$/.test(id)) break;
          const sz = ver === 4 ? ((buf[p + 4] & 127) << 21) | ((buf[p + 5] & 127) << 14) | ((buf[p + 6] & 127) << 7) | (buf[p + 7] & 127)
            : ((buf[p + 4] << 24) | (buf[p + 5] << 16) | (buf[p + 6] << 8) | buf[p + 7]) >>> 0;
          if (sz <= 0 || p + 10 + sz > buf.length) break;
          if (id === 'TIT2' || id === 'TPE1') {
            const f = buf.subarray(p + 11, p + 10 + sz);
            const txt = decodeText(f, buf[p + 10]).replace(/\0+$/g, '').replace(/\0.*/, '').trim();
            if (txt) out[id === 'TIT2' ? 'title' : 'artist'] = txt;
          }
          p += 10 + sz;
        }
      }
    } catch (e) { }
    id3cache.set(blob, out);
    return out;
  }
  function tidy(s) {
    return String(s || '').replace(/\[[^\]]*\]|\([^)]*(official|video|lyric|audio|full song|hd|4k|remaster)[^)]*\)/gi, ' ')
      .replace(/^\s*\d{1,3}\s*[-.]\s*/, '').replace(/\s+/g, ' ').trim();
  }
  async function songInfo() {
    const st = PT.state();
    if (!st.title) return null;
    if (st.src === 'spotify') return { key: 'A|' + st.artist + '|' + st.title, title: st.title, artist: st.artist, dur: st.dur, fileKey: null };
    const tags = await readId3(st.file);
    let title = tags.title || tidy(st.name), artist = tags.artist || '';
    if (!tags.title && / - /.test(title)) { const p = title.split(' - '); artist = p[0]; title = p.slice(1).join(' - '); }
    return { key: 'A|' + artist + '|' + title, title, artist, dur: st.dur, fileKey: 'F|' + st.name };
  }
  function lrcParse(txt) {
    const lines = []; let off = 0;
    String(txt || '').split(/\r?\n/).forEach((raw) => {
      const o = raw.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/i); if (o) { off = parseInt(o[1], 10) / 1000; return; }
      const m = raw.match(/^\s*((?:\[\d+:\d+(?:[.:]\d+)?\])+)(.*)$/); if (!m) return;
      const text = m[2].trim();
      for (const tm of m[1].matchAll(/\[(\d+):(\d+)(?:[.:](\d+))?\]/g)) {
        const frac = tm[3] ? parseInt(tm[3], 10) / Math.pow(10, tm[3].length) : 0;
        lines.push({ t: parseInt(tm[1], 10) * 60 + parseInt(tm[2], 10) + frac, text });
      }
    });
    lines.sort((a, b) => a.t - b.t);
    return { lines, off };
  }
  function cacheGet(k) { return store.get('pt_lyr_' + k, null); }
  function cachePut(k, v) {
    const idx = store.get('pt_lyr_idx', []).filter((x) => x !== k); idx.push(k);
    while (idx.length > 120) { try { localStorage.removeItem('pt_lyr_' + idx.shift()); } catch (e) { } }
    store.set('pt_lyr_idx', idx); store.set('pt_lyr_' + k, v);
  }
  function applyLyrics(rec, src) {
    if (rec && rec.synced) { const r = lrcParse(rec.synced); if (r.lines.length) { lyr.lines = r.lines; lyr.off = r.off; lyr.plain = ''; lyr.status = 'ok'; lyr.src = src; return true; } }
    if (rec && rec.plain) { lyr.lines = []; lyr.plain = rec.plain; lyr.status = 'plain'; lyr.src = src; return true; }
    return false;
  }
  let lyrToken = 0;
  async function loadLyrics() {
    const tok = ++lyrToken;
    const info = await songInfo();
    if (tok !== lyrToken) return;
    if (!info) { lyr.key = ''; lyr.status = 'idle'; lyr.lines = []; lyr.plain = ''; return; }
    if (lyr.key === info.key + '|' + info.title && lyr.status !== 'idle') return;
    lyr.key = info.key + '|' + info.title; lyr.lines = []; lyr.plain = ''; lyr.status = 'loading'; lyr.src = '';
    let rec = info.fileKey && cacheGet(info.fileKey);
    if (rec && applyLyrics(rec, 'YOUR .LRC FILE')) return;
    rec = cacheGet(info.key);
    if (rec && applyLyrics(rec, 'SAVED')) return;
    if (!api.lyricsGet) { lyr.status = 'none'; return; }
    let r; try { r = await api.lyricsGet({ title: info.title, artist: info.artist, dur: info.dur }); } catch (e) { r = null; }
    if (tok !== lyrToken) return;
    if (r && r.ok && applyLyrics(r, 'LRCLIB.NET')) { cachePut(info.key, { synced: r.synced, plain: r.plain }); return; }
    lyr.status = 'none';
  }

  let lyUI = null;
  function paintLyrics(L) {
    L.innerHTML = '';
    const w = mk('div', 'px');
    const bk = mk('div', 'back', '< BACK TO PLAYLIST'); bk.onclick = () => closeView(); w.appendChild(bk);
    const head = mk('div', 'mut'); head.style.marginBottom = '4px'; w.appendChild(head);
    const box = mk('div'); w.appendChild(box);
    L.appendChild(w);
    lyUI = { head, box, rows: [], sig: '' };
    $('plt').textContent = 'LYRICS'; $('count').textContent = '--';
    loadLyrics();
    updateLyrics();
  }
  function updateLyrics() {
    if (!lyUI) return;
    const st = PT.state();
    const sig = st.title + '|' + st.src;
    if (sig !== lyUI.sig) { lyUI.sig = sig; lyr.status = 'idle'; lyr.key = ''; loadLyrics(); }
    const { head, box } = lyUI;
    if (!st.title) { head.textContent = ''; box.innerHTML = ''; lyUI.rows = []; box.appendChild(mk('div', 'mut', 'PLAY A SONG FIRST, THEN SEE ITS LYRICS HERE.')); lyUI.mode = 'msg'; return; }
    if (lyr.status === 'idle' || lyr.status === 'loading') { head.textContent = 'LOOKING FOR LYRICS...'; return; }
    if (lyr.status === 'none') {
      head.textContent = 'NO LYRICS FOUND';
      if (lyUI.mode !== 'none') { box.innerHTML = ''; box.appendChild(mk('div', 'mut', 'TIP: DROP A .LRC FILE WITH THE SAME NAME AS THE SONG INTO THE PLAYER, OR CHECK YOUR INTERNET.')); lyUI.mode = 'none'; lyUI.rows = []; }
      return;
    }
    head.textContent = 'LYRICS FROM ' + lyr.src;
    if (lyr.status === 'plain') {
      if (lyUI.mode !== 'plain') { box.innerHTML = ''; const d = mk('div', 'ly-plain', lyr.plain); box.appendChild(d); lyUI.mode = 'plain'; lyUI.rows = []; }
      return;
    }
    if (lyUI.mode !== 'sync') {
      box.innerHTML = ''; lyUI.rows = [];
      for (let i = 0; i < 9; i++) { const d = mk('div', 'ly-line'); box.appendChild(d); lyUI.rows.push(d); }
      lyUI.mode = 'sync';
    }
    const pos = st.pos + lyr.off + 0.2;
    let idx = -1;
    for (let i = 0; i < lyr.lines.length; i++) { if (lyr.lines[i].t <= pos) idx = i; else break; }
    for (let k = 0; k < 9; k++) {
      const i = idx - 4 + k, d = lyUI.rows[k], ln = lyr.lines[i];
      const text = ln ? ln.text || '♪' : '';
      if (d.textContent !== text) d.textContent = text;
      d.className = 'ly-line' + (i === idx && idx >= 0 ? ' cur' : (Math.abs(i - idx) === 1 ? ' n1' : ''));
    }
    $('count').textContent = (idx + 1) + '/' + lyr.lines.length;
  }
  window.PTX_lyricsTest = { lrcParse };

  /* =====================================================================
     views (PET / LYRICS / SKIN share the playlist area)
     ===================================================================== */
  let view = null, tickTimer = null, lyTick = 0;
  const BTN = { pet: 'bpet', lyrics: 'blyr', skins: 'bskin' };
  function paint() {
    const L = $('list'); if (!L || !view) return;
    petUI = null; lyUI = null;
    L.scrollTop = 0;
    if (view === 'pet') paintPet(L);
    else if (view === 'lyrics') paintLyrics(L);
    else if (view === 'skins') paintSkins(L);
    Object.keys(BTN).forEach((k) => $(BTN[k]).classList.toggle('on', k === view));
    clearInterval(tickTimer);
    tickTimer = setInterval(() => {
      if (view === 'pet') updatePetPanel();
      else if (view === 'lyrics' && (++lyTick % 3 === 0)) updateLyrics();
    }, 80);
  }
  function openView(name) { if (view === name) return closeView(); view = name; paint(); }
  function closeView(noRender) {
    if (!view) return;
    view = null; clearInterval(tickTimer); petUI = null; lyUI = null;
    Object.keys(BTN).forEach((k) => $(BTN[k]).classList.remove('on'));
    if (!noRender) PT.rerender();
  }
  $('bpet').onclick = () => openView('pet');
  $('blyr').onclick = () => openView('lyrics');
  $('bskin').onclick = () => openView('skins');

  window.PTX = {
    active: () => !!view,
    paint,
    close: closeView,
    takeFiles(list) {                       // .lrc files dropped in with songs
      const arr = [...list], rest = [], lrc = [];
      arr.forEach((f) => (/\.lrc$/i.test(f.name) ? lrc : rest).push(f));
      lrc.forEach((f) => f.text().then((txt) => { cachePut('F|' + cleanName(f.name), { synced: txt, plain: '' }); lyr.status = 'idle'; lyr.key = ''; }).catch(() => { }));
      if (lrc.length) PT.marq('*** ' + lrc.length + ' LYRICS FILE' + (lrc.length > 1 ? 'S' : '') + ' ADDED ***');
      return { rest, n: lrc.length };
    },
  };

  /* =====================================================================
     AMBIENT (full screen)
     ===================================================================== */
  let amb = null, ambOn = false, ambRaf = 0, ambIdle = 0, ambTextAt = 0;
  function buildAmb() {
    amb = mk('div'); amb.id = 'amb';
    const cv = document.createElement('canvas'); cv.id = 'ambcv'; amb.appendChild(cv);
    const pc = document.createElement('canvas'); pc.className = 'pt'; pc.width = 32; pc.height = 32; amb.appendChild(pc);
    amb.appendChild(mk('div', 'clk'));
    const t = mk('div', 't'); t.appendChild(mk('h1')); t.appendChild(mk('p')); amb.appendChild(t);
    amb.appendChild(mk('div', 'hint', 'CLICK OR PRESS ESC TO GO BACK'));
    document.body.appendChild(amb);
    amb.addEventListener('click', () => leaveAmbient());
    amb.addEventListener('mousemove', () => { amb.classList.remove('idle'); clearTimeout(ambIdle); ambIdle = setTimeout(() => amb.classList.add('idle'), 2500); });
  }
  function ambFrame(now) {
    if (!ambOn) return;
    ambRaf = requestAnimationFrame(ambFrame);
    const cv = $('ambcv'), W = window.innerWidth, H = window.innerHeight;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
    g.fillStyle = '#05050f'; g.fillRect(0, 0, W, H);
    const src = $('stage'), sw = 96, sh = 48;                   // fill the screen, cropping the edges ("cover")
    const k = Math.max(W / sw, H / sh), dw = sw * k, dh = sh * k;
    g.drawImage(src, 0, 0, sw, sh, (W - dw) / 2, (H - dh) / 2, dw, dh);
    // chunky equalizer along the bottom
    const n = 40, bars = PT.bars(n), bw = W / n, cell = Math.max(5, Math.round(H / 100));
    const cs = getComputedStyle(document.documentElement);
    const c1 = cs.getPropertyValue('--lcd-on').trim() || '#5dff6a', c2 = cs.getPropertyValue('--accent').trim() || '#ff7a1a', c3 = cs.getPropertyValue('--pink').trim() || '#ff3d8b';
    for (let i = 0; i < n; i++) {
      const h = Math.round(bars[i] * 6);
      for (let y = 0; y < h; y++) { g.fillStyle = y > 4 ? c3 : y > 2 ? c2 : c1; g.fillRect(Math.round(i * bw) + 2, H - (y + 1) * (cell + 2), Math.round(bw) - 4, cell); }
    }
    if (now - ambTextAt > 400) {
      ambTextAt = now;
      const st = PT.state();
      amb.querySelector('h1').textContent = st.title || 'PIXEL TUNES 2003';
      amb.querySelector('p').textContent = st.artist || (st.playing ? 'NOW PLAYING' : 'PRESS PLAY');
      amb.querySelector('.clk').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    drawPet(amb.querySelector('.pt'), { ...petInfo(Date.now()), t: Date.now() / 1000 });
  }
  function enterAmbient() {
    if (ambOn) return;
    if (!amb) buildAmb();
    ambOn = true;
    if (api.ambient) api.ambient(true);
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => { });
    document.body.classList.add('ambient'); amb.classList.remove('idle');
    clearTimeout(ambIdle); ambIdle = setTimeout(() => amb.classList.add('idle'), 2500);
    $('bamb').classList.add('on');
    ambRaf = requestAnimationFrame(ambFrame);
  }
  function leaveAmbient() {
    if (!ambOn) return;
    ambOn = false; cancelAnimationFrame(ambRaf);
    document.body.classList.remove('ambient'); $('bamb').classList.remove('on');
    if (api.ambient) api.ambient(false);
    else if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => { });
  }
  $('bamb').onclick = () => (ambOn ? leaveAmbient() : enterAmbient());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ambOn) { e.preventDefault(); leaveAmbient(); } });

  /* =====================================================================
     CLIP (record the pixel animation as a short video)
     ===================================================================== */
  let recording = false;
  function pickMime() {
    const list = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    for (const m of list) { try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m; } catch (e) { } }
    return '';
  }
  function ellipsize(g, text, maxW) { if (g.measureText(text).width <= maxW) return text; while (text.length > 1 && g.measureText(text + '...').width > maxW) text = text.slice(0, -1); return text + '...'; }
  async function recordClip(seconds) {
    if (recording) return;
    const st = PT.state();
    if (!st.title || !st.playing) { PT.marq('*** PLAY A SONG FIRST, THEN PRESS CLIP ***'); return; }
    const mime = pickMime();
    if (!mime) { PT.marq('*** THIS COMPUTER CANNOT RECORD VIDEO ***'); return; }
    recording = true; $('bclip').classList.add('on');
    try { await document.fonts.load('20px "Press Start 2P"'); } catch (e) { }
    const S = 720, cv = document.createElement('canvas'); cv.width = S; cv.height = S;
    const g = cv.getContext('2d');
    const stage = $('stage'), cs = getComputedStyle(document.documentElement);
    const col = (k, d) => cs.getPropertyValue('--' + k).trim() || d;
    let title = st.title, artist = st.artist;
    function frame() {
      const now = Date.now();
      g.imageSmoothingEnabled = false;
      const grd = g.createLinearGradient(0, 0, 0, S); grd.addColorStop(0, '#0a0a1f'); grd.addColorStop(0.55, '#1a1050'); grd.addColorStop(1, '#3a1060');
      g.fillStyle = grd; g.fillRect(0, 0, S, S);
      g.fillStyle = '#ffffff10'; for (let y = 0; y < S; y += 4) g.fillRect(0, y, S, 1);
      g.font = '26px "Press Start 2P"'; g.textBaseline = 'top'; g.textAlign = 'center';
      g.fillStyle = '#b02a8a'; g.fillText('PIXEL TUNES 2003', S / 2 + 3, 43); g.fillStyle = '#fff'; g.fillText('PIXEL TUNES 2003', S / 2, 40);
      g.fillStyle = col('lcd-dim', '#1f5a26'); g.fillRect(20, 120, 680, 344);
      g.drawImage(stage, 0, 0, 96, 48, 24, 124, 672, 336);
      g.font = '22px "Press Start 2P"'; g.fillStyle = col('lcd-on', '#5dff6a');
      g.fillText(ellipsize(g, title, 660), S / 2, 490);
      if (artist) { g.font = '14px "Press Start 2P"'; g.fillStyle = '#ffb347'; g.fillText(ellipsize(g, artist, 660), S / 2, 530); }
      const n = 24, bars = PT.bars(n), bw = 600 / n;
      for (let i = 0; i < n; i++) { const h = Math.max(1, Math.round(bars[i] * 7)); for (let y = 0; y < h; y++) { g.fillStyle = y > 4 ? col('pink', '#ff3d8b') : y > 2 ? col('accent', '#ff7a1a') : col('lcd-on', '#5dff6a'); g.fillRect(60 + i * bw + 2, 650 - y * 11, bw - 4, 9); } }
      g.font = '11px "Press Start 2P"'; g.fillStyle = '#ffffffaa'; g.fillText('github.com/meetRaval09/music_player_2003', S / 2, 685);
    }
    frame();
    const stream = cv.captureStream(24);
    let mr;
    try { mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4000000 }); }
    catch (e) { recording = false; $('bclip').classList.remove('on'); PT.marq('*** CLIP FAILED TO START ***'); return; }
    const chunks = []; mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const timer = setInterval(frame, 41);
    const total = seconds || 8, t0 = Date.now();
    const cd = setInterval(() => PT.marq('*** RECORDING ' + Math.max(0, total - Math.round((Date.now() - t0) / 1000)) + ' ***'), 500);
    const done = new Promise((res) => { mr.onstop = res; });
    mr.start(250);
    setTimeout(() => { try { mr.stop(); } catch (e) { } }, total * 1000);
    await done;
    clearInterval(timer); clearInterval(cd); stream.getTracks().forEach((t) => t.stop());
    const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
    const blob = new Blob(chunks, { type: mime.split(';')[0] });
    recording = false; $('bclip').classList.remove('on');
    if (!blob.size) { PT.marq('*** CLIP CAME OUT EMPTY, TRY AGAIN ***'); return; }
    if (api.saveClip) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const r = await api.saveClip(bytes, ext, title);
      PT.marq(r && r.ok ? '*** CLIP SAVED (' + ext.toUpperCase() + ') IN VIDEOS > PIXEL TUNES CLIPS ***' : '*** COULD NOT SAVE THE CLIP ***');
    } else {
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'pixel-tunes-clip.' + ext; a.click();
      PT.marq('*** CLIP SAVED (' + ext.toUpperCase() + ') ***');
    }
  }
  $('bclip').onclick = () => recordClip(8);
  window.PTX_test = { recordClip, drawPet, STAGES, pet: () => pet, setXp: (x) => { pet.xp = x; }, lrcParse, readId3 };
})();
