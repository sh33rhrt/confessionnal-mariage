import { CONFIG } from './config.js';
import { db } from './db.js';
import { startCats, stopCats } from './cats.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const stage = $('#stage');

/* ------------------------------------------------------------------ état */
const S = {
  screen: null,
  mode: localStorage.getItem('mode') || 'ouvert',     // ouvert | pause | ferme
  stream: null,
  camId: null, micId: null,
  devices: { cams: [], mics: [] },
  hw: { cam: false, mic: false },
  storage: { free: null, blocked: false, low: false },
  problem: null,                                     // micro | camera | stockage
  audio: { ctx: null, analyser: null, src: null, buf: null, level: 0, voiceAt: 0 },
  rec: null,
  timers: {},
  started: false
};
const GUEST = ['veille', 'accueil', 'consignes', 'decompte', 'rec', 'merci', 'pause', 'ferme'];
const ADMIN = ['code', 'coulisses', 'test', 'export'];

/* ------------------------------------------------------------ utilitaires */
const pad2 = (n) => String(n).padStart(2, '0');
const hhmm = (t) => { const d = new Date(t); return `${pad2(d.getHours())}h${pad2(d.getMinutes())}`; };
const mmss = (s) => `${Math.floor(s / 60)}:${pad2(Math.max(0, Math.floor(s % 60)))}`;
const fmtBytes = (b) => b >= 1e9 ? `${(b / 1e9).toFixed(1).replace('.', ',')} Go` : b < 1e6 ? '< 1 Mo' : `${Math.round(b / 1e6)} Mo`;
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
function clearTimer(k) { clearTimeout(S.timers[k]); clearInterval(S.timers[k]); delete S.timers[k]; }

/* ------------------------------------------------------- mise à l'échelle */
function fit() {
  const s = Math.min(innerWidth / 1180, innerHeight / 820);
  stage.style.transform = `translate(-50%, -50%) scale(${s})`;
}
addEventListener('resize', fit);
addEventListener('orientationchange', () => setTimeout(fit, 300));
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());

/* ---------------------------------------------------------------- journal */
function getLog() { try { return JSON.parse(localStorage.getItem('journal') || '[]'); } catch { return []; } }
function log(text, bad = false) {
  const l = getLog(); l.unshift({ at: Date.now(), text, bad });
  localStorage.setItem('journal', JSON.stringify(l.slice(0, 200)));
  if (S.screen === 'coulisses') renderLog();
}
function renderLog() {
  $('#log').innerHTML = getLog().slice(0, 60).map((e) =>
    `<li class="${e.bad ? 'bad' : ''}"><time>${hhmm(e.at)}</time><span>${e.bad ? `<strong>${esc(e.text)}</strong>` : esc(e.text)}</span></li>`).join('') ||
    '<li><time>—</time><span>Rien pour l\'instant.</span></li>';
}
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* ----------------------------------------------------------- notifications */
let queue = []; try { queue = JSON.parse(localStorage.getItem('notifyQueue') || '[]'); } catch { queue = []; }
function notify(kind, text, cooldownMin = 5) {
  let last = {}; try { last = JSON.parse(localStorage.getItem('notifyLast') || '{}'); } catch {}
  if (cooldownMin && last[kind] && Date.now() - last[kind] < cooldownMin * 60000) return;
  last[kind] = Date.now(); localStorage.setItem('notifyLast', JSON.stringify(last));
  queue.push({ text: `🎥 Confessionnal · ${hhmm(Date.now())}\n${text}` });
  queue = queue.slice(-50);
  localStorage.setItem('notifyQueue', JSON.stringify(queue));
  flush();
}
let flushing = false;
async function flush() {
  if (flushing || !queue.length) return;
  flushing = true;
  try {
    while (queue.length) {
      const res = await fetch(CONFIG.NOTIFY_URL, {
        method: 'POST', cache: 'no-store',
        headers: { 'content-type': 'application/json', 'x-notify-key': CONFIG.NOTIFY_KEY },
        body: JSON.stringify({ text: queue[0].text })
      });
      if (!res.ok) throw new Error(String(res.status));
      queue.shift(); localStorage.setItem('notifyQueue', JSON.stringify(queue));
    }
  } catch { /* hors ligne : on réessaiera */ }
  flushing = false;
  updateDot();
}
addEventListener('online', flush);
setInterval(flush, 30000);

