/*
  8-BIT MODE for Pixel Tunes 2003

  Listens to the song that is playing and plays it back again as an old game console would:
    - two "pulse" voices (square-ish beeps)  -> the main tune and a second note
    - one "triangle" voice                   -> the bass line
    - a "noise" voice                        -> hi-hats and snares (the shhh sounds)
    - a quick "thump"                        -> the kick drum

  How it works, in plain words: 30 times a second we look at which pitches (musical notes) are loudest
  in the song, round them to the nearest piano note, and ask the beepers to play exactly that note.
  The result is an approximation, so it sounds like a Game Boy covering the song.

  Only works with your own song files (Spotify does not let us hear its audio).
*/
(function () {
  'use strict';
  const PT = window.PT;
  if (!PT || !PT.audio) return;
  const $ = (id) => document.getElementById(id);

  const FFT = 8192;
  const TICK_MS = 40;
  const MODES = ['OFF', 'ONLY', 'MIX'];
  let mode = 0;
  let G = null;           // the audio nodes we built
  let timer = 0, waitTimer = 0;

  const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);
  const midi = (f) => Math.round(69 + 12 * Math.log2(f / 440));

  // A "pulse" wave with a chosen width (duty), like the NES chip makes.
  function pulseWave(ctx, duty) {
    const N = 40, re = new Float32Array(N + 1), im = new Float32Array(N + 1);
    for (let n = 1; n <= N; n++) {
      const a = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
      re[n] = a * Math.cos(n * Math.PI * duty);
      im[n] = a * Math.sin(n * Math.PI * duty);
    }
    return ctx.createPeriodicWave(re, im);
  }

  function build(ctx, au) {
    const out = ctx.createGain(); out.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 9500;
    out.connect(lp); lp.connect(ctx.destination);
    const dest = ctx.createMediaStreamDestination(); lp.connect(dest);

    const voice = (wave, type) => {
      const o = ctx.createOscillator();
      if (wave) o.setPeriodicWave(wave); else o.type = type;
      o.frequency.value = 220;
      const g = ctx.createGain(); g.gain.value = 0;
      o.connect(g); g.connect(out); o.start();
      return { o, g };
    };
    const p1 = voice(pulseWave(ctx, 0.25)), p2 = voice(pulseWave(ctx, 0.125)), tri = voice(null, 'triangle');

    // noise voice (hi-hat / snare)
    const nbuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), nd = nbuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const ns = ctx.createBufferSource(); ns.buffer = nbuf; ns.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5500;
    const ng = ctx.createGain(); ng.gain.value = 0;
    ns.connect(hp); hp.connect(ng); ng.connect(out); ns.start();

    // kick drum: a square beep that drops quickly in pitch
    const kick = voice(null, 'square');
    kick.o.frequency.value = 60;

    const an = ctx.createAnalyser();
    an.fftSize = FFT; an.smoothingTimeConstant = 0; an.minDecibels = -120; an.maxDecibels = 0;

    return {
      ctx, au, out, lp, dest, p1, p2, tri, ng, kick, an, ms: null, src: null,
      db: new Float32Array(an.frequencyBinCount), m: new Float32Array(an.frequencyBinCount), m2: new Float32Array(an.frequencyBinCount),
      binHz: ctx.sampleRate / FFT,
      // follow-the-loudness memory + note stability memory
      ref1: 1e-6, ref2: 1e-6, refB: 1e-6,
      cand: [-1, -1, -1], count: [0, 0, 0], cur: [-1, -1, -1],
      eHi: [], eLo: [], lastHat: 0, lastKick: 0,
      info: { n1: -1, n2: -1, nb: -1, l1: 0, l2: 0, lb: 0, hat: 0, kick: 0 },
      hits: { hat: 0, kick: 0 },
    };
  }

  // The listening tap: a copy of the song that ignores the volume and mute buttons.
  function ensureTap() {
    const au = G.au;
    const tr = G.ms && G.ms.getAudioTracks()[0];
    if (G.ms && tr && tr.readyState !== 'ended') return true;
    if (!au.captureStream) return false;
    let ms; try { ms = au.captureStream(); } catch (e) { return false; }
    if (!ms.getAudioTracks().length) return false;
    try { if (G.src) G.src.disconnect(); } catch (e) { }
    G.ms = ms; G.src = G.ctx.createMediaStreamSource(ms); G.src.connect(G.an);
    return true;
  }

  // Find the best note between loHz and hiHz: the pitch whose harmonics (2x, 3x, 4x ...) are also loud.
  function bestPitch(m, binHz, loHz, hiHz, maxH) {
    const lo = Math.max(2, Math.floor(loHz / binHz)), hi = Math.min(m.length / (maxH + 1) | 0, Math.ceil(hiHz / binHz));
    let bestB = -1, best = 0;
    const W = [1, 0.85, 0.65, 0.5, 0.35];
    for (let b = lo; b <= hi; b++) {
      let s = 0;
      for (let h = 1; h <= maxH; h++) {
        const c = b * h; if (c + 1 >= m.length) break;
        const v = Math.max(m[c - 1], m[c], m[c + 1]);
        s += v * W[h - 1];
      }
      s *= 1; // fundamental has to be present too
      if (m[b] + (m[b - 1] || 0) + (m[b + 1] || 0) < 1e-9) continue;
      if (s > best) { best = s; bestB = b; }
    }
    if (bestB < 0) return null;
    // sharpen with a parabola around the peak of the fundamental
    let pk = bestB;
    if (m[bestB + 1] > m[pk]) pk = bestB + 1;
    if (m[bestB - 1] > m[pk]) pk = bestB - 1;
    const a = Math.log(m[pk - 1] + 1e-12), b2 = Math.log(m[pk] + 1e-12), c = Math.log(m[pk + 1] + 1e-12);
    const den = a - 2 * b2 + c;
    const off = Math.abs(den) < 1e-9 ? 0 : 0.5 * (a - c) / den;
    return { f: (pk + Math.max(-0.5, Math.min(0.5, off))) * binHz, sal: best, bin: bestB };
  }
  function maskHarmonics(m, binHz, f0, H) {
    for (let h = 1; h <= H; h++) {
      const c = Math.round(f0 * h / binHz);
      for (let k = -2; k <= 2; k++) if (c + k > 0 && c + k < m.length) m[c + k] = 0;
    }
  }

  function setVoice(v, note, level, t, ctx) {
    if (note > 0) v.o.frequency.setValueAtTime(hz(note), t);
    v.g.gain.setTargetAtTime(level, t, 0.012);
  }

  function tick() {
    if (!G) return;
    const { ctx, au } = G, t = ctx.currentTime;
    const playing = !au.paused && !au.ended && au.readyState > 2;
    const master = (mode > 0 && !au.muted) ? Math.pow(au.volume, 1.2) * 0.95 : 0;
    G.out.gain.setTargetAtTime(master, t, 0.02);
    if (!playing || !ensureTap()) {
      [G.p1, G.p2, G.tri].forEach((v) => v.g.gain.setTargetAtTime(0, t, 0.03));
      return;
    }
    G.an.getFloatFrequencyData(G.db);
    const m = G.m, m2 = G.m2, db = G.db;
    let tot = 0;
    for (let i = 0; i < db.length; i++) { const v = db[i] > -119 ? Math.pow(10, db[i] / 20) : 0; m[i] = v; m2[i] = v; }
    const bh = G.binHz;

    // --- lead (pulse 1) and second voice (pulse 2) ---
    const lead = bestPitch(m, bh, 190, 1250, 4);
    let second = null;
    if (lead) {
      maskHarmonics(m2, bh, lead.f, 8);
      second = bestPitch(m2, bh, 150, 1250, 3);
    }
    // --- bass (triangle) ---
    const bass = bestPitch(m, bh, 38, 170, 3);

    const refUp = (key, v) => { G[key] = Math.max(G[key] * 0.9975, v); };
    refUp('ref1', lead ? lead.sal : 0);
    refUp('ref2', second ? second.sal : 0);
    refUp('refB', bass ? bass.sal : 0);
    const level = (c, ref, gate) => {
      if (!c) return 0;
      const r = c.sal / ref; if (r < gate) return 0;
      return Math.max(1, Math.round(Math.min(1, r) * 6)) / 6;        // 6 volume steps, like the old chips
    };
    const L = [level(lead, G.ref1, 0.16), level(second, G.ref1, 0.34), level(bass, G.refB, 0.20)];
    const notes = [lead ? midi(lead.f) : -1, second ? midi(second.f) : -1, bass ? midi(bass.f) : -1];
    if (second && notes[1] === notes[0]) { notes[1] = -1; L[1] = 0; }
    const voices = [G.p1, G.p2, G.tri], amp = [0.20, 0.13, 0.30];
    for (let i = 0; i < 3; i++) {
      const n = notes[i];
      if (n > 0 && L[i] > 0) {                                      // a note must repeat twice in a row to count (less jitter)
        if (n === G.cand[i]) G.count[i]++; else { G.cand[i] = n; G.count[i] = 1; }
        if (G.count[i] >= 2 && n !== G.cur[i]) { G.cur[i] = n; voices[i].o.frequency.setValueAtTime(hz(n), t); }
      } else { G.count[i] = 0; }
      voices[i].g.gain.setTargetAtTime(L[i] > 0 && G.cur[i] > 0 ? L[i] * amp[i] : 0, t, 0.010);
    }

    // --- drums: look for sudden jumps of energy ---
    const sum = (a, b) => { let s = 0; for (let i = Math.round(a / bh); i < Math.round(b / bh); i++) s += m[i]; return s; };
    const eHi = sum(5000, 14000), eLo = sum(35, 120);
    const onset = (hist, e, k) => {
      const n = hist.length;
      let mean = 0; for (let i = 0; i < n; i++) mean += hist[i]; mean = n ? mean / n : 0;
      let sd = 0; for (let i = 0; i < n; i++) sd += (hist[i] - mean) * (hist[i] - mean); sd = n ? Math.sqrt(sd / n) : 0;
      hist.push(e); if (hist.length > 30) hist.shift();
      return n > 10 && e > mean + k * sd && e > mean * 1.35 + 1e-9;
    };
    const now = performance.now();
    if (onset(G.eHi, eHi, 1.6) && now - G.lastHat > 70) {
      G.lastHat = now; G.hits.hat++;
      G.ng.gain.cancelScheduledValues(t); G.ng.gain.setValueAtTime(0.16, t); G.ng.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    }
    if (onset(G.eLo, eLo, 1.8) && now - G.lastKick > 140) {
      G.lastKick = now; G.hits.kick++;
      const o = G.kick.o, g = G.kick.g;
      o.frequency.cancelScheduledValues(t); o.frequency.setValueAtTime(170, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.09);
      g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0.28, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    }
    G.info = { n1: notes[0], n2: notes[1], nb: notes[2], l1: L[0], l2: L[1], lb: L[2] };
  }

  function start() {
    const a = PT.audio();
    if (!a || !a.ctx) return false;
    if (!G || G.ctx !== a.ctx) G = build(a.ctx, a.au);
    G.origGain = a.origGain;
    if (!timer) timer = setInterval(tick, TICK_MS);
    return true;
  }
  function applyMode() {
    const btn = $('b8');
    if (btn) { btn.classList.toggle('on', mode > 0); btn.textContent = mode === 2 ? '8BIT+' : '8-BIT'; }
    const a = PT.audio();
    if (a && a.origGain && a.ctx) a.origGain.gain.setTargetAtTime(mode === 0 ? 1 : (mode === 2 ? 0.3 : 0), a.ctx.currentTime, 0.02);
    if (mode === 0 && G) { const t = G.ctx.currentTime; [G.p1, G.p2, G.tri, G.kick].forEach((v) => v.g.gain.setTargetAtTime(0, t, 0.02)); G.ng.gain.setTargetAtTime(0, t, 0.02); G.out.gain.setTargetAtTime(0, t, 0.02); }
  }
  function setMode(m) {
    if (m > 0 && PT.isSpotify()) { PT.marq('*** 8-BIT MODE NEEDS YOUR OWN SONG FILES (NOT SPOTIFY) ***'); return; }
    mode = m;
    if (mode > 0 && !start()) {                         // the player starts its audio on the first PLAY
      PT.marq('*** PLAY A SONG FIRST, THEN 8-BIT ***'); mode = 0; applyMode(); return;
    }
    applyMode();
    PT.marq(mode === 0 ? '*** 8-BIT MODE OFF ***' : mode === 1 ? '*** 8-BIT MODE: CHIPTUNE ONLY ***' : '*** 8-BIT MODE: CHIPTUNE MIXED WITH THE SONG ***');
  }
  document.addEventListener('DOMContentLoaded', () => { });
  const btn = $('b8');
  if (btn) btn.onclick = () => setMode((mode + 1) % 3);
  // if Spotify gets switched on while 8-bit is running, turn it off
  setInterval(() => { if (mode > 0 && PT.isSpotify()) setMode(0); }, 1000);

  window.Chip8 = {
    mode: () => mode,
    setMode,
    stream: () => (G ? G.dest.stream : null),
    info: () => (G ? { ...G.info, hits: { ...G.hits } } : null),
  };
})();
