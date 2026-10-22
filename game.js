'use strict';

/* =========================================================
   ARENA GERAK — Lampu Hijau, Lampu Merah (berbasis kamera)
   HTML + CSS + JavaScript murni. Tanpa library / backend.

   Daftar isi:
   1. KONFIGURASI  (ubah angka di sini untuk menyetel game)
   2. State & elemen
   3. Inisialisasi & event
   4. Layar, modal, overlay
   5. Kamera (getUserMedia)
   6. Deteksi gerakan (perubahan piksel di Canvas)
   7. Kalibrasi
   8. Logika permainan
   9. Render HUD & arena
   10. Audio (Web Audio API)
   ========================================================= */

/* ---------- 1. KONFIGURASI ---------- */
const CONFIG = {
  // Boneka menghadap arena saat lampu ini menyala.
  // 'red'   = lampu hijau kepala membelakangi pemain, lampu merah menghadap pemain (gaya Squid Game).
  // 'green' = kebalikannya.
  dollFacesArenaOn: 'red',

  // Resolusi kecil untuk membaca piksel (lebih ringan & lebih tahan noise)
  frame: { width: 128, height: 96, intervalMs: 66 },   // ±15 frame/detik

  pixelDiff: 24,            // selisih kecerahan (0-255) agar sebuah piksel dianggap "berubah"
  lightJump: 22,            // lonjakan kecerahan rata-rata mendadak → frame diabaikan
  warmupFrames: 8,          // frame awal kamera diabaikan (auto-exposure)
  blackMean: 2.5,           // rata-rata kecerahan di bawah ini = frame HITAM (kamera belum kirim gambar)
  blackRetryFrames: 45,     // ±3 detik frame hitam berturut-turut → buka ulang kamera otomatis
  blackMaxRetries: 2,       // maksimal buka-ulang otomatis sebelum menampilkan pesan error

  calibrationMs: 3000,      // lama kalibrasi
  calibrationMinSamples: 20,
  calibrationMaxMove: 6,    // % piksel berubah; di atas ini kalibrasi diulang (kamu bergerak)

  thresholdMin: 1.0,        // batas bawah ambang gerak (% piksel berubah)
  thresholdMax: 8.0,        // batas atas ambang dasar

  // Suara boneka lampu hijau (file mp3 "Mugunghwa kkochi pieotseumnida").
  // Taruh file di folder yang sama dengan index.html. Lampu hijau berlangsung selama
  // suara diucapkan; kecepatan suara (tanpa mengubah nada) divariasikan tiap putaran.
  mugunghwa: {
    src: 'mugunghwa.mp3',
    rates: { slow: 0.8, normal: 1.0, fast: 1.45 },   // 1.0 = kecepatan asli file
    volume: 0.4,                                      // 0..1, volume suara boneka (file mp3 aslinya keras)
    tailMs: 150                                       // jeda kecil setelah kalimat selesai
  },

  // Musik latar intens (dibuat langsung oleh browser, tanpa file).
  bgm: {
    volume: 0.65,           // 0..1, volume musik latar
    bpm: 124,               // tempo awal
    bpmHurry: 138,          // tempo saat sisa waktu < 30 detik
    bpmPanic: 152,          // tempo saat sisa waktu < 10 detik
    duckGreen: 0.6,         // volume musik saat suara boneka (lampu hijau) berbunyi → suara tetap jelas
    duckRed: 0.85           // volume musik saat lampu merah
  },

  sfxVolume: 3,             // pengali volume efek suara (scanning, penalti, hitung mundur, dll.)

  warnLeadMs: 700,          // peringatan singkat sebelum lampu hijau → merah
  fieldMeters: 30,          // panjang arena (hanya untuk tampilan jarak)

  difficulty: {
    easy: {
      label: 'MUDAH',
      desc: 'Lampu hijau lama, lampu merah singkat. Toleransi gerakan besar, penalti ringan.',
      time: 120,                         // detik
      greenMin: 3500, greenMax: 6500,   // durasi lampu hijau (ms)
      redMin: 1500,   redMax: 2500,     // durasi lampu merah (ms)
      warnChance: 0.9,                  // peluang ada peringatan sebelum merah
      redTolerance: 1.8,                // pengali ambang gerak saat merah (besar = longgar)
      grace: 900,                       // jeda (ms) setelah merah sebelum gerakan dihukum
      maxRate: 7.0,                     // % progres per detik pada gerakan penuh
      penProgress: 5, penTime: 0,       // penalti: kurangi progres (%) dan waktu (detik)
      cooldown: 1500,                   // jeda antar-penalti (ms)
      scoreMult: 1,
      mugRates: ['slow', 'slow', 'normal', 'normal', 'fast']
    },
    normal: {
      label: 'NORMAL',
      desc: 'Durasi lampu berubah-ubah. Toleransi sedang, penalti mengurangi progres dan waktu.',
      time: 120,
      greenMin: 2500, greenMax: 5000,
      redMin: 2000,   redMax: 3500,
      warnChance: 0.6,
      redTolerance: 1.25,
      grace: 650,
      maxRate: 7.5,
      penProgress: 10, penTime: 3,
      cooldown: 1400,
      scoreMult: 1.5,
      mugRates: ['slow', 'normal', 'normal', 'fast', 'fast']
    },
    hard: {
      label: 'SULIT',
      desc: 'Pergantian lampu cepat dan tak terduga. Toleransi kecil, penalti besar.',
      time: 120,
      greenMin: 1800, greenMax: 4000,
      redMin: 2000,   redMax: 3500,
      warnChance: 0.25,
      redTolerance: 0.9,
      grace: 400,
      maxRate: 8.0,
      penProgress: 18, penTime: 5,
      cooldown: 1200,
      scoreMult: 2,
      mugRates: ['normal', 'fast', 'fast', 'fast']
    }
  }
};

/* ---------- 2. STATE & ELEMEN ---------- */
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rand = (a, b) => a + Math.random() * (b - a);

const els = {};
let pctx = null;               // konteks Canvas (satu-satunya canvas: preview + pembacaan piksel)

const state = {
  screen: 'menu',              // 'menu' | 'game'
  mode: 'idle',                // idle | calibrating | countdown | playing | paused | ended
  difficulty: 'normal',
  intentAutoStart: false,      // setelah kalibrasi, langsung hitung mundur?
  attempts: 0,
  progress: 0,                 // 0..100
  shownProgress: 0,            // progres yang ditampilkan (dihaluskan)
  timeLeft: 0,
  elapsed: 0,
  penalties: 0,
  light: 'idle',               // 'idle' | 'green' | 'red'
  warn: false,
  warnPlanned: false,
  phaseLeft: 0,
  graceLeft: 0,
  penaltyCooldown: 0,
  scanTimer: 0,                // jeda antar-bunyi scanning saat lampu merah
  level: 0,                    // intensitas gerakan saat hijau (0..1)
  won: false,
  score: 0,
  resultTimer: null
};

const cam = { stream: null, active: false, starting: false, calibrated: false, readyUntil: 0, stoppedAt: 0, reopening: false, retries: 0 };

