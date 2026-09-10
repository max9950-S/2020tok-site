const empty = document.querySelector("#empty");
const stageHit = document.querySelector("#stage-hit");
const stageHud = document.querySelector("#stage-hud");
const videoDate = document.querySelector("#video-date");
const pauseBadge = document.querySelector("#pause-badge");
const timeNow = document.querySelector("#time-now");
const timeEnd = document.querySelector("#time-end");
const progressTrack = document.querySelector("#progress-track");
const progressFill = document.querySelector("#progress-fill");
const nextSlot = document.querySelector(".next-slot");
const btnNext = document.querySelector("#btn-next");
const btnUp = document.querySelector("#btn-up");
const btnDown = document.querySelector("#btn-down");
const app = document.querySelector(".app");

const ids = [];
const history = [];
const clips = [];
const seen = new Set();
let index = -1;
let previewId = null;
let previewReady = false;
let mainFrame = null;
let previewFrame = null;
let mainPlaying = false;
let wantsSound = false;
let audioCtx = null;
let durationSec = 0;
let currentSec = 0;
let scrubbing = false;

function previewWrap() {
  return document.querySelector("#preview-wrap");
}

function previewHost() {
  return document.querySelector("#preview");
}

function unlockAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(0);
    osc.stop(audioCtx.currentTime + 0.04);
  } catch {
    /* autoplay unlock is best-effort */
  }
}

function parseId(line) {
  const text = line.trim();
  if (!text || text.startsWith("#")) return null;
  const fromUrl = text.match(/\/video\/(\d+)/);
  if (fromUrl) return fromUrl[1];
  const bare = text.match(/^(\d{8,})$/);
  return bare ? bare[1] : null;
}

function playerSrc(id) {
  const params = new URLSearchParams({
    autoplay: "1",
    loop: "1",
    controls: "0",
    progress_bar: "0",
    play_button: "0",
    volume_control: "0",
    fullscreen_button: "0",
    timestamp: "0",
    music_info: "0",
    description: "0",
    rel: "0",
  });
  return `https://www.tiktok.com/player/v1/${id}?${params}`;
}

function createFrame(id) {
  const iframe = document.createElement("iframe");
  iframe.src = playerSrc(id);
  iframe.allow = "autoplay; fullscreen; encrypted-media";
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  iframe.title = "2020Tok";
  iframe.dataset.id = id;
  return iframe;
}

function send(iframe, type, value) {
  if (!iframe?.contentWindow) return;
  iframe.contentWindow.postMessage(
    { "x-tiktok-player": true, type, value },
    "*"
  );
}

function unmuteAndPlay(iframe) {
  if (!iframe?.contentWindow) return;
  send(iframe, "unMute");
  send(iframe, "play");
  send(iframe, "unMute");
  send(iframe, "play");
}

function playFromStart(iframe) {
  if (!iframe?.contentWindow) return;
  send(iframe, "seekTo", 0);
  unmuteAndPlay(iframe);
  send(iframe, "seekTo", 0);
  unmuteAndPlay(iframe);
}

function markMainPlaying() {
  mainPlaying = true;
  pauseBadge.hidden = true;
  stageHit.setAttribute("aria-label", "Pause video");
}

let loopGuard = 0;

function loopMainNow() {
  if (!mainFrame) return;
  const now = performance.now();
  if (now - loopGuard < 250) {
    markMainPlaying();
    return;
  }
  loopGuard = now;
  send(mainFrame, "seekTo", 0);
  if (wantsSound) unmuteAndPlay(mainFrame);
  markMainPlaying();
  if (durationSec > 0) renderProgress(0, durationSec);
}

const Y2020_START = 1577836800;
const Y2020_END = 1609459199;

function tiktokIdTimestamp(id) {
  try {
    return Number(BigInt(id) >> 32n);
  } catch {
    return null;
  }
}

function is2020Video(id) {
  const ts = tiktokIdTimestamp(id);
  return ts !== null && ts >= Y2020_START && ts <= Y2020_END;
}

function tiktokIdToDate(id) {
  const ts = tiktokIdTimestamp(id);
  if (ts === null || ts < 1_000_000_000 || ts > 4_000_000_000) return null;
  return new Date(ts * 1000);
}