function startHeartbeat() {
  if (!CONFIG.HEALTHCHECK_URL) return;
  const ping = () => fetch(CONFIG.HEALTHCHECK_URL, { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
  ping(); setInterval(ping, CONFIG.HEARTBEAT_SECONDS * 1000);
}
function startReminder() {
  if (!localStorage.getItem('lastReminder')) localStorage.setItem('lastReminder', String(Date.now()));
  setInterval(async () => {
    const last = +localStorage.getItem('lastReminder') || 0;
    if (Date.now() - last < CONFIG.REMINDER_MINUTES * 60000) return;
    localStorage.setItem('lastReminder', String(Date.now()));
    const st = await stats();
    if (st.fresh.length) {
      notify('rappel', `${plural(st.fresh.length, 'vidéo', 'vidéos')} à exporter vers iCloud (${fmtBytes(st.freshBytes)}). Coulisses › Exporter vers iCloud.`, 0);
      log(`Rappel envoyé : ${plural(st.fresh.length, 'vidéo', 'vidéos')} à exporter`);
    }
  }, 60000);
}

/* ------------------------------------------------------------------ audio */
function audioCtx() {
  if (!S.audio.ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    S.audio.ctx = new AC();
  }
  if (S.audio.ctx.state === 'suspended') S.audio.ctx.resume().catch(() => {});
  return S.audio.ctx;
}
function connectAnalyser() {
  const ctx = audioCtx(); if (!ctx || !S.stream || !S.stream.getAudioTracks().length) return;
  try { S.audio.src && S.audio.src.disconnect(); } catch {}
  S.audio.src = ctx.createMediaStreamSource(S.stream);
  S.audio.analyser = ctx.createAnalyser(); S.audio.analyser.fftSize = 1024;
  S.audio.buf = new Float32Array(S.audio.analyser.fftSize);
  S.audio.src.connect(S.audio.analyser);
}
function readLevel() {
  const a = S.audio; if (!a.analyser) return 0;
  if (a.ctx && a.ctx.state !== 'running') a.ctx.resume().catch(() => {});
  a.analyser.getFloatTimeDomainData(a.buf);
  let sum = 0; for (let i = 0; i < a.buf.length; i++) sum += a.buf[i] * a.buf[i];
  const rms = Math.sqrt(sum / a.buf.length);
  const dbfs = 20 * Math.log10(rms || 1e-8);
  const lvl = Math.max(0, Math.min(1, (dbfs + 60) / 50));   // -60 dB → 0, -10 dB → 1
  a.level = a.level * 0.6 + lvl * 0.4;
  if (a.level > 0.3) a.voiceAt = Date.now();
  return a.level;
}
function beep(times = 1, freq = 880) {
  const ctx = audioCtx(); if (!ctx) return;
  for (let i = 0; i < times; i++) {
    const t = ctx.currentTime + i * 0.22;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = freq; o.type = 'sine';
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.18);
  }
}
function renderBars(el, lvl) {
  if (!el.children.length) el.innerHTML = '<span></span>'.repeat(10);
  const n = Math.round(lvl * 10);
  [...el.children].forEach((c, i) => c.classList.toggle('on', i < n));
  el.setAttribute('aria-valuenow', String(n));
}
setInterval(() => {
  const lvl = readLevel();
  if (S.screen === 'consignes') {
    $('#mic-ring').style.strokeDashoffset = String(892 - 892 * lvl);
    $('.cs-ring').setAttribute('aria-valuenow', String(Math.round(lvl * 100)));
    $('#mic-status').classList.toggle('on', Date.now() - S.audio.voiceAt < 2500);
  } else if (S.screen === 'coulisses') renderBars($('#ad-meter'), lvl);
  else if (S.screen === 'test') renderBars($('#ts-meter'), lvl);
  if (S.rec) silenceWatch(lvl);
}, 80);

/* ------------------------------------------------------------------ média */
const savedCam = () => localStorage.getItem('camId');
const savedMic = () => localStorage.getItem('micId');

async function listDevices() {
  const all = await navigator.mediaDevices.enumerateDevices();
  S.devices.cams = all.filter((d) => d.kind === 'videoinput');
  S.devices.mics = all.filter((d) => d.kind === 'audioinput');
  const pickCam = () => {
    const s = S.devices.cams.find((d) => d.deviceId === savedCam()); if (s) return s.deviceId;
    const m = S.devices.cams.find((d) => CONFIG.CAMERA_MATCH.test(d.label)); if (m) return m.deviceId;
    return CONFIG.DEMO && S.devices.cams[0] ? S.devices.cams[0].deviceId : null;
  };
  const pickMic = () => {
    const s = S.devices.mics.find((d) => d.deviceId === savedMic()); if (s) return s.deviceId;
    const m = S.devices.mics.find((d) => CONFIG.MIC_MATCH.test(d.label) && !CONFIG.MIC_EXCLUDE.test(d.label)); if (m) return m.deviceId;
    return CONFIG.DEMO && S.devices.mics[0] ? S.devices.mics[0].deviceId : null;
  };
  return { cam: pickCam(), mic: pickMic() };
}

function streamLive() {
  if (!S.stream) return false;
  return S.stream.getTracks().length === 2 && S.stream.getTracks().every((t) => t.readyState === 'live');
}

async function openStream(force = false) {
  const { cam, mic } = await listDevices();
  const same = S.camId === cam && S.micId === mic && streamLive();
  S.hw.cam = !!cam; S.hw.mic = !!mic;
  if (same && !force) return;
  if (S.rec) return; // jamais pendant une prise
  if (S.stream) S.stream.getTracks().forEach((t) => t.stop());
  S.stream = null; S.camId = cam; S.micId = mic;
  if (!cam || !mic) { attachPreviews(); return; }
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: cam }, width: { ideal: CONFIG.DEMO ? 640 : 1920 }, height: { ideal: CONFIG.DEMO ? 360 : 1080 }, frameRate: { ideal: 30 } },
      audio: { deviceId: { exact: mic }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
    S.stream.getTracks().forEach((t) => t.addEventListener('ended', () => onTrackEnded(t)));
    connectAnalyser();
  } catch (e) {
    log(`Impossible d'ouvrir la caméra ou le micro (${e.name})`, true);
    S.hw.cam = false; S.hw.mic = false;
  }
  attachPreviews();
}
function attachPreviews() {
  $$('video.live').forEach((v) => {
    if (v.srcObject !== S.stream) v.srcObject = S.stream;
    if (S.stream) v.play().catch(() => {});
  });
}
function onTrackEnded(t) {
  if (t.kind === 'audio') S.hw.mic = false; else S.hw.cam = false;
  log(t.kind === 'audio' ? 'Micro débranché' : 'Caméra débranchée', true);
  evaluate();
  scheduleRecheck();
}
let recheckT = null;
function scheduleRecheck() { clearTimeout(recheckT); recheckT = setTimeout(recheck, 900); }
async function recheck() { if (!S.started) return; await openStream(); await checkStorage(); evaluate(); }