const motion = {
  prev: null, cur: null, hasPrev: false, prevMean: 0,
  ratio: 0,                    // % piksel berubah pada frame terakhir
  smoothed: 0,                 // versi yang dihaluskan (EMA)
  recent: [0, 0, 0],           // 3 frame terakhir → butuh 2 dari 3 di atas ambang
  lastProcess: 0,
  warmup: 0,
  blackFrames: 0,              // jumlah frame hitam berturut-turut
  goodFrames: 0,
  baseThreshold: 2.5,          // hasil kalibrasi (%)
  noise: 0,
  sens: 5                      // 1..10 (slider)
};

const calib = { startAt: 0, samples: [] };
const cd = { idx: 0, timer: 0 };
const CD_SEQ = ['3', '2', '1', 'MULAI!'];
const audio = { ctx: null, out: null, muted: false };

const diff = () => CONFIG.difficulty[state.difficulty];

/* ---------- 3. INISIALISASI & EVENT ---------- */
function init() {
  [
    'video', 'screenMenu', 'screenGame', 'btnStart', 'btnEnableCam', 'btnHowto', 'menuCamStatus', 'diffDesc',
    'btnMenu', 'hudLevel', 'hudTime', 'hudDist', 'hudPen', 'hudAtt', 'progFill',
    'arena', 'doll', 'player', 'banner', 'alertBox', 'overlay', 'ovTitle', 'ovBig', 'ovText', 'ovBarWrap', 'ovBar',
    'preview', 'camChip', 'meterFill', 'sens', 'sensVal', 'calibInfo',
    'btnPlay', 'btnRestart', 'btnRecalib', 'btnCamToggle', 'toast',
    'modalHowto', 'btnHowtoClose',
    'modalError', 'errTitle', 'errMsg', 'errTips', 'btnErrRetry', 'btnErrClose',
    'modalResult', 'resTitle', 'resSub', 'resStats', 'btnResAgain', 'btnResMenu'
  ].forEach((id) => { els[id] = $(id); });

  // Satu canvas saja; willReadFrequently mempercepat getImageData
  pctx = els.preview.getContext('2d', { willReadFrequently: true });
  const n = CONFIG.frame.width * CONFIG.frame.height;
  motion.prev = new Uint8Array(n);
  motion.cur = new Uint8Array(n);
  clearPreview();

  loadSettings();
  loadMugunghwa();

  // Tampilkan pengaturan awal di UI
  document.querySelectorAll('input[name="difficulty"]').forEach((r) => { r.checked = (r.value === state.difficulty); });
  els.sens.value = String(motion.sens);
  els.sensVal.textContent = String(motion.sens);
  updateDiffDesc();
  updateSoundButtons();

  // --- Event menu ---
  els.btnStart.addEventListener('click', () => { unlockAudio(); autoFullscreenOnTouch(); requestStart(true); });
  els.btnEnableCam.addEventListener('click', () => { unlockAudio(); autoFullscreenOnTouch(); requestStart(false); });
  document.querySelectorAll('.js-fs').forEach((b) => b.addEventListener('click', toggleFullscreen));
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  updateFsButtons();
  els.btnHowto.addEventListener('click', () => openModal('modalHowto'));
  document.querySelectorAll('input[name="difficulty"]').forEach((r) => {
    r.addEventListener('change', () => {
      state.difficulty = r.value;
      updateDiffDesc();
      saveSettings();
      if (state.screen === 'game' && state.mode === 'idle') resetRound();
    });
  });

  // --- Event game ---
  els.btnMenu.addEventListener('click', goToMenu);
  els.btnPlay.addEventListener('click', onPlayClick);
  els.btnRestart.addEventListener('click', () => { unlockAudio(); restartRound(); });
  els.btnRecalib.addEventListener('click', () => {
    if (!cam.active) return;
    startCalibration(false);
  });
  els.btnCamToggle.addEventListener('click', async () => {
    unlockAudio();
    if (cam.active) {
      stopCamera();
      abortRound();
    } else {
      requestStart(false);
    }
  });
  els.sens.addEventListener('input', () => {
    motion.sens = Number(els.sens.value);
    els.sensVal.textContent = String(motion.sens);
    saveSettings();
  });
  document.querySelectorAll('.js-sound').forEach((b) => b.addEventListener('click', () => {
    audio.muted = !audio.muted;
    updateSoundButtons();
    saveSettings();
    if (mug.el) mug.el.muted = audio.muted;
    bgmApplyVolume();
    if (!audio.muted) { unlockAudio(); sfx.tick(); }
  }));

  // --- Modal ---
  els.btnHowtoClose.addEventListener('click', () => closeModal('modalHowto'));
  els.btnErrClose.addEventListener('click', () => closeModal('modalError'));
  els.btnErrRetry.addEventListener('click', () => {
    closeModal('modalError');
    requestStart(state.intentAutoStart);
  });
  els.btnResAgain.addEventListener('click', () => { unlockAudio(); restartRound(); });
  els.btnResMenu.addEventListener('click', goToMenu);

  // --- Keyboard & siklus hidup halaman ---
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal('modalHowto');
    if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) toggleFullscreen();
    if ((e.key === 'p' || e.key === 'P') && state.screen === 'game') {
      if (state.mode === 'playing') pauseGame();
      else if (state.mode === 'paused') resumeGame();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.mode === 'playing') pauseGame();   // tab disembunyikan → jeda
    if (!document.hidden && cam.active) {                            // kembali ke tab → pastikan video jalan lagi
      els.video.play().catch(() => {});
      motion.warmup = CONFIG.warmupFrames; motion.hasPrev = false;
    }
  });
  // Beberapa browser HP menjeda video tersembunyi → paksa jalan lagi
  els.video.addEventListener('pause', () => { if (cam.active && !document.hidden) els.video.play().catch(() => {}); });
  window.addEventListener('pagehide', stopCamera);                  // lepas kamera saat halaman ditutup
  window.addEventListener('beforeunload', stopCamera);

  refreshCamUI();
  setLight('idle');
  resetRound();
  requestAnimationFrame(frameLoop);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

function updateDiffDesc() {
  els.diffDesc.textContent = diff().desc;
  els.hudLevel.textContent = diff().label;
}

/* ---------- Pengaturan tersimpan (opsional, aman bila localStorage diblokir) ---------- */
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('arenaGerak.v1') || '{}');
    if (s.sens) motion.sens = clamp(Number(s.sens), 1, 10);
    if (CONFIG.difficulty[s.difficulty]) state.difficulty = s.difficulty;
    if (typeof s.muted === 'boolean') audio.muted = s.muted;
  } catch (e) { /* abaikan */ }
}
function saveSettings() {
  try {
    localStorage.setItem('arenaGerak.v1', JSON.stringify({ sens: motion.sens, difficulty: state.difficulty, muted: audio.muted }));
  } catch (e) { /* abaikan */ }
}

