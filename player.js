(() => {
  const FALLBACK = ["thinking:working", "working:idle", "waiting:idle", "review:idle", "failed:idle"];
  const FALLBACK_MAP = Object.fromEntries(FALLBACK.map((pair) => pair.split(":")));

  const videoA = document.getElementById("video-a");
  const videoB = document.getElementById("video-b");
  const videos = [videoA, videoB];
  const sampleCanvas = document.createElement("canvas");
  const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });

  let activeIndex = 0;
  let currentState = null;
  let switching = false;
  let queued = null;
  let manifest = { clips: {}, files: {}, missing: {} };
  let ignoreMouse = true;
  let sampleRaf = 0;
  let dragging = false;
  const stage = document.getElementById("stage");

  function fileFor(state) {
    const seen = new Set();
    let cursor = state;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      if (manifest.files[cursor]) return { state: cursor, url: manifest.files[cursor] };
      cursor = FALLBACK_MAP[cursor] || "idle";
    }
    return { state: "idle", url: manifest.files.idle || "" };
  }

  function clipMeta(state) {
    return manifest.clips[state] || { loop: true };
  }

  function show(video) {
    videos.forEach((item) => item.classList.toggle("active", item === video));
  }

  function playState(state) {
    if (switching) {
      queued = state;
      return;
    }
    const target = fileFor(state);
    const active = videos[activeIndex];
    if (currentState === target.state && active.src) return;

    const nextIndex = 1 - activeIndex;
    const hidden = videos[nextIndex];
    const meta = clipMeta(target.state);
    switching = true;

    const finish = () => {
      hidden.loop = Boolean(meta.loop);
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
      if (!meta.loop && window.petBridge) {
        window.petBridge.clipEnded(target.state);
      }
    };

    if (!target.url) {
      switching = false;
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
    return pixel[3] > 20;
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
      setIgnore(!hitPet(event.clientX, event.clientY));
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
      playState(data?.state || "idle");
    });
    window.petBridge.onState((data) => {
      playState(data?.state || "idle");
    });
  }
})();
