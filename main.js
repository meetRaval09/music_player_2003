const { app, BrowserWindow, Menu, ipcMain, screen, powerSaveBlocker, shell } = require('electron');

// Keep music running when the window is hidden, covered, or the screen is off
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
let blockerId = null;
const path = require('path');
const fs = require('fs');

const { createBuddyServer } = require('./buddy-server');
const { createSpotifyLink } = require('./spotify-link');
const { createSpotifyWeb } = require('./spotify-web');

const WIDTH = 360; // player is 340 wide + 10px breathing room each side
let win;
let ambientPrev = null, ambientPin = false;   // set while the full-screen AMBIENT mode is on

// ---- Desk Buddy link (ESP32 gadget on your Wi-Fi) ----
// Change BUDDY_KEY to your own secret word, and use the same word in the ESP32 sketch.
const BUDDY_PORT = 8765;
const BUDDY_KEY = 'buddy2003';
let buddyState = { playing: false, pos: 0, dur: 0, index: 0, count: 0, title: '' };
ipcMain.on('buddy:state', (_e, s) => { buddyState = { ...buddyState, ...s }; });
let buddyPet = null;
ipcMain.on('buddy:pet', (_e, s) => { buddyPet = s; });

// ---- Spotify link (Windows media controls) ----
const spotify = createSpotifyLink((st) => { if (win && !win.isDestroyed()) win.webContents.send('spotify:state', st); });
ipcMain.on('spotify:on', () => spotify.start());
ipcMain.on('spotify:off', () => spotify.stop());
ipcMain.on('spotify:cmd', (_e, name) => spotify.command(name));
app.on('will-quit', () => spotify.stop());

// ---- Spotify playlists (official Web API, your own login) ----
const spWeb = createSpotifyWeb({ dir: app.getPath('userData'), openExternal: (u) => shell.openExternal(u), launchSpotify: () => shell.openExternal('spotify:') });
ipcMain.handle('sp:status', () => spWeb.status());
ipcMain.handle('sp:setClient', (_e, id) => spWeb.setClient(id));
ipcMain.handle('sp:login', () => spWeb.login());
ipcMain.handle('sp:logout', () => spWeb.logout());
ipcMain.handle('sp:reset', () => spWeb.resetAll());
ipcMain.handle('sp:playlists', () => spWeb.playlists());
ipcMain.handle('sp:items', (_e, id) => spWeb.items(id));
ipcMain.handle('sp:play', (_e, ctx, track, uris) => spWeb.play(ctx, track, uris));
ipcMain.handle('sp:album', (_e, id) => spWeb.album(id));
ipcMain.handle('sp:search', (_e, q, off) => spWeb.search(q, off));

// ---- Lyrics (free lookup at lrclib.net, only sends the song name and artist) ----
async function lrclibFetch(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'PixelTunes2003/1.2 (https://github.com/meetRaval09/music_player_2003)' } });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; } finally { clearTimeout(timer); }
}
ipcMain.handle('lyrics:get', async (_e, q) => {
  const title = String((q && q.title) || '').slice(0, 120).trim();
  const artist = String((q && q.artist) || '').slice(0, 120).trim();
  const dur = Math.round(Number(q && q.dur) || 0);
  if (!title) return { ok: false, error: 'NO TITLE' };
  let hit = null;
  if (artist && dur > 0) hit = await lrclibFetch('https://lrclib.net/api/get?' + new URLSearchParams({ track_name: title, artist_name: artist, duration: String(dur) }));
  if (!hit || (!hit.syncedLyrics && !hit.plainLyrics)) {
    const list = await lrclibFetch('https://lrclib.net/api/search?' + new URLSearchParams({ q: (artist ? artist + ' ' : '') + title }));
    if (Array.isArray(list)) {
      const score = (x) => (x.syncedLyrics ? 0 : 100) + (dur > 0 && x.duration ? Math.abs(x.duration - dur) : 0);
      const cand = list.filter((x) => x && (x.syncedLyrics || x.plainLyrics)).sort((a, b) => score(a) - score(b));
      hit = cand[0] || null;
    }
  }
  if (!hit) return { ok: false, error: 'NOT FOUND' };
  return { ok: true, synced: String(hit.syncedLyrics || '').slice(0, 60000), plain: String(hit.plainLyrics || '').slice(0, 60000) };
});