/* ---------- 4. LAYAR, MODAL, OVERLAY ---------- */
function showScreen(name) {
  state.screen = name;
  els.screenMenu.classList.toggle('active', name === 'menu');
  els.screenGame.classList.toggle('active', name === 'game');
  document.body.classList.toggle('in-game', name === 'game');
  window.scrollTo(0, 0);
}

function openModal(id) { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }

function showOverlay(title, big, text, showBar) {
  els.ovTitle.textContent = title;
  els.ovBig.textContent = big;
  els.ovText.textContent = text;
  els.ovBarWrap.style.display = showBar ? '' : 'none';
  els.ovBar.style.width = '0%';
  els.overlay.classList.add('show');
}
function hideOverlay() { els.overlay.classList.remove('show'); }

function setBanner(text) { if (els.banner.textContent !== text) els.banner.textContent = text; }

function updateBanner() {
  let t;
  switch (state.mode) {
    case 'playing':
    case 'paused':
      t = state.light === 'red' ? 'LAMPU MERAH — DIAM!' : (state.warn ? 'HATI-HATI!' : 'LAMPU HIJAU — BERGERAK!');
      break;
    case 'calibrating': t = 'KALIBRASI KAMERA'; break;
    case 'countdown': t = 'BERSIAP…'; break;
    case 'ended': t = state.won ? 'KAMU SAMPAI DI FINIS!' : 'WAKTU HABIS'; break;
    default:
      t = !cam.active ? 'KAMERA BELUM AKTIF'
        : (cam.calibrated ? 'KAMERA SIAP — TEKAN MULAI' : 'KAMERA SIAP — KALIBRASI DULU');
  }
  setBanner(t);
}

function showAlert(text) {
  els.alertBox.textContent = text;
  els.alertBox.classList.remove('show');
  void els.alertBox.offsetWidth;          // restart animasi
  els.alertBox.classList.add('show');
}

function updateSoundButtons() {
  document.querySelectorAll('.js-sound').forEach((b) => {
    b.textContent = audio.muted ? 'SUARA: MATI' : 'SUARA: NYALA';
  });
}

function goToMenu() {
  abortRound();
  stopCamera();
  closeModal('modalResult');
  showScreen('menu');
}

/* ---------- LAYAR PENUH & ORIENTASI ---------- */
const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches;
const portraitMQ = window.matchMedia('(orientation: portrait) and (pointer: coarse)');
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
const canFullscreen = () => {
  const de = document.documentElement;
  return !!(de.requestFullscreen || de.webkitRequestFullscreen);
};
/** HP sedang portrait → game dibekukan & layar "putar HP" tampil (lihat CSS .rotate-notice). */
const isPortraitBlocked = () => state.screen === 'game' && portraitMQ.matches;

let toastTimer = 0;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 4200);
}

async function enterFullscreen() {
  const de = document.documentElement;
  try {
    if (de.requestFullscreen) await de.requestFullscreen({ navigationUI: 'hide' });
    else if (de.webkitRequestFullscreen) de.webkitRequestFullscreen();
    else { toast('iPhone/iPad Safari tidak mendukung layar penuh. Tambahkan halaman ke Layar Utama (Share → Add to Home Screen) untuk tampilan penuh.'); return; }
    lockLandscape();
  } catch (e) { /* ditolak browser → abaikan */ }
}
function exitFullscreen() {
  try {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  } catch (e) { /* abaikan */ }
}
function toggleFullscreen() {
  if (fsElement()) exitFullscreen(); else enterFullscreen();
}
/** Di HP, tombol mulai sekalian masuk layar penuh + kunci landscape (Android Chrome). */
function autoFullscreenOnTouch() {
  if (IS_TOUCH && canFullscreen() && !fsElement()) enterFullscreen();
}
function lockLandscape() {
  try {
    if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
  } catch (e) { /* tidak didukung → andalkan pemberitahuan putar HP */ }
}
function onFullscreenChange() {
  if (!fsElement()) {
    try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) { /* abaikan */ }
  }
  updateFsButtons();
}
function updateFsButtons() {
  const on = !!fsElement();
  document.querySelectorAll('.js-fs').forEach((b) => {
    b.textContent = on ? '✕ KELUAR' : (b.dataset.label || '⛶ LAYAR PENUH');
  });
}

/* ---------- 5. KAMERA ---------- */
function refreshCamUI() {
  els.btnCamToggle.textContent = cam.active ? 'MATIKAN KAMERA' : 'NYALAKAN KAMERA';
  els.btnCamToggle.disabled = cam.starting;
  els.btnRecalib.disabled = !cam.active || state.mode === 'calibrating';
  els.menuCamStatus.textContent = cam.starting
    ? 'Meminta izin kamera… klik "Izinkan" di browser.'
    : cam.active
      ? 'Kamera aktif ✓ — tekan MULAI PERMAINAN.'
      : 'Kamera belum aktif. Izin kamera baru diminta setelah kamu menekan tombol.';
  els.preview.parentElement.style.opacity = cam.active ? '1' : '.6';
  updateControls();
}

function clearPreview() {
  if (!pctx) return;
  pctx.fillStyle = '#05070d';
  pctx.fillRect(0, 0, CONFIG.frame.width, CONFIG.frame.height);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Membuka aliran kamera dan menunggu gambar pertama. Melempar error bila gagal. */
async function openStream() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const e = new Error('getUserMedia tidak tersedia'); e.name = 'NotSupportedError'; throw e;
  }
  // Beri jeda singkat bila kamera baru saja dilepas (HP sering memberi gambar hitam kalau langsung dibuka lagi)
  const wait = 450 - (performance.now() - cam.stoppedAt);
  if (wait > 0) await sleep(wait);

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } },
      audio: false
    });
  } catch (e) {
    if (e && e.name === 'OverconstrainedError') {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });  // coba tanpa syarat
    } else { throw e; }
  }
  cam.stream = stream;
  const track = stream.getVideoTracks()[0];
  track.addEventListener('ended', onTrackEnded);
  // kamera "dibisukan" sistem sesaat (mis. ganti app) → gambar hitam sementara; ulang pemanasan saat pulih
  const resetWarm = () => { motion.warmup = CONFIG.warmupFrames; motion.hasPrev = false; };
  track.addEventListener('mute', resetWarm);
  track.addEventListener('unmute', resetWarm);

  els.video.muted = true;
  els.video.playsInline = true;
  els.video.srcObject = stream;
  try { await els.video.play(); } catch (e) { /* waitForVideo akan mencoba lagi */ }
  await waitForVideo();
}

function resetMotionState() {
  motion.hasPrev = false;
  motion.warmup = CONFIG.warmupFrames;
  motion.ratio = 0; motion.smoothed = 0; motion.recent = [0, 0, 0];
  motion.blackFrames = 0; motion.goodFrames = 0;
}

/** Meminta kamera. Mengembalikan true bila berhasil. */
async function enableCamera() {
  if (cam.active) return true;
  if (cam.starting) return false;
  cam.starting = true;
  refreshCamUI();
  try {
    await openStream();
    cam.active = true;
    cam.calibrated = false;
    cam.retries = 0;
    resetMotionState();
    return true;
  } catch (err) {
    releaseStream();
    showCameraError(err);
    return false;
  } finally {
    cam.starting = false;
    refreshCamUI();
  }
}