async function initMedia() {
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    tmp.getTracks().forEach((t) => t.stop());
  } catch (e) {
    log(`Autorisation caméra/micro refusée (${e.name}). Réglages › Safari › Caméra et Micro : Autoriser.`, true);
  }
  await openStream(true);
  navigator.mediaDevices.addEventListener('devicechange', scheduleRecheck);
  setInterval(recheck, 5000);
}

/* --------------------------------------------------------------- stockage */
async function checkStorage() {
  if (!navigator.storage || !navigator.storage.estimate) return;
  try {
    const { quota = 0, usage = 0 } = await navigator.storage.estimate();
    const free = quota - usage;
    S.storage.free = free;
    S.storage.blocked = free < CONFIG.STORAGE_BLOCK_BYTES;
    const low = free < CONFIG.STORAGE_WARN_BYTES;
    if (low && !S.storage.low) { log(`Stockage presque plein : ${fmtBytes(free)} libres`, true); notify('stockage', `Stockage de l'iPad presque plein : ${fmtBytes(free)} libres. Exportez puis libérez de la place.`, 30); }
    S.storage.low = low;
  } catch {}
}

/* ------------------------------------------------- pannes et redirection */
const PAUSES = {
  micro: { title: 'Petite pause technique', text: 'Le micro ne répond plus. L\'équipe est prévenue, le confessionnal rouvre dans quelques instants.',
    icon: '<svg viewBox="0 0 48 48"><rect x="17" y="5" width="14" height="24" rx="7"></rect><path d="M10 22a14 14 0 0 0 28 0M24 36v7M17 43h14"></path><path class="x" d="M8 6l32 36"></path></svg>',
    alert: 'Micro non détecté : tournage bloqué. Vérifiez le récepteur DJI Mic sur le hub.' },
  camera: { title: 'Petite pause technique', text: 'La caméra ne répond plus. L\'équipe est prévenue, le confessionnal rouvre dans quelques instants.',
    icon: '<svg viewBox="0 0 48 48"><rect x="5" y="14" width="28" height="22" rx="3"></rect><path d="M33 21l10-6v18l-10-6z"></path><path class="x" d="M6 6l36 38"></path></svg>',
    alert: 'Caméra non détectée : tournage bloqué. Vérifiez l\'Osmo Pocket (mode webcam) et le hub.' },
  stockage: { title: 'L\'iPad est plein', text: 'L\'équipe est prévenue : elle libère de la place et le confessionnal rouvre très vite.',
    icon: '<svg viewBox="0 0 48 48"><rect x="7" y="10" width="34" height="28" rx="3"></rect><path d="M7 30h34"></path><path class="x" d="M11 34h26M24 15v9M20 20l4 4 4-4"></path></svg>',
    alert: 'Stockage de l\'iPad plein : tournage bloqué. Exportez vers iCloud puis libérez de la place.' }
};
function currentProblem() {
  if (!S.hw.mic || (S.stream && !S.stream.getAudioTracks().some((t) => t.readyState === 'live'))) return 'micro';
  if (!S.hw.cam || !S.stream) return 'camera';
  if (S.storage.blocked) return 'stockage';
  return null;
}
function evaluate() {
  if (!S.started) return;
  const p = currentProblem();
  if (p !== S.problem) {
    if (p) { log(PAUSES[p].alert, true); notify(`panne-${p}`, PAUSES[p].alert, 3); }
    else if (S.problem) { log('Matériel rétabli, confessionnal rouvert'); notify('retabli', 'Matériel rétabli : le confessionnal tourne de nouveau.', 1); }
    S.problem = p;
  }
  if (p && S.rec) finishRecording('panne');
  if (ADMIN.includes(S.screen)) { updateAdminStatus(); return; }
  if (S.mode !== 'ouvert') return;
  if (p && GUEST.includes(S.screen) && S.screen !== 'pause' && S.screen !== 'merci') show('pause');
  else if (p && S.screen === 'pause') renderPause();
  else if (!p && S.screen === 'pause') show('accueil');
  updateDot();
}
function home() {
  if (S.mode !== 'ouvert') return show('ferme');
  if (currentProblem()) return show('pause');
  show('accueil');
}
function updateDot() {
  const d = $('#status-dot'); if (!d) return;
  const err = !!S.problem, warn = S.storage.low || queue.length > 0;
  d.className = `status-dot${err ? ' err' : warn ? ' warn' : ''}`;
  d.setAttribute('aria-label', err ? 'État : panne' : warn ? 'État : à surveiller' : 'État : tout fonctionne');
}

