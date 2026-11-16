// Spotify web link: log in to your Spotify account, list your playlists and their songs,
// and tell Spotify to play a song. Uses Spotify's official Web API with the safe "PKCE" login
// (no password and no secret key is stored - only a Client ID that you create yourself).
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const REDIRECT_PORT = 8766;
const REDIRECT_URI = 'http://127.0.0.1:' + REDIRECT_PORT + '/callback';
const SCOPES = 'playlist-read-private playlist-read-collaborative user-modify-playback-state user-read-playback-state';

function b64url(buf) { return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

function createSpotifyWeb({ dir, openExternal, launchSpotify, fetchFn, waitMs }) {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const pollMs = waitMs == null ? 1000 : waitMs;
  const doFetch = fetchFn || ((...a) => fetch(...a));
  const file = path.join(dir, 'spotify-auth.json');
  let auth = { clientId: '', access: '', refresh: '', exp: 0 };
  try { auth = { ...auth, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (e) { }
  const save = () => { try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(auth)); } catch (e) { } };

  async function tokenCall(params) {
    const r = await doFetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error_description || j.error || ('login failed ' + r.status));
    return j;
  }

  async function token() {
    if (!auth.refresh) throw new Error('NOT LOGGED IN');
    if (Date.now() < auth.exp - 30000 && auth.access) return auth.access;
    const j = await tokenCall({ grant_type: 'refresh_token', refresh_token: auth.refresh, client_id: auth.clientId });
    auth.access = j.access_token; auth.exp = Date.now() + (j.expires_in || 3600) * 1000;
    if (j.refresh_token) auth.refresh = j.refresh_token;
    save();
    return auth.access;
  }

  async function call(method, pathOrUrl, body) {
    const t = await token();
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : 'https://api.spotify.com/v1' + pathOrUrl;
    const r = await doFetch(url, {
      method,
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 204) return {};
    const text = await r.text();
    let j = {}; try { j = text ? JSON.parse(text) : {}; } catch (e) { }
    if (!r.ok) {
      const err = new Error((j.error && (j.error.message || j.error.reason)) || ('Spotify error ' + r.status));
      err.status = r.status; err.reason = j.error && j.error.reason;
      throw err;
    }
    return j;
  }

  async function fetchAll(pathStart, maxPages) {
    let url = pathStart, all = [], n = 0;
    while (url && n < maxPages) {
      const j = await call('GET', url);
      all = all.concat(j.items || []);
      url = j.next; n++;
    }
    return all;
  }

  const wrap = async (fn) => { try { return { ok: true, data: await fn() }; } catch (e) { return { ok: false, error: String(e.message || e), status: e.status || 0 }; } };

  return {
    REDIRECT_URI,
    status: () => ({ hasClient: !!auth.clientId, loggedIn: !!auth.refresh, redirect: REDIRECT_URI }),
    setClient: (id) => { id = String(id || '').trim(); if (!/^[0-9a-zA-Z]{20,64}$/.test(id)) return { ok: false, error: 'THAT DOES NOT LOOK LIKE A CLIENT ID' }; auth = { clientId: id, access: '', refresh: '', exp: 0 }; save(); return { ok: true }; },
    logout: () => { auth.access = ''; auth.refresh = ''; auth.exp = 0; save(); return { ok: true }; },
    resetAll: () => { auth = { clientId: '', access: '', refresh: '', exp: 0 }; save(); return { ok: true }; },

    login: () => wrap(() => new Promise((resolve, reject) => {
      if (!auth.clientId) return reject(new Error('NO CLIENT ID'));
      const verifier = b64url(crypto.randomBytes(64));
      const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
      const state = b64url(crypto.randomBytes(16));
      let done = false, timer;
      const server = http.createServer(async (req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (u.pathname !== '/callback') { res.writeHead(404); return res.end(); }
        const code = u.searchParams.get('code'), err = u.searchParams.get('error');
        const ok = !err && code && u.searchParams.get('state') === state;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<body style="font-family:monospace;background:#0b0b1e;color:#5dff6a;text-align:center;padding-top:80px"><h2>' +
          (ok ? 'PIXEL TUNES IS CONNECTED' : 'LOGIN FAILED') + '</h2><p>You can close this tab now.</p></body>');
        if (done) return; done = true; clearTimeout(timer); server.close();
        if (!ok) return reject(new Error(err ? 'SPOTIFY SAID: ' + err : 'LOGIN CHECK FAILED'));
        try {
          const j = await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, client_id: auth.clientId, code_verifier: verifier });
          auth.access = j.access_token; auth.refresh = j.refresh_token; auth.exp = Date.now() + (j.expires_in || 3600) * 1000;
          save(); resolve(true);
        } catch (e) { reject(e); }
      });
      server.on('error', (e) => { if (!done) { done = true; reject(new Error('PORT ' + REDIRECT_PORT + ' IS BUSY (' + e.code + ')')); } });
      server.listen(REDIRECT_PORT, '127.0.0.1', () => {
        timer = setTimeout(() => { if (!done) { done = true; server.close(); reject(new Error('LOGIN TIMED OUT')); } }, 180000);
        const url = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
          response_type: 'code', client_id: auth.clientId, scope: SCOPES, redirect_uri: REDIRECT_URI,
          state, code_challenge_method: 'S256', code_challenge: challenge,
        }).toString();
        openExternal(url);
      });
    })),

    playlists: () => wrap(async () => {
      const items = await fetchAll('/me/playlists?limit=50', 4);
      return items.filter(Boolean).map(p => ({
        id: p.id, name: p.name || '(no name)', uri: p.uri,
        total: (p.items && p.items.total) ?? (p.tracks && p.tracks.total) ?? null,
      }));
    }),

    items: (id) => wrap(async () => {
      if (!/^[0-9a-zA-Z]+$/.test(id || '')) throw new Error('BAD PLAYLIST');
      const rows = await fetchAll('/playlists/' + id + '/items?limit=100', 3);
      const out = [];
      for (const e of rows) {
        const t = e && (e.item || e.track || null);
        if (!t || !t.uri || t.is_local || /^spotify:local:/.test(t.uri)) continue;
        const artist = (t.artists || []).map(a => a.name).join(', ') || (t.show && t.show.name) || '';
        out.push({ uri: t.uri, name: t.name || '(no name)', artist });
      }
      return out;
    }),

    search: (q, offset) => wrap(async () => {
      q = String(q || '').trim().slice(0, 100);
      if (!q) throw new Error('TYPE A SONG OR FILM NAME FIRST');
      const off = Math.max(0, Math.min(40, parseInt(offset, 10) || 0));
      const j = await call('GET', '/search?type=album,track&limit=10&offset=' + off + '&q=' + encodeURIComponent(q));
      const t = j.tracks || {}, a = j.albums || {};
      const items = (t.items || []).filter(x => x && x.uri).map(x => ({
        uri: x.uri, name: x.name || '(no name)', artist: (x.artists || []).map(y => y.name).join(', '),
      }));
      const albums = (a.items || []).filter(x => x && x.id && x.uri).map(x => ({
        id: x.id, uri: x.uri, name: x.name || '(no name)', artist: (x.artists || []).map(y => y.name).join(', '),
        year: String(x.release_date || '').slice(0, 4), total: x.total_tracks == null ? null : x.total_tracks,
      }));
      return { items, albums, more: (!!t.next || !!a.next) && off + 10 < 40 };
    }),

    album: (id) => wrap(async () => {
      if (!/^[0-9a-zA-Z]+$/.test(id || '')) throw new Error('BAD ALBUM');
      const rows = await fetchAll('/albums/' + id + '/tracks?limit=50', 3);
      return rows.filter(x => x && x.uri && !x.is_local).map(x => ({
        uri: x.uri, name: x.name || '(no name)', artist: (x.artists || []).map(y => y.name).join(', '),
      }));
    }),

    play: (contextUri, trackUri, uris) => wrap(async () => {
      const okUri = (u) => typeof u === 'string' && /^spotify:(track|episode):[0-9a-zA-Z]+$/.test(u);
      let body;
      if (contextUri) body = trackUri ? { context_uri: contextUri, offset: { uri: trackUri } } : { context_uri: contextUri };
      else if (Array.isArray(uris) && uris.length && uris.every(okUri) && uris.includes(trackUri)) body = { uris: uris.slice(0, 50), offset: { uri: trackUri } };
      else if (okUri(trackUri)) body = { uris: [trackUri] };
      else throw new Error('BAD SONG');
      try { await call('PUT', '/me/player/play', body); }
      catch (e) {
        if (e.status === 404) {                       // no active Spotify player yet
          let dev = ((await call('GET', '/me/player/devices')).devices || [])[0];
          if (!dev && launchSpotify) {                // start the Spotify app by itself and wait for it
            launchSpotify();
            for (let i = 0; i < 25 && !dev; i++) {
              await sleep(pollMs);
              dev = ((await call('GET', '/me/player/devices')).devices || [])[0];
            }
            if (dev) await sleep(pollMs);              // let it finish waking up
          }
          if (!dev) throw new Error('COULD NOT START SPOTIFY. OPEN IT ONCE, THEN TRY AGAIN');
          await call('PUT', '/me/player/play?device_id=' + encodeURIComponent(dev.id), body);
        } else if (e.status === 403) throw new Error('SPOTIFY SAYS NO: ' + (e.reason || e.message));
        else throw e;
      }
      return true;
    }),
  };
}
module.exports = { createSpotifyWeb, REDIRECT_URI };
