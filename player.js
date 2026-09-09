(() => {
  const FALLBACK = ["thinking:working", "working:idle", "waiting:idle", "review:idle", "failed:idle"];
  const FALLBACK_MAP = Object.fromEntries(FALLBACK.map((pair) => pair.split(":")));

  const videoA = document.getElementById("video-a");
  const videoB = document.getElementById("video-b");
  const videos = [videoA, videoB];
  const sampleCanvas = document.createElement("canvas");
  const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });
  const maskCanvas = document.createElement("canvas");
  const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
  const maskImages = new Map();

  let activeIndex = 0;
  let currentState = null;
  let switching = false;
  let queued = null;
  let manifest = { clips: {}, files: {}, missing: {} };
  let lastPick = {};
  let seqIndex = {};
  let ignoreMouse = true;
  let sampleRaf = 0;
  let dragging = false;
  const stage = document.getElementById("stage");
  const sessionList = document.getElementById("session-list");
  const sessionsPanel = document.getElementById("sessions");

  function urlsFor(state) {
    const value = manifest.files?.[state];
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === "string" && value) return [value];
    return [];
  }

  function maskFor(state, videoUrl) {
    return manifest.masks?.[state]?.[videoUrl] || "";
  }

  function clipMeta(state) {
    return manifest.clips[state] || { loop: true, pick: "random" };
  }

  function pickUrl(state, { advance } = {}) {
    const urls = urlsFor(state);
    if (!urls.length) return "";
    const meta = clipMeta(state);
    if (meta.pick === "sequence") {
      if (!Number.isInteger(seqIndex[state]) || seqIndex[state] < 0) seqIndex[state] = 0;
      if (advance) seqIndex[state] += 1;
      const url = urls[seqIndex[state] % urls.length];
      lastPick[state] = url;
      return url;
    }
    if (urls.length === 1) {
      lastPick[state] = urls[0];
      return urls[0];
    }
    const pool = urls.filter((url) => url !== lastPick[state]);
    const url = pool[Math.floor(Math.random() * pool.length)];
    lastPick[state] = url;
    return url;
  }

  function fileFor(state, options) {
    const seen = new Set();
    let cursor = state;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
    if (urlsFor(cursor).length) {
      const url = pickUrl(cursor, options);
      return { state: cursor, url, mask: maskFor(cursor, url) };
    }
      cursor = FALLBACK_MAP[cursor] || "idle";
    }
    const url = pickUrl("idle", options);
    return { state: "idle", url, mask: maskFor("idle", url) };
  }

  function preloadMask(url) {
    if (!url || maskImages.has(url)) return;
    const image = new Image();
    image.src = url;
    maskImages.set(url, image);
  }

  function setVideoMask(video, url) {
    video.style.webkitMaskImage = url ? `url("${url}")` : "";
    video.setAttribute("data-mask-src", url || "");
    preloadMask(url);
  }

  function show(video) {
    videos.forEach((item) => item.classList.toggle("active", item === video));
  }

  function stopPlayback() {
    videos.forEach((video) => {
      video.pause();
      video.removeAttribute("src");
      video.removeAttribute("data-src");
      video.removeAttribute("data-mask-src");
      video.style.webkitMaskImage = "";
      video.load();
      video.classList.remove("active");
    });
    currentState = null;
  }

  function playState(state, { nextClip } = {}) {
    if (switching) {
      queued = state;
      return;
    }
    const target = fileFor(state, { advance: Boolean(nextClip) });
    const active = videos[activeIndex];
    if (
      !nextClip &&
      currentState === target.state &&
      active.src &&
      active.getAttribute("data-src") === target.url
    ) {
      return;
    }

    const nextIndex = 1 - activeIndex;
    const hidden = videos[nextIndex];
    const meta = clipMeta(target.state);
    const rotate = Boolean(meta.loop) && meta.pick === "sequence" && urlsFor(target.state).length > 1;
    switching = true;

    const finish = () => {
      hidden.loop = Boolean(meta.loop) && !rotate;
      hidden.muted = true;
      const playPromise = hidden.play();
      const go = () => {
        show(hidden);
        active.pause();
        activeIndex = nextIndex;
        currentState = target.state;
        switching = false;
        if (queued && queued !== state) {
          const next = queued;
          queued = null;
          playState(next);
        } else {
          queued = null;
        }
      };
      if (playPromise && typeof playPromise.then === "function") {
        playPromise.then(go).catch(go);
      } else {
        go();
      }
    };

    hidden.onended = () => {
      if (rotate) {
        playState(target.state, { nextClip: true });
        return;
      }
      if (!meta.loop && window.petBridge) {
        window.petBridge.clipEnded(target.state);
      }
    };

    if (!target.url) {
      switching = false;
      stopPlayback();
      return;
    }

    if (hidden.getAttribute("data-src") === target.url && hidden.readyState >= 2) {
      hidden.currentTime = 0;
      finish();
      return;
    }

    const onReady = () => {
      hidden.removeEventListener("canplay", onReady);
      hidden.removeEventListener("error", onError);
      finish();
    };
    const onError = () => {
      hidden.removeEventListener("canplay", onReady);
      hidden.removeEventListener("error", onError);
      switching = false;
      if (target.state !== "idle") playState("idle");
    };

    hidden.addEventListener("canplay", onReady, { once: true });
    hidden.addEventListener("error", onError, { once: true });
    hidden.src = target.url;
    hidden.setAttribute("data-src", target.url);
    setVideoMask(hidden, target.mask);
    hidden.load();
  }

  function hitPet(clientX, clientY) {
    const video = videos[activeIndex];
    if (!video) return false;
    const rect = video.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      return false;
    }
    if (!video.videoWidth || !video.videoHeight) return true;
    try {
      return sampleOpaque(clientX, clientY);
    } catch {
      return true;
    }
  }

  function sampleOpaque(clientX, clientY) {
    const video = videos[activeIndex];
    if (!video || !video.videoWidth || !video.videoHeight) return false;
    const rect = video.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      return false;
    }
    sampleCanvas.width = video.videoWidth;
    sampleCanvas.height = video.videoHeight;
    sampleCtx.clearRect(0, 0, sampleCanvas.width, sampleCanvas.height);
    sampleCtx.drawImage(video, 0, 0);
    const x = Math.floor(((clientX - rect.left) / rect.width) * video.videoWidth);
    const y = Math.floor(((clientY - rect.top) / rect.height) * video.videoHeight);
    const pixel = sampleCtx.getImageData(Math.max(0, x), Math.max(0, y), 1, 1).data;
    if (pixel[3] <= 20) return false;
    const maskUrl = video.getAttribute("data-mask-src");
    const mask = maskUrl ? maskImages.get(maskUrl) : null;
    if (!mask || !mask.complete || !mask.naturalWidth) return true;
    maskCanvas.width = video.videoWidth;
    maskCanvas.height = video.videoHeight;
    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    maskCtx.drawImage(mask, 0, 0, maskCanvas.width, maskCanvas.height);
    return maskCtx.getImageData(Math.max(0, x), Math.max(0, y), 1, 1).data[3] > 20;
  }

  function syncPanelHeight() {
    if (!window.petBridge) return;
    const height = sessionsPanel && sessionsPanel.classList.contains("visible") ? sessionsPanel.offsetHeight : 0;
    window.petBridge.setPanelHeight(height);
  }

  function renderSessions(threads) {
    if (!sessionList) return;
    const rows = Array.isArray(threads) ? threads : [];
    if (sessionsPanel) sessionsPanel.classList.toggle("visible", rows.length > 0);
    if (rows.length === 0) {
      sessionList.replaceChildren();
      requestAnimationFrame(() => requestAnimationFrame(syncPanelHeight));
      return;
    }
    sessionList.replaceChildren(
      ...rows.map((thread) => {
        const row = document.createElement("div");
        row.className = "session-row";
        if (thread.driving) row.classList.add("driving");
        if (thread.pinned) row.classList.add("pinned");
        row.dataset.id = thread.id;

        const dot = document.createElement("span");
        dot.className = "session-dot";
        if (thread.state === "review") dot.classList.add("review");
        else if (thread.state === "failed") dot.classList.add("failed");
        else if (thread.state !== "idle") dot.classList.add("running");

        const title = document.createElement("span");
        title.className = "session-title";
        title.textContent = thread.title || "未命名";

        const label = document.createElement("span");
        label.className = "session-label";
        label.textContent = thread.pinned ? "钉住" : thread.label || "";

        row.append(dot, title, label);
        row.addEventListener("pointerdown", (event) => {
          event.stopPropagation();
        });
        row.addEventListener("click", (event) => {
          event.stopPropagation();
          if (window.petBridge) window.petBridge.openThread(thread.id);
        });
        return row;
      }),
    );
    requestAnimationFrame(() => requestAnimationFrame(syncPanelHeight));
  }

  function overPanel(event) {
    if (!sessionsPanel || !sessionsPanel.classList.contains("visible")) return false;
    return Boolean(event.target.closest && event.target.closest("#sessions"));
  }

  function setIgnore(next) {
    if (dragging) next = false;
    if (next === ignoreMouse) return;
    ignoreMouse = next;
    if (window.petBridge) window.petBridge.setIgnoreMouse(next);
  }

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("dragging");
    if (window.petBridge) window.petBridge.dragEnd();
  }

  window.addEventListener("mousemove", (event) => {
    if (dragging) return;
    if (sampleRaf) return;
    sampleRaf = requestAnimationFrame(() => {
      sampleRaf = 0;
      if (overPanel(event)) setIgnore(false);
      else setIgnore(!hitPet(event.clientX, event.clientY));
    });
  });

  window.addEventListener("mouseleave", () => {
    if (!dragging) setIgnore(true);
  });

  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (!hitPet(event.clientX, event.clientY)) return;
    event.preventDefault();
    dragging = true;
    document.body.classList.add("dragging");
    setIgnore(false);
    try {
      stage.setPointerCapture(event.pointerId);
    } catch {
      // capture is best-effort
    }
    if (window.petBridge) {
      window.petBridge.dragStart({ x: event.screenX, y: event.screenY });
    }
  });

  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  window.addEventListener("blur", endDrag);

  window.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      if (window.petBridge) {
        window.petBridge.scaleBy(event.deltaY > 0 ? -0.1 : 0.1);
      }
    },
    { passive: false },
  );

  if (window.petBridge) {
    window.petBridge.onInit((data) => {
      manifest = data || manifest;
      lastPick = {};
      seqIndex = {};
      currentState = null;
      playState(data?.state || "idle");
      renderSessions(data?.threads);
    });
    window.petBridge.onState((data) => {
      playState(data?.state || "idle");
      renderSessions(data?.threads);
    });
  }
})();