/* ---------------------------------------------------------------- écrans */
const BG = { ouverture: 'bg-dark', ferme: 'bg-dark', decompte: 'bg-cam', rec: 'bg-cam', coulisses: 'bg-paper', test: 'bg-paper', export: 'bg-paper' };
function show(name) {
  const prev = S.screen;
  if (prev === name && name !== 'pause') return;
  ['idle', 'merci', 'countdown'].forEach(clearTimer);
  if (prev === 'veille') stopCats();
  if (prev === 'test') leaveTest();
  $$('.screen').forEach((s) => s.classList.toggle('on', s.dataset.screen === name));
  document.body.className = BG[name] || '';
  S.screen = name;
  const enter = ENTER[name]; if (enter) enter();
  updateDot();
}
function armIdle() {
  clearTimer('idle');
  S.timers.idle = setTimeout(() => { if (['accueil', 'consignes'].includes(S.screen)) show('veille'); }, CONFIG.IDLE_SECONDS * 1000);
}
stage.addEventListener('pointerdown', () => { if (['accueil', 'consignes'].includes(S.screen)) armIdle(); }, true);

const ENTER = {
  veille() { startCats(); },
  accueil() { armIdle(); },
  consignes() {
    armIdle(); attachPreviews();
    $('#btn-go').disabled = !(S.hw.mic && S.stream);
    $('#mic-status').classList.remove('on');
  },
  decompte() { attachPreviews(); runCountdown(); },
  rec() {},
  merci() {
    let s = CONFIG.MERCI_SECONDS;
    const ring = $('#mc-ring'), out = $('#mc-secs');
    const paint = () => { out.textContent = String(s); ring.style.strokeDashoffset = String(157 - (157 * s) / CONFIG.MERCI_SECONDS); };
    paint();
    S.timers.merci = setInterval(() => { s -= 1; paint(); if (s <= 0) { clearTimer('merci'); home(); } }, 1000);
  },
  pause() { renderPause(); },
  ferme() {
    const fin = S.mode === 'ferme';
    $('#fm-title').textContent = fin ? 'Merci pour vos mots' : 'On revient vite';
    $('#fm-text').innerHTML = fin ? 'Le confessionnal est fermé pour ce soir. Yousra <em>&amp;</em> Dany ont hâte de tout regarder.' : 'Le confessionnal fait une petite pause.';
    $('#fm-small').textContent = fin ? 'Bonne fin de soirée !' : 'Il rouvre très bientôt.';
  },
  code() { codeBuf = ''; paintCode(); },
  coulisses() { renderAdmin(); },
  test() { enterTest(); },
  export() { renderExport(); }
};
function renderPause() {
  const p = PAUSES[S.problem || 'micro'];
  $('#pz-icon').innerHTML = p.icon; $('#pz-title').textContent = p.title; $('#pz-text').textContent = p.text;
}

