// Push-to-talk, end to end in two real browser tabs (Chrome's fake microphone plays a beep):
// tab A = a member's robot in robot mode (RP.RobotHost, simulated garage camera), tab B = the same member's cockpit.
// Checks: the Talk button shows, nothing is sent before Talk, holding Talk sends sound the robot receives, letting go stops it.
// Needs the local App Server (python -I tools/ui_test.py starts it).  node tools/ui/talk_e2e.mjs [http://localhost:PORT] [outdir]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const url = process.argv[2] || 'http://localhost:3587';
const outDir = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'rp-talk-'));
const port = 9800 + Math.floor(Math.random() * 150);
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${path.resolve(outDir, 'profile')}`,
  '--window-size=1280,900', '--no-first-run', '--disable-extensions',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

async function tab(name) {
  let t;
  for (let i = 0; i < 100 && !t; i++) {
    try { t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch (e) { await sleep(200); }
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push(name + ': ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  try { await send('Network.enable'); await send('Network.setBypassServiceWorker', { bypass: true }); } catch (e) {}
  // remember every RTCPeerConnection the page makes, so the test can read its stats
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(function(){var O=window.RTCPeerConnection;window.__pcs=[];window.RTCPeerConnection=function(c){var p=new O(c);window.__pcs.push(p);return p};window.RTCPeerConnection.prototype=O.prototype;window.RTCPeerConnection.generateCertificate=O.generateCertificate;})();` });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(name + ': ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const until = async (expr, what, ms = 40000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { try { if (await ev(expr)) return; } catch (e) {} await sleep(250); }
    throw new Error(name + ': timed out waiting for ' + what);
  };
  const shot = async (file) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(outDir, file), Buffer.from(r.data, 'base64')); };
  return { send, ev, until, shot, go: async (u) => { await send('Page.navigate', { url: u }); await sleep(500); } };
}

const AUDIO_IN = `(async () => { let e = 0, b = 0; for (const pc of window.__pcs) { (await pc.getStats()).forEach(s => {
  if (s.type === 'inbound-rtp' && s.kind === 'audio') { e += s.totalAudioEnergy || 0; b += s.bytesReceived || 0; } }); } return { energy: e, bytes: b }; })()`;
const AUDIO_OUT = `(async () => { let b = 0; for (const pc of window.__pcs) { (await pc.getStats()).forEach(s => {
  if (s.type === 'outbound-rtp' && s.kind === 'audio') b += s.bytesSent || 0; }); } return b; })()`;

