// Tiny local web server so the ESP32 Desk Buddy can see and control the player.
// It only answers requests that carry the secret key, and only on your home network.
const http = require('http');

const COMMANDS = ['toggle', 'play', 'pause', 'next', 'prev', 'volup', 'voldown'];

function oneLine(s) {
  return String(s || '').replace(/[\r\n]+/g, ' ').trim();
}

function createBuddyServer({ key, getState, onCommand }) {
  return http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url, 'http://buddy.local'); } catch (e) { res.writeHead(400); return res.end('bad'); }

    if (url.searchParams.get('key') !== key) { res.writeHead(403); return res.end('wrong key'); }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');

    if (url.pathname === '/status') {
      // Plain text, one value per line, so the ESP32 can read it without any JSON library:
      // playing(0/1), position(sec), duration(sec), song number, song count, title
      const s = getState();
      res.writeHead(200);
      return res.end([
        s.playing ? 1 : 0,
        Math.max(0, Math.floor(s.pos || 0)),
        Math.max(0, Math.floor(s.dur || 0)),
        s.index || 0,
        s.count || 0,
        oneLine(s.title),
      ].join('\n') + '\n');
    }

    if (url.pathname === '/cmd') {
      const name = url.searchParams.get('name');
      if (!COMMANDS.includes(name)) { res.writeHead(400); return res.end('unknown command'); }
      onCommand(name);
      res.writeHead(200);
      return res.end('ok\n');
    }

    res.writeHead(404);
    res.end('not found');
  });
}

module.exports = { createBuddyServer, COMMANDS };