/* ------------------------------------------------------- compte à rebours */
function runCountdown() {
  let n = CONFIG.COUNTDOWN;
  const el = $('#dc-num');
  const paint = () => { el.textContent = String(n); el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); };
  paint();
  S.timers.countdown = setInterval(async () => {
    n -= 1;
    if (n > 0) return paint();
    clearTimer('countdown');
    if (currentProblem()) return evaluate();
    beep(1, 880);
    try { await startRecording(); show('rec'); }
    catch (e) { log(`Échec du démarrage de l'enregistrement (${e.message || e.name})`, true); notify('rec-fail', 'L\'enregistrement n\'a pas pu démarrer.', 5); home(); }
  }, 1000);
}

/* ---------------------------------------------------------- enregistrement */
function pickMime() {
  const opts = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return opts.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}
function nextIndex() {
  const n = (+localStorage.getItem('videoIndex') || 0) + 1;
  localStorage.setItem('videoIndex', String(n)); return n;
}
function fileName(t, n, ext) {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}h${pad2(d.getMinutes())}_${String(n).padStart(3, '0')}.${ext}`;
}
async function startRecording() {
  if (!S.stream) throw new Error('pas de flux');
  const mime = pickMime();
  const r = new MediaRecorder(S.stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: CONFIG.VIDEO_BITRATE, audioBitsPerSecond: CONFIG.AUDIO_BITRATE });
  const type = r.mimeType || mime || 'video/mp4';
  const ext = /webm/.test(type) ? 'webm' : 'mp4';
  const n = nextIndex(), now = Date.now();
  const v = { id: `${now}-${n}`, n, name: fileName(now, n, ext), mime: type.split(';')[0], startedAt: now, status: 'recording', exported: false, bytes: 0 };
  await db.putVideo(v);
  let seq = 0, pending = Promise.resolve();
  r.ondataavailable = (e) => {
    if (!e.data || !e.data.size) return;
    const s = seq++; v.bytes += e.data.size;
    pending = pending.then(() => e.data.arrayBuffer()).then((buf) => db.putChunk(v.id, s, buf))
      .catch((err) => log(`Erreur d'écriture d'un morceau (${err && err.name})`, true));
  };
  const done = new Promise((resolve) => {
    r.onstop = async () => {
      await pending;
      v.status = 'done'; v.endedAt = Date.now();
      await db.putVideo(v);
      resolve();
    };
  });
  r.start(CONFIG.CHUNK_MS);
  S.rec = { r, v, t0: Date.now(), done, warned: false, silentSince: null, silenceAlerted: false };
  log(`Début : ${v.name}`);
  // interface
  const sec = $('[data-screen="rec"]');
  sec.classList.remove('last');
  $('#rec-timer').textContent = mmss(CONFIG.MAX_SECONDS);
  $('#rec-prog').style.width = '0%';
  const stopBtn = $('#btn-stop');
  stopBtn.setAttribute('aria-disabled', 'true');
  S.timers.enable = setTimeout(() => stopBtn.setAttribute('aria-disabled', 'false'), CONFIG.STOP_ENABLED_AFTER * 1000);
  clearTimer('tick');
  S.timers.tick = setInterval(tick, 250);
}
function tick() {
  if (!S.rec) return clearTimer('tick');
  const el = (Date.now() - S.rec.t0) / 1000;
  const left = CONFIG.MAX_SECONDS - el;
  $('#rec-timer').textContent = mmss(Math.ceil(left));
  $('#rec-prog').style.width = `${Math.min(100, (el / CONFIG.MAX_SECONDS) * 100)}%`;
  if (left <= CONFIG.WARN_SECONDS && !S.rec.warned) { S.rec.warned = true; $('[data-screen="rec"]').classList.add('last'); beep(2, 660); }
  if (left <= 0) finishRecording('auto');
}
function silenceWatch(lvl) {
  const R = S.rec; if (!R) return;
  if (!S.audio.analyser || !S.audio.ctx || S.audio.ctx.state !== 'running') return;
  if (lvl < 0.08) {
    R.silentSince = R.silentSince || Date.now();
    if (!R.silenceAlerted && Date.now() - R.silentSince > CONFIG.SILENCE_SECONDS * 1000) {
      R.silenceAlerted = true;
      log(`Silence de ${CONFIG.SILENCE_SECONDS} s pendant ${R.v.name}`, true);
      notify('silence', `Aucun son depuis ${CONFIG.SILENCE_SECONDS} s en pleine prise. Le récepteur ou l'émetteur du micro est peut-être éteint.`, 10);
    }
  } else R.silentSince = null;
}
async function finishRecording(reason) {
  const R = S.rec; if (!R) return;
  S.rec = null;
  clearTimer('tick'); clearTimer('enable'); resetHold();
  try { if (R.r.state !== 'inactive') { R.r.requestData && R.r.state === 'recording' && R.r.requestData(); R.r.stop(); } } catch {}
  const secs = Math.round((Date.now() - R.t0) / 1000);
  log(`Fin : ${R.v.name} (${mmss(secs)}${reason === 'auto' ? ', arrêt automatique' : reason === 'panne' ? ', panne de matériel' : ''})`, reason === 'panne');
  if (reason !== 'panne') show('merci');
  R.done.then(checkStorage);
}