let failed = [];
const check = (ok, text) => { console.log((ok ? 'ok   ' : 'BAD  ') + text); if (!ok) failed.push(text); };
try {
  const A = await tab('robot');
  await A.go(url + '/#landing');
  await A.until('window.UI_READY', 'the app');
  const email = 'talk' + Date.now() + '@example.com', pw = 'Rp-' + Math.random().toString(36).slice(2) + '-Kq7';
  await A.ev(`(async () => {
    const $$ = (s) => Array.from(document.querySelectorAll(s)), sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const type = (i, v) => { i.focus(); i.value = v; i.dispatchEvent(new Event('input', {bubbles: true})); i.dispatchEvent(new Event('change', {bubbles: true})); };
    location.hash = '#auth/signup';
    for (let n = 0; n < 100 && $$('.au-card input').length < 3; n++) await sleep(150);
    await sleep(400);
    const inputs = $$('.au-card input[type=text], .au-card input[type=email], .au-card input[type=password]');
    type(inputs[0], 'Talk Tester'); type(inputs[1], ${JSON.stringify(email)}); type(inputs[2], ${JSON.stringify(pw)});
    const tick = document.querySelector('.au-card input[type=checkbox]'); if (tick && !tick.checked) tick.click();
    $$('.au-card .anvil-role-btn-block button').find(b => /Create account/.test(b.textContent)).click();
    return true; })()`);
  await A.until(`location.hash.indexOf('#garage') === 0 && window.UI_READY`, 'signed up');
  const robot = await A.ev(`UI.api('create_robot', 'Talkie', 'browser', 'orange')`);
  const rid = robot.id || (robot.robot && robot.robot.id);
  check(!!rid, 'robot created');
  await A.ev(`(window.UI_READY = false, location.hash = '#bot/' + encodeURIComponent(${JSON.stringify(rid)}), true)`);
  await A.until(`window.UI_READY && Array.from(document.querySelectorAll('button')).some(b => /^\\s*Start/.test(b.textContent) && b.offsetParent)`, 'robot mode page');
  await A.ev(`Array.from(document.querySelectorAll('button')).find(b => /^\\s*Start/.test(b.textContent) && b.offsetParent).click(), true`);
  try { await A.until(`/Pilots can connect|Waiting for pilots/i.test(document.body.innerText)`, 'robot online', 30000); }
  catch (e) { console.log((await A.ev('document.body.innerText')).slice(0, 1500)); throw e; }
  await sleep(2500);  // the manifest reaches the server on the robot's first poll

  const B = await tab('pilot');
  await B.go(url + '/#drive/' + encodeURIComponent(rid));
  await B.until('window.RP_COCKPIT && window.RP_COCKPIT.state().link', 'cockpit connected', 60000);
  await sleep(1500);
  check(await B.ev(`!document.querySelector('[data-talk]').hidden`), 'Talk button shows for the owner');
  check(await B.ev(`!!window.RP_COCKPIT.link().canTalk`), 'link offers a voice line');
  const before = await A.ev(AUDIO_IN), sentBefore = await B.ev(AUDIO_OUT);
  check(sentBefore === 0, 'nothing sent before Talk (' + sentBefore + ' bytes)');
  await B.ev(`window.RP_COCKPIT.talkDown('key'), true`);
  await sleep(3500);
  const during = await A.ev(AUDIO_IN);
  check(await B.ev(`!document.querySelector('[data-onair]').hidden`), 'ON AIR badge while talking');
  await B.shot('talk-desktop.png');
  await B.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await sleep(800);
  check(await B.ev('document.documentElement.scrollWidth <= 391'), 'phone: no sideways scroll with the Talk button');
  await B.shot('talk-phone.png');
  await B.ev(`document.querySelector('[data-talk]').scrollIntoView({block: 'center'}), true`); await sleep(300); await B.shot('talk-phone-deck.png');
  await B.send('Emulation.clearDeviceMetricsOverride');
  check(during.bytes - before.bytes > 2000, 'robot receives the voice (' + (during.bytes - before.bytes) + ' bytes)');
  check(during.energy - before.energy > 0.001, 'with sound in it (energy ' + (during.energy - before.energy).toFixed(4) + ')');
  await B.ev(`window.RP_COCKPIT.talkUp('key'), true`);
  await sleep(1000);
  const quiet0 = await A.ev(AUDIO_IN); await sleep(2500); const quiet1 = await A.ev(AUDIO_IN);
  check(quiet1.energy - quiet0.energy < (during.energy - before.energy) / 20, 'let go = silence (energy ' + (quiet1.energy - quiet0.energy).toFixed(5) + ')');
  check(await B.ev(`document.querySelector('[data-onair]').hidden`), 'ON AIR badge off');
  const log = await A.ev(`document.body.innerText`);
  check(!/Tap the page once/.test(log), 'robot tab plays it without a tap');
  await B.ev(`location.hash = '#garage', true`);
} catch (e) {
  failed.push(e.message); console.log('BAD  ' + e.message);
}
errors.forEach((e) => { console.log('ERR  ' + e); failed.push(e); });
chrome.kill();
console.log(failed.length ? 'TALK TEST FAILED' : 'TALK TEST PASSED');
process.exit(failed.length ? 1 : 0);
