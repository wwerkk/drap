const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const hint = document.getElementById("hint");

const dpr = window.devicePixelRatio || 1;
const PPS = Math.max(10, Math.round((100 * dpr) / 10) * 10); // canvas px per second, multiple of 10
const RULER_H = 30 * dpr;

let mins = new Float32Array(0);
let maxs = new Float32Array(0);
let head = 0; // oldest column
let total = 0; // columns pushed since start
let acc = 0;
let last = performance.now();
let analyser = null;
let buf = null;

function resize() {
  canvas.width = Math.floor(canvas.clientWidth * dpr);
  canvas.height = Math.floor(canvas.clientHeight * dpr);
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
  total++;
}

function drawRuler() {
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = "#666";
  ctx.font = `${10 * dpr}px monospace`;
  ctx.textAlign = "center";
  const step = PPS / 10; // 0.1s
  for (let k = 0; k * step < w; k++) {
    const x = w - 1 - k * step;
    const major = k % 10 === 0;
    const len = major ? 10 * dpr : 5 * dpr;
    ctx.fillRect(x, h - len, 1, len);
    if (major) {
      ctx.textAlign = k === 0 ? "right" : "center";
      ctx.fillText(k === 0 ? "0s" : `${k / 10}s`, x, h - 14 * dpr);
    }
  }
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

  drawRuler();
}
requestAnimationFrame(draw);

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
  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  buf = new Float32Array(analyser.fftSize);
  source.connect(analyser); // not connected to output: no feedback
  hint.classList.add("hidden");
  last = performance.now();
}
window.addEventListener("click", start);