/* ------------------------------------------------- maintenir pour terminer */
let holdRaf = null, holdT0 = 0;
function resetHold() { cancelAnimationFrame(holdRaf); holdRaf = null; $('#hold-fill').style.width = '0%'; }
const stopBtn = $('#btn-stop');
stopBtn.addEventListener('pointerdown', (e) => {
  if (stopBtn.getAttribute('aria-disabled') === 'true' || !S.rec) return;
  e.preventDefault(); holdT0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - holdT0) / CONFIG.STOP_HOLD_MS);
    $('#hold-fill').style.width = `${p * 100}%`;
    if (p >= 1) { holdRaf = null; finishRecording('stop'); return; }
    holdRaf = requestAnimationFrame(step);
  };
  holdRaf = requestAnimationFrame(step);
});
['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => stopBtn.addEventListener(ev, () => { if (holdRaf) resetHold(); }));
stopBtn.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && stopBtn.getAttribute('aria-disabled') !== 'true') finishRecording('stop'); });

/* ------------------------------------------------------- appui long admin */
$$('[data-longpress="admin"]').forEach((el) => {
  let t = null;
  el.addEventListener('pointerdown', () => { clearTimeout(t); t = setTimeout(() => show('code'), 3000); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => el.addEventListener(ev, () => clearTimeout(t)));
});

/* ------------------------------------------------------------------ code */
let codeBuf = '';
function paintCode() {
  $$('#cd-dots span').forEach((d, i) => d.classList.toggle('on', i < codeBuf.length));
  $('#cd-dots').setAttribute('aria-label', `${codeBuf.length} chiffre${codeBuf.length > 1 ? 's' : ''} sur 4`);
}
$('#cd-pad').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const k = b.dataset.key;
  if (k === 'back') codeBuf = codeBuf.slice(0, -1);
  else if (codeBuf.length < 4) codeBuf += k;
  paintCode();
  if (codeBuf.length === 4) {
    if (codeBuf === String(CONFIG.ADMIN_PIN)) { log('Coulisses ouvertes'); show('coulisses'); }
    else { const d = $('#cd-dots'); d.classList.remove('err'); void d.offsetWidth; d.classList.add('err'); codeBuf = ''; setTimeout(paintCode, 400); }
  }
});