function formatVideoDate(date) {
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const mins = Math.floor(total / 60);
  const secs = String(total % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

function renderProgress(now, duration) {
  currentSec = Math.max(0, Number(now) || 0);
  durationSec = Math.max(0, Number(duration) || 0);
  if (durationSec > 0) currentSec = Math.min(currentSec, durationSec);
  const pct = durationSec > 0 ? (currentSec / durationSec) * 100 : 0;
  progressFill.style.width = `${pct}%`;
  timeNow.textContent = formatClock(currentSec);
  timeEnd.textContent = formatClock(durationSec);
  progressTrack.setAttribute("aria-valuemax", String(Math.round(durationSec)));
  progressTrack.setAttribute("aria-valuenow", String(Math.round(currentSec)));
}

function resetProgress() {
  scrubbing = false;
  renderProgress(0, 0);
}

function parseTimePayload(value) {
  if (value && typeof value === "object") {
    const now = Number(value.currentTime);
    const duration = Number(value.duration);
    return {
      now: Number.isFinite(now) ? now : 0,
      duration: Number.isFinite(duration) ? duration : durationSec,
    };
  }
  const now = Number(value);
  return { now: Number.isFinite(now) ? now : 0, duration: durationSec };
}

function seekFromClientX(clientX) {
  if (!mainFrame || durationSec <= 0) return;
  const rect = progressTrack.getBoundingClientRect();
  const ratio = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
  const next = ratio * durationSec;
  renderProgress(next, durationSec);
  send(mainFrame, "seekTo", next);
}

function setVideoDate(id) {
  const date = tiktokIdToDate(id);
  if (!date) {
    videoDate.hidden = true;
    videoDate.textContent = "";
    return;
  }
  videoDate.hidden = false;
  videoDate.dateTime = date.toISOString().slice(0, 10);
  videoDate.textContent = formatVideoDate(date);
}

function showStage() {
  empty.hidden = true;
  stageHit.hidden = false;
  stageHud.hidden = false;
  app.classList.add("is-watching");
}

function hideStage() {
  empty.hidden = false;
  stageHit.hidden = true;
  stageHud.hidden = true;
  pauseBadge.hidden = true;
  app.classList.remove("is-watching");
  resetProgress();
}

function togglePause() {
  if (!mainFrame) return;
  if (mainPlaying) {
    wantsSound = false;
    send(mainFrame, "pause");
    mainPlaying = false;
    pauseBadge.hidden = false;
    stageHit.setAttribute("aria-label", "Play video");
  } else {
    wantsSound = true;
    unlockAudio();
    unmuteAndPlay(mainFrame);
    markMainPlaying();
  }
}

function pickRandom(avoid) {
  const pool = ids.filter((id) => !seen.has(id) && id !== avoid);
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function updateButtons() {
  btnUp.disabled = index <= 0;
  btnDown.disabled = index < 0 || index >= history.length - 1;
  btnNext.disabled = !previewReady || !previewId;
}

function reduceMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function silenceClip(clip) {
  if (!clip) return;
  send(clip.iframe, "pause");
  send(clip.iframe, "mute");
}

function parkClip(clip) {
  if (!clip) return;
  silenceClip(clip);
  stopSlide(clip.wrap);
  clip.wrap.classList.add("is-parked");
}

function parkIfInactive(clip) {
  if (!clip) return;
  if (clip.iframe === mainFrame) {
    stopSlide(clip.wrap);
    return;
  }
  parkClip(clip);
}

function currentClip() {
  return clips.find((clip) => clip && clip.iframe === mainFrame) || null;
}

const SLIDE_MS = 380;
const SLIDE_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

function stopSlide(wrap) {
  if (!wrap) return;
  for (const anim of wrap.getAnimations()) anim.cancel();
  wrap.style.transform = "";
  wrap.style.zIndex = "";
}

function runSlide(wrap, fromY, toY, onDone) {
  stopSlide(wrap);
  wrap.style.transform = `translate3d(0, ${fromY}, 0)`;
  wrap.offsetHeight;
  const anim = wrap.animate(
    [
      { transform: `translate3d(0, ${fromY}, 0)` },
      { transform: `translate3d(0, ${toY}, 0)` },
    ],
    { duration: SLIDE_MS, easing: SLIDE_EASE, fill: "forwards" }
  );
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    anim.cancel();
    wrap.style.transform = toY === "0px" || toY === "0%" ? "" : `translate3d(0, ${toY}, 0)`;
    onDone?.();
  };
  anim.onfinish = finish;
  window.setTimeout(finish, SLIDE_MS + 80);
}

function slideSwap(incomingWrap, dir) {
  const outgoing = currentClip();
  const inFrom = dir === 1 ? "100%" : "-100%";
  const outTo = dir === 1 ? "-100%" : "100%";

  if (outgoing && outgoing.wrap !== incomingWrap) {
    silenceClip(outgoing);
    outgoing.wrap.style.zIndex = "0";
    if (reduceMotion()) {
      parkClip(outgoing);
    } else {
      const clip = outgoing;
      runSlide(outgoing.wrap, "0%", outTo, () => parkIfInactive(clip));
    }
  }

  incomingWrap.classList.add("is-main");
  incomingWrap.classList.remove("is-parked");
  incomingWrap.style.zIndex = "1";

  if (!reduceMotion()) {
    runSlide(incomingWrap, inFrom, "0%", () => {
      incomingWrap.style.transform = "";
      incomingWrap.style.zIndex = "";
    });
  }
}

function discardFutureClips() {
  if (index < clips.length - 1) {
    const removed = clips.splice(index + 1);
    for (const clip of removed) clip.wrap.remove();
  }
  if (index < history.length - 1) {
    history.length = index + 1;
  }
}

function showClip(clip, dir) {
  slideSwap(clip.wrap, dir);
  mainFrame = clip.iframe;
  showStage();
  setVideoDate(clip.id);
  resetProgress();
  markMainPlaying();
  playFromStart(clip.iframe);
}

function loadPreview(avoid) {
  const host = previewHost();
  if (!host) return;
  previewReady = false;
  previewId = pickRandom(avoid);
  host.replaceChildren();
  previewFrame = null;
  updateButtons();
  if (!previewId) return;
  previewFrame = createFrame(previewId);
  host.append(previewFrame);
}

function makePreviewShell() {
  const wrap = document.createElement("div");
  wrap.className = "next-wrap";
  wrap.id = "preview-wrap";
  const host = document.createElement("div");
  host.className = "preview";
  host.id = "preview";
  wrap.append(host);
  nextSlot.insertBefore(wrap, btnNext);
}

function promotePreview() {
  const wrap = previewWrap();
  const iframe = previewFrame;
  const id = previewId;
  if (!wrap || !iframe || !id) return false;

  slideSwap(wrap, 1);
  wrap.removeAttribute("id");
  previewHost()?.removeAttribute("id");
  wrap.dataset.id = id;

  const clip = { id, wrap, iframe };
  clips[index] = clip;
  mainFrame = iframe;
  showStage();
  setVideoDate(id);
  resetProgress();
  markMainPlaying();
  playFromStart(iframe);

  makePreviewShell();
  previewFrame = null;
  previewId = null;
  previewReady = false;
  loadPreview(id);
  return true;
}

function playFromHistory(nextIndex) {
  const clip = clips[nextIndex];
  if (!clip) return;
  const dir = nextIndex > index ? 1 : -1;
  index = nextIndex;
  wantsSound = true;
  playFromStart(clip.iframe);
  showClip(clip, dir);
  updateButtons();
}

window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data["x-tiktok-player"] !== true) return;

  if (data.type === "onPlayerReady") {
    if (previewFrame && event.source === previewFrame.contentWindow) {
      previewReady = true;
      send(previewFrame, "mute");
      send(previewFrame, "play");
      updateButtons();
    }
    if (mainFrame && event.source === mainFrame.contentWindow && wantsSound) {
      unmuteAndPlay(mainFrame);
      markMainPlaying();
    }
    return;
  }

  if (data.type === "onPlayerError") {
    if (previewFrame && event.source === previewFrame.contentWindow) {
      const deadId = previewId;
      const pos = ids.indexOf(deadId);
      if (pos !== -1) ids.splice(pos, 1);
      previewFrame = null;
      previewId = null;
      previewReady = false;
      if (!ids.length) {
        hideStage();
        clips.splice(0).forEach((clip) => clip.wrap.remove());
        previewHost()?.replaceChildren();
        empty.querySelector("p").textContent = "No playable videos left";
        empty.querySelector("span").textContent = "All entries in links.txt failed to load";
        updateButtons();
        return;
      }
      loadPreview(history[index] ?? null);
    }
    return;
  }

  if (data.type === "onCurrentTime" && mainFrame && event.source === mainFrame.contentWindow) {
    if (scrubbing) return;
    const { now, duration } = parseTimePayload(data.value);
    if (wantsSound && duration > 0 && now >= duration - 0.12) {
      loopMainNow();
      return;
    }
    renderProgress(now, duration);
    return;
  }

  if (data.type === "onStateChange" && mainFrame && event.source === mainFrame.contentWindow) {
    const state = Number(data.value);
    if (state === 1) {
      markMainPlaying();
      return;
    }
    if (state === 3 || state === -1) return;
    if (state === 0) {
      loopMainNow();
      return;
    }
    if (state === 2 && wantsSound) {
      if (durationSec > 0 && currentSec >= durationSec - 0.4) loopMainNow();
      else unmuteAndPlay(mainFrame);
      markMainPlaying();
      return;
    }
    if (state === 2) {
      mainPlaying = false;
      pauseBadge.hidden = false;
      stageHit.setAttribute("aria-label", "Play video");
    }
  }
});