/** Kamera terbuka tapi gambar tetap hitam → tutup lalu buka ulang (otomatis, maks. beberapa kali). */
async function recoverBlackCamera() {
  if (cam.reopening || !cam.active) return;
  cam.reopening = true;
  try {
    if (cam.retries >= CONFIG.blackMaxRetries) {
      stopCamera();
      showError('GAMBAR KAMERA HITAM',
        'Kamera terbuka tetapi tidak mengirim gambar (layar preview tetap hitam).',
        ['Pastikan lensa tidak tertutup dan ruangan cukup terang.',
         'Tutup aplikasi/tab lain yang sedang memakai kamera (Zoom, Meet, kamera bawaan, dll.), lalu tekan COBA LAGI.',
         'Bila masih hitam: tutup tab ini sepenuhnya, buka lagi, atau restart browser.']);
      return;
    }
    cam.retries++;
    releaseStream();
    resetMotionState();
    await openStream();
    resetMotionState();
  } catch (err) {
    stopCamera();
    showCameraError(err);
  } finally {
    cam.reopening = false;
  }
}

/** Menunggu sampai video benar-benar mengirim gambar (maks 5 detik). */
function waitForVideo() {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    (function check() {
      if (els.video.paused) els.video.play().catch(() => {});
      if (els.video.videoWidth > 0 && els.video.readyState >= 2) return resolve();
      if (performance.now() - t0 > 5000) {
        const e = new Error('Video tidak mengirim gambar'); e.name = 'VideoTimeout'; return reject(e);
      }
      setTimeout(check, 100);
    })();
  });
}

function releaseStream() {
  if (cam.stream) {
    cam.stream.getTracks().forEach((t) => { t.removeEventListener('ended', onTrackEnded); t.stop(); });
  }
  cam.stream = null;
  els.video.srcObject = null;
  cam.stoppedAt = performance.now();
}

/** Mematikan kamera sepenuhnya. */
function stopCamera() {
  releaseStream();
  cam.active = false;
  cam.calibrated = false;
  motion.hasPrev = false;
  motion.ratio = 0; motion.smoothed = 0; motion.recent = [0, 0, 0];
  motion.blackFrames = 0; motion.goodFrames = 0;
  clearPreview();
  els.calibInfo.textContent = 'Belum dikalibrasi.';
  if (pctx && state.mode !== 'idle' && state.mode !== 'ended') abortRound();
  refreshCamUI();
  updateBanner();
}

function onTrackEnded() {
  stopCamera();
  showError('KAMERA TERPUTUS', 'Aliran kamera berhenti (kamera dicabut atau dipakai aplikasi lain).',
    ['Periksa koneksi kamera, lalu tekan COBA LAGI.', 'Tutup aplikasi lain yang memakai kamera (Zoom, Meet, Teams, dll.).']);
}

function showCameraError(err) {
  const name = (err && err.name) || '';
  const tips = [];
  let title = 'KAMERA BERMASALAH';
  let msg = 'Kamera tidak bisa dibuka.';

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    title = 'IZIN KAMERA DITOLAK';
    msg = 'Browser tidak diizinkan memakai kamera, jadi game belum bisa membaca gerakanmu.';
    tips.push('Klik ikon gembok / kamera di sebelah address bar, ubah Kamera menjadi "Izinkan", lalu tekan COBA LAGI.');
    tips.push('Pastikan izin kamera untuk browser juga aktif di pengaturan sistem (Windows/macOS/Android).');
  } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    title = 'KAMERA TIDAK DITEMUKAN';
    msg = 'Tidak ada kamera yang terdeteksi di perangkat ini.';
    tips.push('Pastikan webcam terpasang dan aktif, lalu tekan COBA LAGI.');
  } else if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    title = 'KAMERA TIDAK BISA DIAKSES';
    msg = 'Kamera mungkin sedang dipakai aplikasi atau tab lain.';
    tips.push('Tutup Zoom, Google Meet, Teams, atau tab lain yang memakai kamera, lalu tekan COBA LAGI.');
  } else if (name === 'NotSupportedError') {
    title = 'KAMERA TIDAK DIDUKUNG';
    msg = 'Browser atau cara membuka halaman ini tidak mendukung akses kamera.';
    tips.push('Buka lewat VS Code Live Server (http://127.0.0.1:5500) atau alamat HTTPS — jangan lewat file:// langsung.');
    tips.push('Gunakan browser terbaru (Chrome, Edge, Firefox, atau Safari).');
  } else if (name === 'VideoTimeout') {
    title = 'KAMERA TIDAK MENGIRIM GAMBAR';
    msg = 'Kamera terbuka tetapi tidak ada gambar yang masuk.';
    tips.push('Coba COBA LAGI, atau cabut-pasang webcam, atau pilih kamera lain di pengaturan browser.');
  } else {
    msg = 'Terjadi kesalahan saat membuka kamera' + (err && err.message ? ': ' + err.message : '.');
  }
  if (!window.isSecureContext) {
    tips.push('Halaman ini tidak berjalan di konteks aman. Gunakan localhost (Live Server) atau HTTPS agar kamera bisa dipakai.');
  }
  showError(title, msg, tips);
}

function showError(title, msg, tips) {
  els.errTitle.textContent = title;
  els.errMsg.textContent = msg;
  els.errTips.innerHTML = '';
  (tips || []).forEach((t) => {
    const li = document.createElement('li');
    li.textContent = t;
    els.errTips.appendChild(li);
  });
  openModal('modalError');
}

/**
 * Pintu masuk utama: tampilkan arena, pastikan kamera aktif, lalu kalibrasi.
 * autoStart = true  → setelah kalibrasi langsung hitung mundur & main.
 * autoStart = false → setelah kalibrasi berhenti di mode uji sensitivitas.
 */
async function requestStart(autoStart) {
  state.intentAutoStart = !!autoStart;
  closeModal('modalResult');
  showScreen('game');
  if (!cam.active) {
    const ok = await enableCamera();
    if (!ok) { updateBanner(); return; }
  }
  if (cam.calibrated) {
    if (autoStart) beginCountdown();
    else abortRound();
  } else {
    startCalibration(autoStart);
  }
}

/* ---------- 6. DETEKSI GERAKAN ---------- */
/**
 * Langkah:
 * 1) Gambar frame video (dicerminkan) ke canvas kecil.
 * 2) Hitung kecerahan (abu-abu) tiap piksel.
 * 3) Bandingkan dengan frame sebelumnya; koreksi perubahan cahaya global.
 * 4) Hitung persentase piksel yang berubah melebihi pixelDiff.
 */
