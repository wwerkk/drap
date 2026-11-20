const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const hint = document.getElementById("hint");

const dpr = window.devicePixelRatio || 1;
const VISIBLE_SECONDS = 5;
let PPS = 1;
const RULER_H = 30 * dpr;
const MARGIN = 0 * dpr; // inert L/R zones for new clicks
const MAX_DELAY = 5; // seconds of buffer
const DOUBLE_TAP_MS = 300;

let mins = new Float32Array(0);
let maxs = new Float32Array(0);
let head = 0; // oldest column
let acc = 0;
let last = performance.now();
let analyser = null;
let buf = null;
let audioCtx = null;
let master = null;

// playheads[i] = { delay, shown, node } or null; i = 0..9 (keys 1..9,0)
const playheads = new Array(10).fill(null);
let selected = 0; // index armed by last key press
let dragging = null; // index being dragged
const lastTap = new Array(10).fill(0);

function maxDelay() {
  return Math.min(MAX_DELAY, (canvas.width - 1) / PPS);
}

function updateGain() {
  if (!master) return;
  const n = playheads.filter(Boolean).length;
  master.gain.setTargetAtTime(n ? 1 / n : 1, audioCtx.currentTime, 0.05);
}

function ensureNode(p) {
  if (!audioCtx || p.node) return;
  p.node = audioCtx.createDelay(MAX_DELAY);
  p.node.delayTime.value = p.delay;
  shaper.connect(p.node);
  p.node.connect(master);
}

function setDelay(i, clientX) {
  const x = (clientX - canvas.getBoundingClientRect().left) * dpr;
  const d = Math.min(Math.max((canvas.width - 1 - x) / PPS, 0), maxDelay());
  let p = playheads[i];
  if (!p) {
    p = playheads[i] = { delay: d, shown: d, node: null };
    ensureNode(p);
    updateGain();
  }
  p.delay = d;
  if (p.node) p.node.delayTime.setTargetAtTime(d, audioCtx.currentTime, 0.05);
}

function removePlayhead(i) {
  const p = playheads[i];
  if (!p) return;
  if (p.node) p.node.disconnect();
  playheads[i] = null;
  updateGain();
}

canvas.addEventListener("pointerdown", (e) => {
  if (selected === null) return;
  // L/R margins: ignore new clicks (dragging into them is still allowed)
  const x = (e.clientX - canvas.getBoundingClientRect().left) * dpr;
  if (x < MARGIN || x > canvas.width - MARGIN) return;
  canvas.setPointerCapture(e.pointerId);
  dragging = selected;
  setDelay(dragging, e.clientX);
});
canvas.addEventListener("pointermove", (e) => {
  if (dragging !== null) setDelay(dragging, e.clientX);
});
canvas.addEventListener("pointerup", () => (dragging = null));
canvas.addEventListener("pointercancel", () => (dragging = null));

window.addEventListener("keydown", (e) => {
  if (e.repeat || dragging !== null || !/^[0-9]$/.test(e.key)) return;
  const i = e.key === "0" ? 9 : Number(e.key) - 1;
  const now = performance.now();
  if (now - lastTap[i] < DOUBLE_TAP_MS) {
    removePlayhead(i);
    lastTap[i] = 0;
  } else {
    lastTap[i] = now;
  }
  selected = i;
});

function resize() {
  canvas.width = Math.floor(canvas.clientWidth * dpr);
  canvas.height = Math.floor(canvas.clientHeight * dpr);
  PPS = canvas.width / VISIBLE_SECONDS;
  mins = new Float32Array(canvas.width);
  maxs = new Float32Array(canvas.width);
  head = 0;
}
window.addEventListener("resize", resize);
resize();

function push(lo, hi) {
  mins[head] = lo;
  maxs[head] = hi;
  head = (head + 1) % mins.length;
}

function drawRuler() {
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = "#666";
  ctx.font = `${10 * dpr}px monospace`;
  const step = PPS / 10; // 0.1s
  for (let k = 0; k * step <= w; k++) {
    const x = Math.max(0, Math.round(w - 1 - k * step));
    const major = k % 10 === 0;
    const len = major ? 10 * dpr : 5 * dpr;
    ctx.fillRect(x, h - len, 1, len);
    if (major) {
      ctx.textAlign = k === 0 ? "right" : x < 20 * dpr ? "left" : "center";
      ctx.fillText(k === 0 ? "0s" : `-${k / 10}s`, x, h - 14 * dpr);
    }
  }
}

function drawPlayheads() {
  const w = canvas.width;
  const h = canvas.height;
  ctx.font = `${12 * dpr}px monospace`;
  ctx.textAlign = "left";
  playheads.forEach((p, i) => {
    if (!p) return;
    p.shown += (p.delay - p.shown) * 0.3;
    const x = w - 1 - p.shown * PPS;
    ctx.fillStyle = "red";
    ctx.fillRect(x - dpr, 0, 2 * dpr, h);
    ctx.fillText((i + 1) % 10, x + 4 * dpr, 14 * dpr);
  });
}

function draw(now) {
  requestAnimationFrame(draw);
  const dt = (now - last) / 1000;
  last = now;

  if (analyser) {
    analyser.getFloatTimeDomainData(buf);
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] < lo) lo = buf[i];
      if (buf[i] > hi) hi = buf[i];
    }
    acc += dt * PPS;
    const n = Math.min(Math.floor(acc), mins.length);
    acc -= Math.floor(acc);
    for (let i = 0; i < n; i++) push(lo, hi);
  }

  const w = canvas.width;
  const h = canvas.height;
  const mid = (h - RULER_H) / 2;

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#000";

  for (let x = 0; x < w; x++) {
    const i = (head + x) % w;
    const top = mid - maxs[i] * mid;
    const bottom = mid - mins[i] * mid;
    ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
  }

  ctx.fillStyle = "rgba(0,0,0,0.06)";
  ctx.fillRect(0, 0, MARGIN, h);
  ctx.fillRect(w - MARGIN, 0, MARGIN, h);

  drawRuler();
  drawPlayheads();
}
requestAnimationFrame(draw);

let shaper = null;
let fb = null;
const fbSlider = document.getElementById("fbSlider");
const fbValue = document.getElementById("fbValue");

function applyFeedback() {
  const v = Number(fbSlider.value);
  fbValue.textContent = v.toFixed(2);
  if (fb) fb.gain.setTargetAtTime(v, audioCtx.currentTime, 0.02);
}
fbSlider.addEventListener("input", applyFeedback);

async function start() {
  window.removeEventListener("click", start);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);

  // write head (time 0): input + feedback -> tanh clipper -> buffer taps
  const bus = audioCtx.createGain();
  bus.gain.value = 1;
  shaper = audioCtx.createWaveShaper();
  const curve = new Float32Array(1025);
  for (let i = 0; i < curve.length; i++) {
    curve[i] = Math.tanh(3 * ((i * 2) / (curve.length - 1) - 1)); // = tanh(input)
  }
  shaper.curve = curve;
  shaper.oversample = "2x";
  source.connect(bus);
  bus.connect(shaper);

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  buf = new Float32Array(analyser.fftSize);
  shaper.connect(analyser); // shows what is written to the buffer

  master = audioCtx.createGain();
  master.connect(audioCtx.destination);
  fb = audioCtx.createGain();
  master.connect(fb);
  fb.connect(bus);
  applyFeedback();
  playheads.forEach((p) => p && ensureNode(p));
  updateGain();
  hint.classList.add("hidden");
  last = performance.now();
}
window.addEventListener("click", start);