function onActivate(element, handler) {
  let locked = false;
  const run = (event) => {
    if (event.pointerType === "mouse" && "button" in event && event.button !== 0) {
      return;
    }
    if (locked) return;
    locked = true;
    setTimeout(() => {
      locked = false;
    }, 350);
    unlockAudio();
    handler(event);
  };
  element.addEventListener("pointerdown", run);
}

progressTrack.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  if (!mainFrame || durationSec <= 0) return;
  event.preventDefault();
  event.stopPropagation();
  scrubbing = true;
  progressTrack.setPointerCapture(event.pointerId);
  seekFromClientX(event.clientX);
});

progressTrack.addEventListener("pointermove", (event) => {
  if (!scrubbing) return;
  seekFromClientX(event.clientX);
});

const endScrub = (event) => {
  if (!scrubbing) return;
  seekFromClientX(event.clientX);
  scrubbing = false;
  if (wantsSound && mainFrame) unmuteAndPlay(mainFrame);
};

progressTrack.addEventListener("pointerup", endScrub);
progressTrack.addEventListener("pointercancel", endScrub);

progressTrack.addEventListener("keydown", (event) => {
  if (!mainFrame || durationSec <= 0) return;
  const step = event.shiftKey ? 5 : 2;
  let next = currentSec;
  if (event.key === "ArrowRight" || event.key === "ArrowUp") next += step;
  else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next -= step;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = durationSec;
  else return;
  event.preventDefault();
  next = Math.min(durationSec, Math.max(0, next));
  renderProgress(next, durationSec);
  send(mainFrame, "seekTo", next);
});

onActivate(stageHit, togglePause);

onActivate(btnNext, () => {
  if (!previewId || !previewReady || !previewFrame) return;

  const id = previewId;
  discardFutureClips();
  history.push(id);
  seen.add(id);
  index = history.length - 1;

  wantsSound = true;
  playFromStart(previewFrame);
  promotePreview();
});

onActivate(btnUp, () => {
  if (index <= 0) return;
  playFromHistory(index - 1);
});

onActivate(btnDown, () => {
  if (index >= history.length - 1) return;
  playFromHistory(index + 1);
});

async function boot() {
  try {
    const res = await fetch("./data/links.txt", { cache: "no-store" });
    const text = await res.text();
    for (const line of text.split(/\r?\n/)) {
      const id = parseId(line);
      if (id && is2020Video(id) && !ids.includes(id)) ids.push(id);
    }
  } catch {
    /* empty catalog */
  }

  if (!ids.length) {
    empty.querySelector("p").textContent = "No videos in links.txt";
    empty.querySelector("span").textContent = "Add a TikTok URL on its own line";
    return;
  }

  loadPreview(null);
}

boot();