function processFrame() {
  const v = els.video;
  if (!cam.active || v.readyState < 2 || v.videoWidth === 0) return;

  const W = CONFIG.frame.width, H = CONFIG.frame.height, N = W * H;
  // Potong tengah video ke rasio 4:3 (tanpa gepeng), lalu cerminkan supaya terasa natural
  const vw = v.videoWidth, vh = v.videoHeight, target = W / H;
  let sx = 0, sy = 0, sw = vw, sh = vh;
  if (vw / vh > target) { sw = vh * target; sx = (vw - sw) / 2; }
  else { sh = vw / target; sy = (vh - sh) / 2; }
  pctx.save();
  pctx.translate(W, 0);
  pctx.scale(-1, 1);
  pctx.drawImage(v, sx, sy, sw, sh, 0, 0, W, H);
  pctx.restore();

  const img = pctx.getImageData(0, 0, W, H);
  const d = img.data;
  const cur = motion.cur, prev = motion.prev;

  let sum = 0;
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    const g = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;   // abu-abu cepat
    cur[p] = g;
    sum += g;
  }
  const mean = sum / N;

  // Frame hitam (kamera belum/tidak kirim gambar): jangan dihitung sebagai data, ulangi pemanasan
  if (mean < CONFIG.blackMean) {
    motion.blackFrames++;
    motion.goodFrames = 0;
    motion.hasPrev = false;
    motion.warmup = CONFIG.warmupFrames;
    motion.ratio = 0; motion.smoothed = 0; motion.recent = [0, 0, 0];
    if (motion.blackFrames === CONFIG.blackRetryFrames) recoverBlackCamera();
    return;
  }
  motion.blackFrames = 0;
  if (++motion.goodFrames > 20) cam.retries = 0;      // kamera sehat → reset hitungan percobaan ulang

  if (motion.hasPrev) {
    const dMean = mean - motion.prevMean;       // perubahan cahaya global
    let ratio = motion.ratio;
    if (Math.abs(dMean) <= CONFIG.lightJump) {
      let changed = 0;
      for (let p = 0, i = 0; p < N; p++, i += 4) {
        let df = cur[p] - prev[p] - dMean;      // dikurangi perubahan cahaya global
        if (df < 0) df = -df;
        if (df > CONFIG.pixelDiff) {
          changed++;
          d[i] = 255; d[i + 1] = 45; d[i + 2] = 85;   // tandai piksel bergerak di preview
        }
      }
      ratio = (changed / N) * 100;
      pctx.putImageData(img, 0, 0);
    } else {
      ratio = 0;                                // lonjakan cahaya (flash/auto-exposure) → abaikan
    }
    if (motion.warmup > 0) { motion.warmup--; ratio = 0; }
    registerRatio(ratio);
  }

  // tukar buffer: frame sekarang menjadi "sebelumnya"
  motion.prev = cur;
  motion.cur = prev;
  motion.prevMean = mean;
  motion.hasPrev = true;
}

function registerRatio(r) {
  motion.ratio = r;
  motion.smoothed += (r - motion.smoothed) * 0.45;       // smoothing (EMA)
  motion.recent.push(r);
  if (motion.recent.length > 3) motion.recent.shift();

  // Kumpulkan sampel noise saat kalibrasi
  if (state.mode === 'calibrating' && motion.warmup <= 0) {
    if (r > CONFIG.calibrationMaxMove) {                 // pemain bergerak → ulangi hitungan
      calib.startAt = performance.now();
      calib.samples.length = 0;
      els.ovText.textContent = 'Gerakan terdeteksi! Berdiri diam sebentar…';
    } else {
      calib.samples.push(r);
      els.ovText.textContent = 'Berdirilah normal di depan kamera dan DIAM selama 3 detik.';
    }
  }
}

/** Sensitivitas slider 1..10: makin tinggi → ambang makin kecil → makin peka. */
const sensMult = () => Math.pow(1.25, 5 - motion.sens);
const greenThreshold = () => clamp(motion.baseThreshold * sensMult(), 0.3, 40);
const redThreshold = () => greenThreshold() * diff().redTolerance;
const currentThreshold = () => (state.mode === 'playing' && state.light === 'red') ? redThreshold() : greenThreshold();

/** Dianggap bergerak bila minimal 2 dari 3 frame terakhir melewati ambang (anti noise). */
function isMovingAt(thr) {
  let c = 0;
  for (const v of motion.recent) if (v > thr) c++;
  return c >= 2;
}

/* ---------- 7. KALIBRASI ---------- */
function startCalibration(autoStart) {
  state.intentAutoStart = !!autoStart;
  clearTimeout(state.resultTimer);
  closeModal('modalResult');
  resetRound();
  setMode('calibrating');
  setLight('idle');
  calib.startAt = performance.now();
  calib.samples.length = 0;
  showOverlay('KALIBRASI KAMERA', '', 'Berdirilah normal di depan kamera dan DIAM selama 3 detik.', true);
}

function updateCalibration(now) {
  if (motion.warmup > 0) { calib.startAt = now; return; }          // tunggu kamera stabil
  const t = now - calib.startAt;
  els.ovBar.style.width = (clamp(t / CONFIG.calibrationMs, 0, 1) * 100).toFixed(0) + '%';
  if (t >= CONFIG.calibrationMs && calib.samples.length >= CONFIG.calibrationMinSamples) finishCalibration();
}

function finishCalibration() {
  const s = calib.samples.slice().sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const p95 = s[Math.floor(0.95 * (s.length - 1))];
  motion.noise = mean;
  // Ambang dasar = noise tertinggi (persentil 95) × 1,6 + sedikit margin
  motion.baseThreshold = clamp(p95 * 1.6 + 0.6, CONFIG.thresholdMin, CONFIG.thresholdMax);
  cam.calibrated = true;
  cam.readyUntil = performance.now() + 2000;
  els.calibInfo.textContent = 'Noise kamera ≈ ' + mean.toFixed(2) + '% • ambang gerak ≈ ' + greenThreshold().toFixed(2) + '%';
  hideOverlay();
  if (state.intentAutoStart) {
    beginCountdown();
  } else {
    setMode('idle');
    setLight('idle');
  }
}

/* ---------- 8. LOGIKA PERMAINAN ---------- */
function setMode(m) {
  state.mode = m;
  updateControls();
  updateBanner();
  els.btnRecalib.disabled = !cam.active || m === 'calibrating';
}

function updateControls() {
  const m = state.mode;
  els.btnPlay.disabled = (m === 'calibrating' || m === 'countdown' || cam.starting);
  els.btnPlay.textContent = m === 'playing' ? '⏸ JEDA' : m === 'paused' ? '▶ LANJUT' : m === 'ended' ? '↻ MAIN LAGI' : '▶ MULAI';
  els.btnRestart.disabled = (m === 'calibrating' || cam.starting);
}

function onPlayClick() {
  unlockAudio();
  switch (state.mode) {
    case 'playing': pauseGame(); break;
    case 'paused': resumeGame(); break;
    case 'idle':
    case 'ended': requestStart(true); break;
    default: break;
  }
}

function resetRound() {
  state.progress = 0;
  state.shownProgress = 0;
  state.timeLeft = diff().time;
  state.elapsed = 0;
  state.penalties = 0;
  state.level = 0;
  state.warn = false;
  state.warnPlanned = false;
  state.phaseLeft = 0;
  state.graceLeft = 0;
  state.penaltyCooldown = 0;
}