/* -------------------------------------------------------------- coulisses */
async function stats() {
  const all = (await db.allVideos()).filter((v) => v.status === 'done');
  const fresh = all.filter((v) => !v.exported).sort((a, b) => a.n - b.n);
  return { all, fresh, exported: all.length - fresh.length, freshBytes: fresh.reduce((s, v) => s + (v.bytes || 0), 0) };
}
function fillSelect(sel, list, current) {
  sel.innerHTML = list.map((d, i) => `<option value="${esc(d.deviceId)}"${d.deviceId === current ? ' selected' : ''}>${esc(d.label || `Appareil ${i + 1}`)}</option>`).join('') ||
    '<option value="">Aucun appareil</option>';
  if (!current) sel.insertAdjacentHTML('afterbegin', '<option value="" selected>— non détecté —</option>');
}
function updateAdminStatus() {
  if (S.screen !== 'coulisses') return;
  const cam = $('#st-cam'), mic = $('#st-mic');
  cam.className = `st ${S.hw.cam && S.stream ? 'ok' : 'ko'}`; cam.textContent = S.hw.cam && S.stream ? 'OK' : 'Absente';
  mic.className = `st ${S.hw.mic && S.stream ? 'ok' : 'ko'}`; mic.textContent = S.hw.mic && S.stream ? 'OK' : 'Absent';
  fillSelect($('#sel-cam'), S.devices.cams, S.camId);
  fillSelect($('#sel-mic'), S.devices.mics, S.micId);
  $('#st-sto').textContent = S.storage.free == null ? 'inconnu' : `${fmtBytes(S.storage.free)} libres`;
}
async function renderAdmin() {
  $('#ad-clock').textContent = `Le Confessionnal · ${hhmm(Date.now())}`;
  $$('.seg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === S.mode)));
  await checkStorage();
  updateAdminStatus();
  const st = await stats();
  $('#v-new').textContent = String(st.fresh.length);
  $('#v-new-lbl').innerHTML = st.fresh.length > 1 ? 'nouvelles vidéos<br>à exporter' : 'nouvelle vidéo<br>à exporter';
  $('#v-size').textContent = st.fresh.length ? `${fmtBytes(st.freshBytes)} · la plus ancienne date de ${hhmm(st.fresh[0].startedAt)}` : 'Tout est exporté.';
  const lastExp = st.all.filter((v) => v.exportedAt).sort((a, b) => b.exportedAt - a.exportedAt)[0];
  $('#v-done').textContent = st.exported ? `${st.exported}${lastExp ? ` · à ${hhmm(lastExp.exportedAt)}` : ''}` : '0';
  $('#v-total').textContent = plural(st.all.length, 'vidéo', 'vidéos');
  $('[data-action="go-export"]').disabled = !st.fresh.length;
  const next = (+localStorage.getItem('lastReminder') || Date.now()) + CONFIG.REMINDER_MINUTES * 60000;
  $('#al-next').innerHTML = `Rappel d'export toutes les heures. Prochain : <strong>${hhmm(next)}</strong>${queue.length ? `<br>${plural(queue.length, 'alerte', 'alertes')} en attente de réseau.` : ''}`;
  renderLog();
}
$('#sel-cam').addEventListener('change', async (e) => { localStorage.setItem('camId', e.target.value); log('Caméra choisie à la main'); await openStream(true); evaluate(); renderAdmin(); });
$('#sel-mic').addEventListener('change', async (e) => { localStorage.setItem('micId', e.target.value); log('Micro choisi à la main'); await openStream(true); evaluate(); renderAdmin(); });
$$('.seg button').forEach((b) => b.addEventListener('click', () => {
  S.mode = b.dataset.mode; localStorage.setItem('mode', S.mode);
  log(`Confessionnal ${{ ouvert: 'ouvert', pause: 'en pause', ferme: 'fermé' }[S.mode]}`);
  renderAdmin();
}));

/* -------------------------------------------------------------- mode test */
let testRec = null, testUrl = null;
function enterTest() {
  attachPreviews();
  $('#test-live').hidden = false; $('#test-play').hidden = true;
  $('#ts-chip').textContent = 'PRÊT'; $('#btn-test').textContent = 'Lancer un test'; $('#btn-test').disabled = !S.stream;
}
function leaveTest() {
  try { testRec && testRec.state !== 'inactive' && testRec.stop(); } catch {}
  testRec = null;
  const p = $('#test-play'); p.pause(); p.removeAttribute('src'); p.load();
  if (testUrl) { URL.revokeObjectURL(testUrl); testUrl = null; }
}
function runTest() {
  if (!S.stream || testRec) return;
  leaveTest(); enterTest();
  const mime = pickMime(); const parts = [];
  testRec = new MediaRecorder(S.stream, mime ? { mimeType: mime } : {});
  testRec.ondataavailable = (e) => e.data && e.data.size && parts.push(e.data);
  testRec.onstop = () => {
    if (S.screen !== 'test') return;
    testUrl = URL.createObjectURL(new Blob(parts, { type: (testRec && testRec.mimeType) || mime || 'video/mp4' }));
    testRec = null;
    const p = $('#test-play'); p.src = testUrl; p.hidden = false; $('#test-live').hidden = true;
    p.muted = false; p.play().catch(() => {});
    $('#ts-chip').textContent = 'LECTURE DU TEST'; $('#btn-test').textContent = 'Refaire un test'; $('#btn-test').disabled = false;
  };
  testRec.start(500);
  $('#btn-test').disabled = true;
  let left = CONFIG.TEST_SECONDS;
  $('#ts-chip').textContent = `ENREGISTREMENT · ${left}`;
  const iv = setInterval(() => {
    left -= 1;
    if (S.screen !== 'test') return clearInterval(iv);
    if (left > 0) $('#ts-chip').textContent = `ENREGISTREMENT · ${left}`;
    else { clearInterval(iv); try { testRec && testRec.stop(); } catch {} }
  }, 1000);
  log('Mode test lancé');
}

/* ------------------------------------------------------------------ export */
let exportList = [];
async function renderExport() {
  if (S.screen !== 'export') return;
  const st = await stats();
  if (!exportList.length) exportList = st.fresh.map((v) => ({ ...v }));
  const total = exportList.length, done = exportList.filter((v) => v.exported).length;
  $('#ex-count').textContent = `${done} / ${total}`;
  $('#ex-bar').style.width = total ? `${(done / total) * 100}%` : '0%';
  $('#ex-list').innerHTML = exportList.map((v) =>
    `<li><span>${esc(v.name)}</span><span class="size">${fmtBytes(v.bytes || 0)}</span><span class="${v.exported ? 'done' : v.busy ? 'busy' : 'wait'}">${v.exported ? '✓ Exportée' : v.busy ? 'En cours…' : 'En attente'}</span></li>`).join('') ||
    '<li><span>Aucune nouvelle vidéo.</span><span></span><span></span></li>';
  const left = exportList.filter((v) => !v.exported).length;
  const canShare = !!(navigator.canShare && navigator.share);
  $('#btn-share').hidden = !canShare;
  $('#btn-share').disabled = !left;
  $('#btn-dl').disabled = !left;
  $('#btn-dl').textContent = left ? `Télécharger le suivant (${left})` : 'Tout est exporté';
}
async function markExported(vs) {
  for (const v of vs) {
    const stored = await db.getVideo(v.id);
    if (stored) { stored.exported = true; stored.exportedAt = Date.now(); await db.putVideo(stored); }
    v.exported = true; v.busy = false;
  }
  log(`Export iCloud : ${plural(vs.length, 'vidéo', 'vidéos')}`);
}
async function exportShare() {
  const todo = exportList.filter((v) => !v.exported);
  if (!todo.length) return;
  // lot d'environ 600 Mo pour ménager la mémoire de l'iPad
  const batch = []; let size = 0;
  for (const v of todo) { if (batch.length && size + (v.bytes || 0) > 6e8) break; batch.push(v); size += v.bytes || 0; }
  batch.forEach((v) => { v.busy = true; }); renderExport();
  try {
    const files = [];
    for (const v of batch) files.push(new File([await db.videoBlob(v)], v.name, { type: v.mime }));
    if (navigator.canShare && !navigator.canShare({ files })) throw new Error('partage de fichiers indisponible');
    await navigator.share({ files });
    await markExported(batch);
  } catch (e) {
    batch.forEach((v) => { v.busy = false; });
    if (e && e.name !== 'AbortError') log(`Export interrompu (${e.message || e.name}). Essayez « Télécharger le suivant ».`, true);
  }
  renderExport();
}
async function exportDownload() {
  const v = exportList.find((x) => !x.exported); if (!v) return;
  v.busy = true; renderExport();
  const url = URL.createObjectURL(await db.videoBlob(v));
  const a = document.createElement('a'); a.href = url; a.download = v.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  await markExported([v]);
  renderExport();
}

/* ----------------------------------------------------------------- actions */
const ACTIONS = {
  async start() {
    if (S.started) return home();
    audioCtx();
    try { navigator.wakeLock && navigator.wakeLock.request('screen').catch(() => {}); } catch {}
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {}
    await initMedia();
    await checkStorage();
    S.started = true;
    S.problem = currentProblem();
    if (S.problem) { log(PAUSES[S.problem].alert, true); notify(`panne-${S.problem}`, PAUSES[S.problem].alert, 3); }
    log('Confessionnal lancé');
    home();
  },
  wake() { audioCtx(); home(); },
  'go-accueil'() { home(); },
  'go-consignes'() { audioCtx(); if (currentProblem()) return evaluate(); show('consignes'); },
  'go-decompte'() { if (currentProblem()) return evaluate(); show('decompte'); },
  'cancel-countdown'() { show('consignes'); },
  'code-cancel'() { home(); },
  'admin-exit'() { log('Coulisses fermées'); home(); },
  'go-test'() { show('test'); },
  'test-run'() { runTest(); },
  'test-done'() { show('coulisses'); },
  'test-alert'() { notify(`test-${Date.now()}`, 'Alerte test : tout fonctionne.', 0); log('Alerte test envoyée'); setTimeout(renderAdmin, 1500); },
  'go-export'() { exportList = []; show('export'); },
  'export-share'() { exportShare(); },
  'export-download'() { exportDownload(); },
  'export-close'() { show('coulisses'); }
};
stage.addEventListener('click', (e) => {
  const b = e.target.closest('[data-action]'); if (!b || b.disabled) return;
  const fn = ACTIONS[b.dataset.action]; if (fn) fn();
});

/* -------------------------------------------------------------- démarrage */
async function recover() {
  try {
    const vids = await db.allVideos();
    for (const v of vids.filter((x) => x.status === 'recording')) {
      const info = await db.lastChunkAt(v.id);
      if (info.count) {
        Object.assign(v, { status: 'done', recovered: true, bytes: info.bytes, endedAt: info.at });
        log(`Safari a redémarré : ${v.name} récupérée`, true);
        notify('recup', `Safari a redémarré pendant une prise : la vidéo ${v.name} a été récupérée.`, 1);
      } else v.status = 'empty';
      await db.putVideo(v);
    }
  } catch (e) { log(`Lecture du stockage impossible (${e.name})`, true); }
}
function buildTitle() {
  const t = $('.ov-title');
  t.innerHTML = [...'Confessionnal'].map((c, i) => `<span style="animation-delay:${(0.25 + i * 0.07).toFixed(2)}s">${c}</span>`).join('');
  t.setAttribute('aria-hidden', 'true');
}
async function boot() {
  fit(); buildTitle();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  await recover();
  show('ouverture');
  startHeartbeat(); startReminder(); flush();
}
if (CONFIG.DEMO) window.__app = { show, S };
boot();
