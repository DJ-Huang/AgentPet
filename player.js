(() => {
  const FALLBACK = ["waiting:working", "working:idle", "completed:idle"];
  const FALLBACK_MAP = Object.fromEntries(FALLBACK.map((pair) => pair.split(":")));

  const videoA = document.getElementById("video-a");
  const videoB = document.getElementById("video-b");
  const videos = [videoA, videoB];
  const sampleCanvas = document.createElement("canvas");
  const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });
  const maskCanvas = document.createElement("canvas");
  const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
  const maskImages = new Map();
  const DEFAULT_EFFECTS = { edgeFadePercent: 12, overallOpacity: 80 };
  const SWIPE_START_PX = 6;
  const SWIPE_DISMISS_MIN_PX = 64;
  const SWIPE_DISMISS_MAX_PX = 120;
  const TEXT = {
    "zh-CN": {
      activity: "活动",
      noActivity: "暂无活动",
      untitled: "未命名任务",
      agents: { codex: "Codex", cursor: "Cursor", "codely-cli": "Codely", "claude-code": "Claude", manual: "手动" },
      states: { idle: "空闲", waiting: "等待确认", working: "工作中", completed: "完成" },
    },
    en: {
      activity: "Activity",
      noActivity: "No activity",
      untitled: "Untitled Task",
      agents: { codex: "Codex", cursor: "Cursor", "codely-cli": "Codely", "claude-code": "Claude", manual: "Manual" },
      states: { idle: "Idle", waiting: "Needs Input", working: "Working", completed: "Done" },
    },
  };

  let activeIndex = 0;
  let currentState = null;
  let switching = false;
  let queued = null;
  let pendingState = null;
  let manifest = { clips: {}, files: {}, missing: {} };
  let language = "zh-CN";
  let currentThreads = [];
  let lastPick = {};
  let seqIndex = {};
  let ignoreMouse = true;
  let sampleRaf = 0;
  let dragging = false;
  const root = document.getElementById("root");
  const stage = document.getElementById("stage");
  const sessionList = document.getElementById("session-list");
  const sessionsPanel = document.getElementById("sessions");
  const activityTitle = document.getElementById("activity-title");

  function uiText(key) {
    return TEXT[language]?.[key] ?? TEXT["zh-CN"][key] ?? key;
  }

  function agentLabel(agent) {
    return TEXT[language]?.agents?.[agent] || TEXT["zh-CN"].agents?.[agent] || "";
  }

  function stateLabel(state) {
    return TEXT[language]?.states?.[state] || state;
  }

  function applyLanguage(nextLanguage) {
    language = nextLanguage === "en" ? "en" : "zh-CN";
    document.documentElement.lang = language;
    if (activityTitle) activityTitle.textContent = uiText("activity");
  }

  function applyVideoVisibility(visible) {
    if (root) root.classList.toggle("video-hidden", !visible);
  }

  function urlsFor(state) {
    const value = manifest.files?.[state];
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === "string" && value) return [value];
    return [];
  }

  function maskFor(state, videoUrl) {
    return manifest.masks?.[state]?.[videoUrl] || "";
  }

  function maskEffects() {
    const effects = manifest.effects || {};
    const edgeFadePercent = Number(effects.edgeFadePercent);
    const overallOpacity = Number(effects.overallOpacity);
    return {
      edgeFadePercent: Number.isFinite(edgeFadePercent)
        ? Math.max(0, Math.min(50, edgeFadePercent))
        : DEFAULT_EFFECTS.edgeFadePercent,
      overallOpacity: Number.isFinite(overallOpacity)
        ? Math.max(0, Math.min(100, overallOpacity))
        : DEFAULT_EFFECTS.overallOpacity,
    };
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

  function playableStateFor(state) {
    const seen = new Set();
    let cursor = state;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      if (urlsFor(cursor).length) return cursor;
      cursor = FALLBACK_MAP[cursor] || "idle";
    }
    return "idle";
  }

  function fileFor(state, options) {
    const resolvedState = playableStateFor(state);
    const url = pickUrl(resolvedState, options);
    if (url) return { state: resolvedState, url, mask: maskFor(resolvedState, url) };
    const fallbackUrl = pickUrl("idle", options);
    return { state: "idle", url: fallbackUrl, mask: maskFor("idle", fallbackUrl) };
  }

  function preloadMask(url) {
    if (!url || maskImages.has(url)) return;
    const image = new Image();
    image.src = url;
    maskImages.set(url, image);
  }

  function edgeFadeMasks(fade) {
    if (fade <= 0) return [];
    const stop = `${fade}%`;
    return [
      `linear-gradient(to right, rgba(0, 0, 0, 0) 0%, #000 ${stop}, #000 calc(100% - ${stop}), rgba(0, 0, 0, 0) 100%)`,
      `linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, #000 ${stop}, #000 calc(100% - ${stop}), rgba(0, 0, 0, 0) 100%)`,
    ];
  }

  function renderedVideoRect(video) {
    const elementRect = video.getBoundingClientRect();
    if (!video.videoWidth || !video.videoHeight || !elementRect.width || !elementRect.height) {
      return elementRect;
    }
    const contentScale = Math.min(elementRect.width / video.videoWidth, elementRect.height / video.videoHeight);
    const width = video.videoWidth * contentScale;
    const height = video.videoHeight * contentScale;
    return {
      left: elementRect.left + (elementRect.width - width) / 2,
      top: elementRect.top + (elementRect.height - height) / 2,
      right: elementRect.left + (elementRect.width + width) / 2,
      bottom: elementRect.top + (elementRect.height + height) / 2,
      width,
      height,
    };
  }

  function applyVideoEffects(video) {
    const effects = maskEffects();
    const url = video.getAttribute("data-mask-src") || "";
    const layers = [url ? `url("${url}")` : "", ...edgeFadeMasks(effects.edgeFadePercent)].filter(Boolean);
    const maskImage = layers.join(", ");
    const contentRect = renderedVideoRect(video);
    const maskSize = Array(layers.length).fill(`${contentRect.width}px ${contentRect.height}px`).join(", ");

    video.style.webkitMaskImage = maskImage;
    video.style.maskImage = maskImage;
    video.style.webkitMaskSize = maskSize;
    video.style.maskSize = maskSize;
    video.style.webkitMaskComposite = Array(Math.max(0, layers.length - 1)).fill("source-in").join(", ");
    video.style.maskComposite = Array(Math.max(0, layers.length - 1)).fill("intersect").join(", ");
    if (root) root.style.setProperty("--overall-opacity", String(effects.overallOpacity / 100));
    video.style.removeProperty("--overall-opacity");
    video.style.visibility = "";
  }

  function refreshVideoEffects() {
    videos.forEach(applyVideoEffects);
  }

  function setVideoMask(video, url) {
    video.setAttribute("data-mask-src", url || "");
    applyVideoEffects(video);
    preloadMask(url);
  }

  function show(video) {
    videos.forEach((item) => item.classList.toggle("active", item === video));
  }

  function stopPlayback() {
    switching = false;
    queued = null;
    videos.forEach((video) => {
      video.pause();
      video.removeAttribute("src");
      video.removeAttribute("data-src");
      video.removeAttribute("data-mask-src");
      video.style.webkitMaskImage = "";
      video.style.maskImage = "";
      video.style.webkitMaskComposite = "";
      video.style.maskComposite = "";
      video.style.webkitMaskSize = "";
      video.style.maskSize = "";
      video.style.removeProperty("--overall-opacity");
      video.style.visibility = "";
      video.load();
      video.classList.remove("active");
    });
    currentState = null;
    pendingState = null;
  }

  function playState(state, { nextClip } = {}) {
    if (switching) {
      queued = state;
      return;
    }
    const active = videos[activeIndex];
    const desiredState = playableStateFor(state);
    if (!nextClip && currentState === desiredState && active.src && !active.ended) {
      pendingState = null;
      const currentMeta = clipMeta(currentState);
      const rotates = Boolean(currentMeta.loop) && urlsFor(currentState).length > 1;
      active.loop = Boolean(currentMeta.loop) && !rotates;
      return;
    }

    pendingState = null;
    const target = fileFor(state, { advance: Boolean(nextClip) });

    const nextIndex = 1 - activeIndex;
    const hidden = videos[nextIndex];
    const meta = clipMeta(target.state);
    const rotate = Boolean(meta.loop) && urlsFor(target.state).length > 1;
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
      if (pendingState) {
        const next = pendingState;
        pendingState = null;
        playState(next);
        return;
      }
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
    const rect = renderedVideoRect(video);
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
    const rect = renderedVideoRect(video);
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
    const effects = maskEffects();
    const fadeX = effects.edgeFadePercent * video.videoWidth / 100;
    const fadeY = effects.edgeFadePercent * video.videoHeight / 100;
    if (fadeX > 0 || fadeY > 0) {
      const xT = fadeX > 0 ? Math.min(1, Math.max(0, Math.min(x, video.videoWidth - 1 - x) / fadeX)) : 1;
      const yT = fadeY > 0 ? Math.min(1, Math.max(0, Math.min(y, video.videoHeight - 1 - y) / fadeY)) : 1;
      const edgeAlpha = Math.min(xT * xT * (3 - 2 * xT), yT * yT * (3 - 2 * yT)) * effects.overallOpacity;
      if (edgeAlpha <= 20) return false;
    }
    const maskUrl = video.getAttribute("data-mask-src");
    const mask = maskUrl ? maskImages.get(maskUrl) : null;
    if (!mask || !mask.complete || !mask.naturalWidth) return true;
    maskCanvas.width = video.videoWidth;
    maskCanvas.height = video.videoHeight;
    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    maskCtx.drawImage(mask, 0, 0, maskCanvas.width, maskCanvas.height);
    return maskCtx.getImageData(Math.max(0, x), Math.max(0, y), 1, 1).data[3] * effects.overallOpacity / 100 > 20;
  }

  function syncPanelHeight() {
    if (!window.petBridge) return;
    const height = sessionsPanel && sessionsPanel.classList.contains("visible") ? sessionsPanel.offsetHeight : 0;
    window.petBridge.setPanelHeight(height);
  }

  function renderSessions(threads) {
    if (!sessionList) return;
    const rows = Array.isArray(threads) ? threads : [];
    currentThreads = rows;
    if (sessionsPanel) sessionsPanel.classList.add("visible");
    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "session-empty";
      empty.textContent = uiText("noActivity");
      sessionList.replaceChildren(empty);
      requestAnimationFrame(() => requestAnimationFrame(syncPanelHeight));
      return;
    }
    sessionList.replaceChildren(
      ...rows.map((thread) => {
        const row = document.createElement("div");
        row.className = "session-row";
        const canOpen = thread.agent !== "cursor";
        if (!canOpen) row.classList.add("noninteractive");
        if (thread.driving) row.classList.add("driving");
        if (thread.pinned) row.classList.add("pinned");
        row.dataset.id = thread.id;

        const dot = document.createElement("span");
        dot.className = "session-dot";
        if (thread.state === "completed") dot.classList.add("completed");
        else if (thread.state === "waiting") dot.classList.add("waiting");
        else if (thread.state !== "idle") dot.classList.add("running");

        const agent = document.createElement("span");
        agent.className = `session-agent ${thread.agent || "codex"}`;
        agent.textContent = agentLabel(thread.agent || "codex");

        const title = document.createElement("span");
        title.className = "session-title";
        title.textContent = thread.title || uiText("untitled");

        const label = document.createElement("span");
        label.className = "session-label";
        label.textContent = stateLabel(thread.state);

        row.append(dot, agent, title, label);
        let swipe = null;
        let suppressClick = false;

        function resetSwipe() {
          row.classList.remove("swiping");
          row.style.transform = "";
          row.style.opacity = "";
        }

        row.addEventListener("pointerdown", (event) => {
          event.stopPropagation();
          if (event.button !== 0) return;
          swipe = { pointerId: event.pointerId, startX: event.clientX, deltaX: 0 };
          suppressClick = false;
          try {
            row.setPointerCapture(event.pointerId);
          } catch {
            // Pointer capture is best-effort.
          }
        });
        row.addEventListener("pointermove", (event) => {
          if (!swipe || event.pointerId !== swipe.pointerId) return;
          swipe.deltaX = Math.max(0, event.clientX - swipe.startX);
          if (swipe.deltaX < SWIPE_START_PX) {
            if (suppressClick) {
              row.style.transform = `translateX(${swipe.deltaX}px)`;
              row.style.opacity = "1";
            }
            return;
          }
          suppressClick = true;
          event.preventDefault();
          row.classList.add("swiping");
          row.style.transform = `translateX(${swipe.deltaX}px)`;
          const width = Math.max(1, row.getBoundingClientRect().width);
          row.style.opacity = String(Math.max(0.28, 1 - swipe.deltaX / width));
        });
        row.addEventListener("pointerup", (event) => {
          if (!swipe || event.pointerId !== swipe.pointerId) return;
          const deltaX = swipe.deltaX;
          swipe = null;
          const width = Math.max(1, row.getBoundingClientRect().width);
          const threshold = Math.min(SWIPE_DISMISS_MAX_PX, Math.max(SWIPE_DISMISS_MIN_PX, width * 0.3));
          row.classList.remove("swiping");
          if (deltaX >= threshold) {
            suppressClick = true;
            row.classList.add("dismissing");
            row.style.transform = `translateX(${Math.max(width, deltaX)}px)`;
            row.style.opacity = "0";
            if (window.petBridge) window.petBridge.dismissThread(thread.id);
          } else {
            resetSwipe();
          }
        });
        row.addEventListener("pointercancel", () => {
          if (!swipe) return;
          suppressClick = swipe.deltaX >= SWIPE_START_PX;
          swipe = null;
          resetSwipe();
        });
        if (canOpen) {
          row.addEventListener("click", (event) => {
            event.stopPropagation();
            if (suppressClick) {
              suppressClick = false;
              event.preventDefault();
              return;
            }
            if (event.button !== 0) return;
            if (window.petBridge) window.petBridge.openThread(thread.id);
          });
        }
        row.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (window.petBridge) window.petBridge.threadContextMenu(thread.id);
        });
        return row;
      }),
    );
    requestAnimationFrame(() => requestAnimationFrame(syncPanelHeight));
  }

  function overPanel(event) {
    if (!sessionsPanel || !sessionsPanel.classList.contains("visible")) return false;
    const rect = sessionsPanel.getBoundingClientRect();
    return event.clientX >= rect.left && event.clientX <= rect.right
      && event.clientY >= rect.top && event.clientY <= rect.bottom;
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

  function beginDrag(event, target) {
    event.preventDefault();
    dragging = true;
    document.body.classList.add("dragging");
    setIgnore(false);
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // capture is best-effort
    }
    if (window.petBridge) {
      window.petBridge.dragStart({ x: event.screenX, y: event.screenY });
    }
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
    beginDrag(event, stage);
  });

  stage.addEventListener("contextmenu", (event) => {
    if (!hitPet(event.clientX, event.clientY)) return;
    event.preventDefault();
    if (window.petBridge) window.petBridge.videoContextMenu();
  });

  sessionsPanel.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest?.(".session-row")) return;
    beginDrag(event, sessionsPanel);
  });

  sessionsPanel.addEventListener("contextmenu", (event) => {
    if (event.target.closest?.(".session-row")) return;
    event.preventDefault();
    if (window.petBridge) window.petBridge.videoContextMenu();
  });

  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);
  window.addEventListener("blur", endDrag);

  window.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      if (window.petBridge) {
        window.petBridge.scaleBy(event.deltaY > 0 ? -0.01 : 0.01);
      }
    },
    { passive: false },
  );

  videos.forEach((video) => {
    video.addEventListener("loadedmetadata", () => applyVideoEffects(video));
  });
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(refreshVideoEffects).observe(stage);
  }

  if (window.petBridge) {
    window.petBridge.onInit((data) => {
      manifest = data || manifest;
      applyLanguage(data?.language || language);
      applyVideoVisibility(data?.videoVisible !== false);
      refreshVideoEffects();
      lastPick = {};
      seqIndex = {};
      currentState = null;
      pendingState = null;
      queued = null;
      switching = false;
      playState(data?.state || "idle");
      renderSessions(data?.threads);
    });
    window.petBridge.onState((data) => {
      playState(data?.state || "idle");
      renderSessions(data?.threads);
    });
    window.petBridge.onEffects((effects) => {
      manifest = { ...manifest, effects: effects || DEFAULT_EFFECTS };
      refreshVideoEffects();
    });
    window.petBridge.onLanguage((nextLanguage) => {
      applyLanguage(nextLanguage);
      renderSessions(currentThreads);
    });
    window.petBridge.onPanelPlacement((placement) => {
      if (root) root.classList.toggle("panel-above", Boolean(placement?.above));
    });
    window.petBridge.onVideoVisibility((visibility) => {
      applyVideoVisibility(visibility?.visible !== false);
    });
  }
})();