/** Menghentikan ronde apa pun dan kembali ke mode siap (idle). */
function abortRound() {
  stopMug();
  bgmStop();
  clearTimeout(state.resultTimer);
  closeModal('modalResult');
  hideOverlay();
  resetRound();
  setMode('idle');
  setLight('idle');
}

function restartRound() {
  clearTimeout(state.resultTimer);
  closeModal('modalResult');
  if (!cam.active) { requestStart(true); return; }
  if (cam.calibrated) { beginCountdown(); } else { startCalibration(true); }
}

function beginCountdown() {
  clearTimeout(state.resultTimer);
  resetRound();
  state.attempts++;
  setLight('idle');
  setMode('countdown');
  stepCountdown(0);
}

function stepCountdown(i) {
  cd.idx = i;
  cd.timer = 0;
  showOverlay('BERSIAP!', CD_SEQ[i], i < 3 ? 'Lampu hijau: bergerak. Lampu merah: DIAM!' : '', false);
  if (i < 3) sfx.tick(); else sfx.go();
}

function updateCountdown(dt) {
  cd.timer += dt;
  const dur = cd.idx < 3 ? 900 : 650;
  if (cd.timer >= dur) {
    if (cd.idx < 3) stepCountdown(cd.idx + 1);
    else startPlaying();
  }
}

function startPlaying() {
  hideOverlay();
  setMode('playing');
  setLight('green');
  state.phaseLeft = greenPhaseMs(true);                             // hijau pertama (suara boneka / acak)
  state.warnPlanned = Math.random() < diff().warnChance;
  state.penaltyCooldown = 0;
  state.graceLeft = 0;
  bgmStart();
}

function pauseGame() {
  if (state.mode !== 'playing') return;
  setMode('paused');
  if (mug.el && !mug.el.paused) mug.el.pause();
  bgmStop();
  showOverlay('JEDA', '', 'Permainan dijeda. Tekan LANJUT (atau tombol P) untuk meneruskan.', false);
}

function resumeGame() {
  if (state.mode !== 'paused') return;
  hideOverlay();
  setMode('playing');
  if (state.light === 'green' && mug.ok && mug.el) mug.el.play().catch(() => {});
  bgmStart();
  state.penaltyCooldown = Math.max(state.penaltyCooldown, 800);          // beri waktu bersiap
  if (state.light === 'red') state.graceLeft = Math.max(state.graceLeft, 500);
}

/** Mengatur lampu + tampilan arena + arah hadap boneka. */
function setLight(l) {
  if (l !== 'green') stopMug();
  bgmSetDuck(l === 'green' && mug.ok ? CONFIG.bgm.duckGreen : CONFIG.bgm.duckRed);
  state.light = l;
  state.warn = false;
  const a = els.arena;
  a.classList.remove('is-green', 'is-red', 'is-warn', 'is-idle');
  a.classList.add('is-' + l);
  const facing = (l === 'idle') ? true : (l === CONFIG.dollFacesArenaOn);
  els.doll.classList.toggle('facing', facing);
  updateBanner();
}

function switchLight(next) {
  const df = diff();
  setLight(next);
  if (next === 'red') {
    state.phaseLeft = rand(df.redMin, df.redMax);
    state.graceLeft = df.grace;           // waktu pemain untuk berhenti
    state.scanTimer = 0;                  // langsung bunyi scanning
  } else {
    state.phaseLeft = greenPhaseMs(false);
    state.warnPlanned = Math.random() < df.warnChance;   // tidak selalu ada peringatan
    if (!mug.ok) sfx.green();             // tanpa mp3 → pakai bunyi sintetis
  }
}

function applyWarn() {
  state.warn = true;
  els.arena.classList.add('is-warn');
  updateBanner();
  sfx.warn();
}

function updatePlaying(dt) {
  const df = diff();
  state.elapsed += dt;
  state.timeLeft -= dt / 1000;
  if (state.penaltyCooldown > 0) state.penaltyCooldown -= dt;

  // --- siklus lampu ---
  state.phaseLeft -= dt;
  if (state.light === 'green') {
    if (state.warnPlanned && !state.warn && state.phaseLeft <= CONFIG.warnLeadMs) applyWarn();
    if (state.phaseLeft <= 0) switchLight('red');
  } else {
    if (state.graceLeft > 0) state.graceLeft -= dt;
    if (state.phaseLeft <= 0) switchLight('green');
  }

  // --- gerakan pemain ---
  if (state.light === 'green') {
    const thr = greenThreshold();
    if (isMovingAt(thr)) {
      // Makin besar gerakan dibanding ambang → makin cepat maju (0.45 .. 1)
      const rel = motion.smoothed / thr;
      state.level = clamp(0.45 + (rel - 1) * 0.3, 0.45, 1);
      state.progress += df.maxRate * state.level * (dt / 1000);
    } else {
      state.level = 0;
    }
  } else {
    state.level = 0;
    state.scanTimer -= dt;
    if (state.scanTimer <= 0) { sfx.scan(); state.scanTimer = 520; }   // sfx scanning selama lampu merah
    if (state.graceLeft <= 0 && state.penaltyCooldown <= 0 && isMovingAt(redThreshold())) applyPenalty();
  }

  // --- menang / kalah ---
  if (state.progress >= 100) { state.progress = 100; endGame(true); }
  else if (state.timeLeft <= 0) { state.timeLeft = 0; endGame(false); }
}

function applyPenalty() {
  const df = diff();
  state.penalties++;
  state.progress = Math.max(0, state.progress - df.penProgress);
  state.timeLeft -= df.penTime;
  state.penaltyCooldown = df.cooldown;
  showAlert('GERAKAN TERDETEKSI!');
  sfx.penalty();

  const a = els.arena;
  a.classList.remove('hit'); void a.offsetWidth; a.classList.add('hit');
  setTimeout(() => a.classList.remove('hit'), 650);
  els.player.classList.add('caught');
  setTimeout(() => els.player.classList.remove('caught'), 650);
}

function endGame(won) {
  state.won = won;
  state.level = 0;
  const df = diff();
  let score;
  if (won) score = Math.round((1000 + Math.max(0, state.timeLeft) * 25 - state.penalties * 80) * df.scoreMult);
  else score = Math.round(state.progress * 8 * df.scoreMult - state.penalties * 20);
  state.score = Math.max(0, score);

  setMode('ended');
  bgmStop();
  setLight('idle');
  if (won) sfx.win(); else sfx.lose();
  clearTimeout(state.resultTimer);
  state.resultTimer = setTimeout(showResult, 900);
}

