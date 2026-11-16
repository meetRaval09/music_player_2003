// Spotify link (Windows only): reads what the Spotify desktop app is playing through Windows'
// own "now playing" info, and sends play / pause / next / previous back to it.
// No Spotify account, no Premium and no developer setup needed.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

function createSpotifyLink(onState) {
  let child = null, rl = null, lastCover = '', coverDataUrl = '';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pixeltunes-sp-'));
  const ps1 = path.join(tmp, 'spotify-helper.ps1');
  const cmdFile = path.join(tmp, 'cmd.txt');

  function start() {
    if (child || process.platform !== 'win32') return;
    fs.writeFileSync(ps1, '﻿' + fs.readFileSync(path.join(__dirname, 'spotify-helper.ps1'), 'utf8'));
    child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-CmdFile', cmdFile, '-CoverDir', tmp], { windowsHide: true });
    rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      let s; try { s = JSON.parse(line.replace(/^\ufeff/, '')); } catch (e) { return; }
      if (s.cover && s.cover !== lastCover) {
        lastCover = s.cover;
        try { coverDataUrl = 'data:image/jpeg;base64,' + fs.readFileSync(s.cover).toString('base64'); } catch (e) { coverDataUrl = ''; }
      }
      if (!s.cover) { lastCover = ''; coverDataUrl = ''; }
      s.cover = coverDataUrl;
      onState(s);
    });
    child.stderr.on('data', () => {});
    child.on('exit', () => { child = null; });
  }
  function stop() { if (child) { try { child.kill(); } catch (e) {} child = null; } }
  function command(name) {
    if (!['toggle', 'next', 'prev', 'play', 'pause'].includes(name)) return;
    try { fs.writeFileSync(cmdFile, name); } catch (e) {}
  }
  return { start, stop, command };
}
module.exports = { createSpotifyLink };