// ---- Share clip: save the recorded video in Videos > Pixel Tunes clips ----
ipcMain.handle('clip:save', async (_e, bytes, ext, title) => {
  try {
    const buf = Buffer.from(bytes);
    if (!buf.length || buf.length > 150 * 1024 * 1024) return { ok: false, error: 'BAD SIZE' };
    const dir = path.join(app.getPath('videos'), 'Pixel Tunes clips');
    fs.mkdirSync(dir, { recursive: true });
    const safe = String(title || 'clip').replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'clip';
    const file = path.join(dir, safe + '-' + Date.now() + (ext === 'mp4' ? '.mp4' : '.webm'));
    fs.writeFileSync(file, buf);
    shell.showItemInFolder(file);
    return { ok: true, file };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});

// ---- Skins: your own colour files live in the "skins" folder next to the app settings ----
const SKIN_KEYS = ['chassis', 'chassis-hi', 'chassis-lo', 'lcd', 'lcd-on', 'lcd-dim', 'accent', 'pink', 'ink', 'tb1', 'tb2'];
const skinDir = () => path.join(app.getPath('userData'), 'skins');
ipcMain.handle('skins:list', () => {
  const out = [];
  try {
    for (const f of fs.readdirSync(skinDir()).filter((n) => /\.json$/i.test(n)).slice(0, 20)) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(skinDir(), f), 'utf8'));
        const name = String(j.name || f.replace(/\.json$/i, '')).toUpperCase().replace(/[^A-Z0-9 _-]/g, '').slice(0, 14).trim();
        const v = {};
        for (const k of SKIN_KEYS) if (typeof j[k] === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(j[k])) v[k] = j[k];
        if (name && Object.keys(v).length) out.push({ name, v });
      } catch (e) { }
    }
  } catch (e) { }
  return out;
});
ipcMain.handle('skins:open', async () => {
  try {
    fs.mkdirSync(skinDir(), { recursive: true });
    if (!fs.readdirSync(skinDir()).some((n) => /\.json$/i.test(n))) {
      fs.writeFileSync(path.join(skinDir(), 'my-skin.json'), JSON.stringify({
        name: 'MY SKIN', chassis: '#8fb8a0', 'chassis-hi': '#d2efe0', 'chassis-lo': '#3f6a56',
        lcd: '#0a1a14', 'lcd-on': '#7dffc0', 'lcd-dim': '#1f6a4a', accent: '#ffb000', pink: '#ff4d6d',
        ink: '#10201a', tb1: '#1a4a3a', tb2: '#3aa87a',
      }, null, 2));
    }
    await shell.openPath(skinDir());
    return { ok: true };
  } catch (e) { return { ok: false }; }
});

function startBuddyServer() {
  const server = createBuddyServer({
    key: BUDDY_KEY,
    getState: () => buddyState,
    getPet: () => buddyPet,
    onCommand: (name) => { if (win && !win.isDestroyed()) win.webContents.send('buddy:cmd', name); },
  });
  server.on('error', (e) => console.log('Desk Buddy link could not start:', e.message));
  server.listen(BUDDY_PORT, '0.0.0.0');
}

const stateFile = () => path.join(app.getPath('userData'), 'window.json');
function readState() {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (e) { return {}; }
}
function saveState() {
  if (!win || win.isDestroyed() || ambientPrev) return;
  try {
    const [x, y] = win.getPosition();
    fs.writeFileSync(stateFile(), JSON.stringify({ x, y }));
  } catch (e) {}
}
function onScreen(x, y) {
  return screen.getAllDisplays().some(d => {
    const b = d.workArea;
    return x >= b.x - 20 && y >= b.y - 20 && x < b.x + b.width - 40 && y < b.y + b.height - 40;
  });
}

function createWindow() {
  const st = readState();
  const wa = screen.getPrimaryDisplay().workArea;
  let x = wa.x + wa.width - WIDTH - 20;     // default: bottom-right corner
  let y = wa.y + wa.height - 700;
  if (typeof st.x === 'number' && onScreen(st.x, st.y)) { x = st.x; y = st.y; }

  win = new BrowserWindow({
    x, y,
    width: WIDTH,
    height: 700,
    useContentSize: true,
    frame: false,            // no Windows title bar: it is a floating widget
    transparent: true,       // see-through corners around the pixel box
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    alwaysOnTop: false,      // sits behind other windows like a normal desktop widget
    backgroundColor: '#00000000',
    title: 'PIXEL TUNES 2003',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('moved', saveState);
  win.on('close', saveState);
}

// AMBIENT mode: stretch the window over the whole screen, and put it back afterwards
ipcMain.on('w:ambient', (_e, on) => {
  if (!win || win.isDestroyed()) return;
  if (on && !ambientPrev) {
    ambientPrev = win.getBounds();
    ambientPin = win.isAlwaysOnTop();
    const d = screen.getDisplayMatching(ambientPrev);
    win.setResizable(true);
    win.setBounds(d.bounds);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.focus();
  } else if (!on && ambientPrev) {
    const prev = ambientPrev;
    ambientPrev = null;
    win.setAlwaysOnTop(ambientPin, ambientPin ? 'floating' : 'normal');
    win.setBounds(prev);
    win.setResizable(false);
  }
});

ipcMain.on('w:close', () => app.quit());
ipcMain.on('w:min', () => win && win.minimize());
ipcMain.on('w:fit', (_e, h) => {
  if (!win) return;
  win.setContentSize(WIDTH, Math.max(120, Math.min(900, Math.round(h))));
});
// While a song is playing, stop Windows from putting the PC to sleep (screen may still turn off)
ipcMain.on('w:playing', (_e, on) => {
  if (on && blockerId === null) {
    blockerId = powerSaveBlocker.start('prevent-app-suspension');
  } else if (!on && blockerId !== null) {
    powerSaveBlocker.stop(blockerId);
    blockerId = null;
  }
});
ipcMain.handle('w:getPin', () => (win ? win.isAlwaysOnTop() : false));
ipcMain.handle('w:pin', () => {
  const on = !win.isAlwaysOnTop();
  win.setAlwaysOnTop(on, on ? 'floating' : 'normal');
  saveState();
  return on;
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => { createWindow(); startBuddyServer(); });
  app.on('window-all-closed', () => app.quit());
}
