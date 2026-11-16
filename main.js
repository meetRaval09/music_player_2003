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

// ---- Desk Buddy link (ESP32 gadget on your Wi-Fi) ----
// Change BUDDY_KEY to your own secret word, and use the same word in the ESP32 sketch.
const BUDDY_PORT = 8765;
const BUDDY_KEY = 'buddy2003';
let buddyState = { playing: false, pos: 0, dur: 0, index: 0, count: 0, title: '' };
ipcMain.on('buddy:state', (_e, s) => { buddyState = { ...buddyState, ...s }; });

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

function startBuddyServer() {
  const server = createBuddyServer({
    key: BUDDY_KEY,
    getState: () => buddyState,
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
  if (!win || win.isDestroyed()) return;
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