function showResult() {
  const df = diff();
  const stat = (label, value, big) => {
    const div = document.createElement('div');
    div.className = 'stat' + (big ? ' big' : '');
    const s = document.createElement('small'); s.textContent = label;
    const b = document.createElement('b'); b.textContent = value;
    div.appendChild(s); div.appendChild(b);
    return div;
  };
  els.resStats.innerHTML = '';

  if (state.won) {
    els.resTitle.textContent = 'KAMU BERHASIL!';
    els.resSub.textContent = 'Kamu mencapai garis finis sebelum waktu habis. Tingkat: ' + df.label + '.';
    els.resStats.appendChild(stat('WAKTU PENYELESAIAN', (state.elapsed / 1000).toFixed(1) + ' dtk'));
    els.resStats.appendChild(stat('PENALTI', String(state.penalties)));
    els.resStats.appendChild(stat('SKOR AKHIR', String(state.score), true));
    els.btnResAgain.textContent = 'MAIN LAGI';
  } else {
    els.resTitle.textContent = 'WAKTU HABIS!';
    els.resSub.textContent = 'Kamu belum sampai di finis. Tingkat: ' + df.label + '.';
    els.resStats.appendChild(stat('PROGRES', Math.round(state.progress) + '%'));
    els.resStats.appendChild(stat('PENALTI', String(state.penalties)));
    els.resStats.appendChild(stat('SKOR', String(state.score), true));
    els.btnResAgain.textContent = 'COBA LAGI';
  }
  openModal('modalResult');
}

/* ---------- 9. LOOP UTAMA & RENDER ---------- */
let lastTs = 0;
function frameLoop(ts) {
  if (!lastTs) lastTs = ts;
  const dt = Math.min(ts - lastTs, 100);     // batasi agar tidak loncat saat tab lambat
  lastTs = ts;

  if (isPortraitBlocked()) {
    // HP portrait: jeda & bekukan (layar "putar HP" ditampilkan oleh CSS)
    if (state.mode === 'playing') pauseGame();
    if (state.mode === 'calibrating') { calib.startAt = performance.now(); calib.samples.length = 0; }
  } else if (state.screen === 'game') {
    if (cam.active && ts - motion.lastProcess >= CONFIG.frame.intervalMs) {
      motion.lastProcess = ts;
      processFrame();
    }
    if (state.mode === 'calibrating') updateCalibration(performance.now());
    else if (state.mode === 'countdown') updateCountdown(dt);
    else if (state.mode === 'playing') updatePlaying(dt);
    renderUI();
  }
  requestAnimationFrame(frameLoop);
}

function setText(el, txt) { if (el.textContent !== txt) el.textContent = txt; }

function computeChip() {
  if (cam.starting) return ['MEMINTA IZIN KAMERA…', 'wait'];
  if (!cam.active) return ['KAMERA BELUM AKTIF', 'off'];
  if (cam.reopening) return ['MEMBUKA ULANG KAMERA…', 'wait'];
  if (motion.blackFrames > 8) return ['MENUNGGU GAMBAR KAMERA…', 'wait'];
  if (state.mode === 'calibrating') {
    return motion.ratio > CONFIG.calibrationMaxMove ? ['GERAKAN TERDETEKSI', 'move'] : ['KALIBRASI…', 'wait'];
  }
  if (!cam.calibrated) return ['KAMERA SIAP', 'ready'];
  if (performance.now() < cam.readyUntil) return ['KAMERA SIAP', 'ready'];
  return isMovingAt(currentThreshold()) ? ['GERAKAN TERDETEKSI', 'move'] : ['DIAM', 'still'];
}

function renderUI() {
  const df = diff();

  // HUD
  const showFull = state.mode === 'idle' || state.mode === 'calibrating' || state.mode === 'countdown';
  const t = showFull ? df.time : Math.max(0, state.timeLeft);
  setText(els.hudTime, t.toFixed(1));
  els.hudTime.classList.toggle('danger', state.mode === 'playing' && state.timeLeft < 10);
  setText(els.hudDist, ((100 - state.progress) / 100 * CONFIG.fieldMeters).toFixed(1) + ' m');
  setText(els.hudPen, String(state.penalties));
  setText(els.hudAtt, String(state.attempts));

  // Progres (dihaluskan) → bar + posisi pemain dengan efek perspektif
  state.shownProgress += (state.progress - state.shownProgress) * 0.25;
  const p = clamp(state.shownProgress, 0, 100);
  els.progFill.style.width = p.toFixed(1) + '%';
  const feetY = 88 - 0.52 * p;              // 88% (start) → 36% (finis)
  const scale = 1 - 0.45 * p / 100;         // makin jauh makin kecil
  els.player.style.top = feetY.toFixed(2) + '%';
  els.player.style.transform = 'translate(-50%, -100%) scale(' + scale.toFixed(3) + ')';
  els.player.classList.toggle('running', state.mode === 'playing' && state.light === 'green' && state.level > 0);

  // Kamera: chip + meter
  const chip = computeChip();
  setText(els.camChip, chip[0]);
  const cls = 'chip ' + chip[1];
  if (els.camChip.className !== cls) els.camChip.className = cls;

  let pct = 0;
  if (cam.active) pct = clamp(motion.smoothed / (currentThreshold() * 2) * 100, 0, 100);
  els.meterFill.style.width = pct.toFixed(0) + '%';
  els.meterFill.classList.toggle('over', pct >= 50);
}

/* ---------- SUARA BONEKA (mp3 "Mugunghwa kkochi pieotseumnida") ---------- */
const mug = { el: null, ok: false, dur: 0, rate: 1 };

function loadMugunghwa() {
  try {
    const a = new Audio(CONFIG.mugunghwa.src);
    a.preload = 'auto';
    a.addEventListener('loadedmetadata', () => {
      if (isFinite(a.duration) && a.duration > 0) { mug.dur = a.duration; mug.ok = true; }
    });
    a.addEventListener('error', () => { mug.ok = false; });
    mug.el = a;
    a.load();
  } catch (e) { mug.ok = false; }
}

function pickMugRate() {
  const names = diff().mugRates;
  const n = names[Math.floor(Math.random() * names.length)];
  return CONFIG.mugunghwa.rates[n] || 1;
}

function playMug(rate) {
  const a = mug.el;
  if (!a) return;
  a.preservesPitch = true; a.webkitPreservesPitch = true; a.mozPreservesPitch = true;   // cepat/lambat tanpa mengubah nada
  a.muted = audio.muted;
  a.volume = clamp(CONFIG.mugunghwa.volume, 0, 1);
  a.currentTime = 0;
  a.playbackRate = rate;
  a.play().catch(() => {});
}

function stopMug() {
  if (mug.el && (!mug.el.paused || mug.el.currentTime > 0)) { mug.el.pause(); mug.el.currentTime = 0; }
}

/** Durasi lampu hijau (ms). Ada mp3 → sepanjang kalimat pada kecepatan yang dipilih; tidak ada → acak seperti semula. */
function greenPhaseMs(first) {
  if (mug.ok) {
    mug.rate = pickMugRate();
    playMug(mug.rate);
    return (mug.dur / mug.rate) * 1000 + CONFIG.mugunghwa.tailMs;
  }
  const df = diff();
  return rand(df.greenMin, df.greenMax) + (first ? 800 : 0);
}

/* ---------- MUSIK LATAR INTENS (sintesis Web Audio, tanpa file) ---------- */
/* Loop 4 birama (Am – F – G – E): kick 4-on-the-floor, bass saw, arpeggio square, hi-hat & clap.
   Tempo naik saat waktu hampir habis. */
const bgm = { master: null, timer: 0, step: 0, nextTime: 0, running: false, duck: 1, noise: null };
const BGM_CHORDS = [
  { r: 110.00, iv: [0, 3, 7, 12] },    // Am
  { r: 87.31,  iv: [0, 4, 7, 12] },    // F
  { r: 98.00,  iv: [0, 4, 7, 12] },    // G
  { r: 82.41,  iv: [0, 4, 7, 12] }     // E
];
const BGM_BASS = [1,0,1,1, 0,1,1,0, 1,0,1,1, 0,1,1,1];
const BGM_ARP  = [0,1,2,3, 2,1,2,3];

function bgmTarget() { return audio.muted ? 0 : CONFIG.bgm.volume * bgm.duck; }

function bgmApplyVolume() {
  if (!bgm.master || !audio.ctx) return;
  const t = audio.ctx.currentTime;
  bgm.master.gain.cancelScheduledValues(t);
  bgm.master.gain.setTargetAtTime(bgmTarget(), t, 0.08);
}
function bgmSetDuck(v) { bgm.duck = v; bgmApplyVolume(); }

function bgmNoiseBuffer(ctx) {
  if (bgm.noise) return bgm.noise;
  const len = Math.floor(ctx.sampleRate * 0.25);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  bgm.noise = buf;
  return buf;
}

function bgmVoice(type, freq, t, dur, vol, opts) {
  const ctx = audio.ctx;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (opts && opts.slideTo) o.frequency.exponentialRampToValueAtTime(opts.slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = o;
  if (opts && opts.lp) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(opts.lp, t);
    if (opts.lpTo) f.frequency.exponentialRampToValueAtTime(opts.lpTo, t + dur);
    o.connect(f); node = f;
  }
  node.connect(g); g.connect(bgm.master);
  o.start(t); o.stop(t + dur + 0.05);
}

function bgmNoise(t, dur, vol, hp) {
  const ctx = audio.ctx;
  const src = ctx.createBufferSource();
  src.buffer = bgmNoiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = 'highpass'; f.frequency.value = hp;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(bgm.master);
  src.start(t); src.stop(t + dur + 0.02);
}

function bgmBpm() {
  const tl = state.timeLeft;
  if (tl < 10) return CONFIG.bgm.bpmPanic;
  if (tl < 30) return CONFIG.bgm.bpmHurry;
  return CONFIG.bgm.bpm;
}

function bgmScheduleStep(t, step, stepDur) {
  const bar = Math.floor(step / 16) % 4, s = step % 16;
  const ch = BGM_CHORDS[bar];
  const hurry = state.timeLeft < 30 ? 1.25 : 1;
  if (s % 4 === 0) bgmVoice('sine', 150, t, 0.16, 0.9, { slideTo: 42 });              // kick
  if (s === 4 || s === 12) bgmNoise(t, 0.12, 0.35, 1500);                              // clap
  if (s % 2 === 1) bgmNoise(t, 0.035, 0.12 * hurry, 7000);                             // hi-hat
  if (BGM_BASS[s]) bgmVoice('sawtooth', ch.r, t, stepDur * 1.8, 0.32, { lp: 700, lpTo: 160 });   // bass
  const semi = ch.iv[BGM_ARP[s % 8] % ch.iv.length];
  const accent = (s % 4 === 0) ? 1 : 0.7;
  bgmVoice('square', ch.r * 4 * Math.pow(2, semi / 12), t, stepDur * 0.8, 0.07 * accent * hurry, { lp: 2400, lpTo: 900 });  // arpeggio
  if (s === 0 && bar === 3) bgmVoice('sawtooth', ch.r * 8, t, stepDur * 16, 0.04, { lp: 500, lpTo: 3000 });             // riser di akhir loop
}

function bgmTick() {
  const ctx = audio.ctx;
  if (!ctx || !bgm.running) return;
  if (bgm.nextTime < ctx.currentTime - 0.3) bgm.nextTime = ctx.currentTime + 0.05;   // tab sempat lambat → kejar
  while (bgm.nextTime < ctx.currentTime + 0.2) {
    const stepDur = 60 / bgmBpm() / 4;
    bgmScheduleStep(bgm.nextTime, bgm.step, stepDur);
    bgm.nextTime += stepDur;
    bgm.step++;
  }
}

function bgmStart() {
  if (bgm.running) return;
  const ctx = unlockAudio();
  if (!ctx) return;
  bgm.master = ctx.createGain();
  bgm.master.gain.value = 0;
  bgm.master.connect(audio.out || ctx.destination);
  bgm.step = 0;
  bgm.nextTime = ctx.currentTime + 0.05;
  bgm.running = true;
  bgmApplyVolume();
  bgmTick();
  bgm.timer = setInterval(bgmTick, 50);
}

function bgmStop() {
  if (!bgm.running) return;
  bgm.running = false;
  clearInterval(bgm.timer);
  const m = bgm.master, ctx = audio.ctx;
  bgm.master = null;
  if (m && ctx) {
    m.gain.cancelScheduledValues(ctx.currentTime);
    m.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    setTimeout(() => { try { m.disconnect(); } catch (e) { /* abaikan */ } }, 600);
  }
}

/* ---------- 10. AUDIO (Web Audio API, tanpa file eksternal) ---------- */
function unlockAudio() {
  if (!audio.ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audio.ctx = new AC();
    // Satu jalur keluaran + compressor, supaya musik, efek, dan suara tidak saling menutupi / pecah
    audio.out = audio.ctx.createDynamicsCompressor();
    audio.out.threshold.value = -14; audio.out.knee.value = 12; audio.out.ratio.value = 6;
    audio.out.attack.value = 0.003; audio.out.release.value = 0.2;
    audio.out.connect(audio.ctx.destination);
  }
  if (audio.ctx.state === 'suspended') audio.ctx.resume();
  return audio.ctx;
}

function tone(freq, dur, type, vol, delay, slideTo) {
  if (audio.muted) return;
  const ctx = unlockAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime + (delay || 0);
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.min(0.9, (vol || 0.12) * CONFIG.sfxVolume), t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(audio.out || ctx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

const sfx = {
  tick()    { tone(660, 0.12, 'square', 0.07); },
  go()      { tone(880, 0.12, 'square', 0.09); tone(1320, 0.25, 'square', 0.09, 0.12); },
  green()   { tone(520, 0.12, 'triangle', 0.14); tone(780, 0.18, 'triangle', 0.14, 0.1); },
  scan()    { tone(380, 0.38, 'triangle', 0.09, 0, 1500); tone(1500, 0.06, 'square', 0.04, 0.4); },
  warn()    { tone(900, 0.06, 'square', 0.06); tone(900, 0.06, 'square', 0.06, 0.12); },
  penalty() { tone(180, 0.18, 'sawtooth', 0.16); tone(140, 0.3, 'sawtooth', 0.16, 0.2); },
  win()     { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.24, 'triangle', 0.15, i * 0.13)); },
  lose()    { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, 'sawtooth', 0.11, i * 0.18)); }
};
