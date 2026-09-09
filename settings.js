(() => {
  const TEXT = {
    "zh-CN": {
      title: "桌宠设置",
      subtitle: "配置通用选项、状态视频和显示效果。",
      restoreAll: "全部恢复默认",
      settingsCategory: "设置分类",
      generalTab: "通用设置",
      videosTab: "状态视频",
      effectsTab: "显示效果",
      language: "界面语言",
      windowScale: "桌宠缩放",
      windowScaleHelp: "可在 10%–200% 之间连续调节，也可按住 Ctrl/Command 滚动鼠标滚轮。",
      edgeFade: "四周羽化",
      edgeFadeHelp: "最外沿透明度固定为 0，向内渐变至完全可见；百分比控制渐变宽度，缩放后效果保持一致。",
      overallOpacity: "整体透明度",
      overallOpacityHelp: "100% 完全可见，0% 完全看不到视频。默认 80%。",
      random: "随机播放",
      sequence: "顺序播放",
      addVideo: "添加视频",
      restoreDefault: "恢复默认",
      noVideo: "尚未添加视频；清空后不会继续播放旧片段。",
      missing: "找不到文件",
      generateMask: "生成 Mask",
      regenerateMask: "重新生成 Mask",
      generating: "正在生成…",
      missingMask: "关联的 Mask 文件不存在，将重新生成。",
      moveUp: "上移",
      moveDown: "下移",
      remove: "删除",
      saveEffectsFailed: "保存显示效果失败",
      saveScaleFailed: "保存缩放设置失败",
      generateMaskFailed: "生成 Mask 失败",
      states: { idle: "空闲", thinking: "思考中", working: "工作中", waiting: "等待操作", review: "完成", failed: "执行失败" },
    },
    en: {
      title: "Desktop Pet Settings",
      subtitle: "Configure general options, status videos, and visual effects.",
      restoreAll: "Restore All Defaults",
      settingsCategory: "Settings categories",
      generalTab: "General",
      videosTab: "Status Videos",
      effectsTab: "Visual Effects",
      language: "Language",
      windowScale: "Pet Scale",
      windowScaleHelp: "Adjust continuously from 10% to 200%, or hold Ctrl/Command while scrolling the mouse wheel.",
      edgeFade: "Edge Feather",
      edgeFadeHelp: "The outer edge stays fully transparent and fades inward; the percentage remains consistent when scaled.",
      overallOpacity: "Overall Opacity",
      overallOpacityHelp: "100% is fully visible; 0% completely hides the video. Default: 80%.",
      random: "Random",
      sequence: "Sequential",
      addVideo: "Add Video",
      restoreDefault: "Restore Default",
      noVideo: "No video has been added. Cleared clips will not continue playing.",
      missing: "File not found",
      generateMask: "Generate Mask",
      regenerateMask: "Regenerate Mask",
      generating: "Generating…",
      missingMask: "The linked Mask file is missing and will be regenerated.",
      moveUp: "Move Up",
      moveDown: "Move Down",
      remove: "Remove",
      saveEffectsFailed: "Failed to save visual effects",
      saveScaleFailed: "Failed to save scale setting",
      generateMaskFailed: "Failed to generate Mask",
      states: { idle: "Idle", thinking: "Thinking", working: "Working", waiting: "Awaiting Input", review: "Done", failed: "Failed" },
    },
  };
  const STATE_IDS = { review: "done" };
  const ORDER = ["idle", "thinking", "working", "waiting", "review", "failed"];
  const root = document.getElementById("states");
  const languageInput = document.getElementById("language");
  const scaleInput = document.getElementById("window-scale");
  const scaleValue = document.getElementById("window-scale-value");
  const edgeFadeInput = document.getElementById("edge-fade-percent");
  const edgeFadeValue = document.getElementById("edge-fade-percent-value");
  const overallInput = document.getElementById("overall-opacity");
  const overallValue = document.getElementById("overall-opacity-value");
  const DEFAULT_EFFECTS = { edgeFadePercent: 12, overallOpacity: 80 };
  let config = { editor: {}, clips: {} };
  let language = "zh-CN";
  let effectsSaveTimer = 0;
  let scaleSaveTimer = 0;

  function t(key) {
    return TEXT[language]?.[key] ?? TEXT["zh-CN"][key] ?? key;
  }

  function stateLabel(state) {
    return TEXT[language]?.states?.[state] || state;
  }

  function applyLanguage(nextLanguage) {
    language = nextLanguage === "en" ? "en" : "zh-CN";
    document.documentElement.lang = language;
    document.title = t("title");
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
      element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
    });
    if (languageInput) languageInput.value = language;
  }

  function editorFor(state) {
    return config.editor?.[state] || { files: [], pick: "random", loop: true };
  }

  function effectsFor() {
    return { ...DEFAULT_EFFECTS, ...(config.effects || {}) };
  }

  function renderEffects() {
    const effects = effectsFor();
    if (edgeFadeInput) edgeFadeInput.value = String(effects.edgeFadePercent);
    if (edgeFadeValue) edgeFadeValue.textContent = `${effects.edgeFadePercent}%`;
    if (overallInput) overallInput.value = String(effects.overallOpacity);
    if (overallValue) overallValue.textContent = `${effects.overallOpacity}%`;
  }

  function renderScale() {
    const percent = Math.round(Number(config.scale) * 100);
    if (!Number.isFinite(percent)) return;
    if (scaleInput) scaleInput.value = String(percent);
    if (scaleValue) scaleValue.textContent = `${percent}%`;
  }

  function render() {
    if (!root) return;
    root.replaceChildren(
      ...ORDER.map((state) => {
        const data = editorFor(state);
        const card = document.createElement("section");
        card.className = "state-card";
        card.dataset.state = state;

        const head = document.createElement("div");
        head.className = "state-head";

        const title = document.createElement("h2");
        title.innerHTML = `${stateLabel(state)} <span class="state-id">${STATE_IDS[state] || state}</span>`;

        const pick = document.createElement("select");
        pick.dataset.action = "pick";
        pick.innerHTML = `<option value="random">${t("random")}</option><option value="sequence">${t("sequence")}</option>`;
        pick.value = data.pick === "sequence" ? "sequence" : "random";

        const add = document.createElement("button");
        add.className = "primary";
        add.dataset.action = "add";
        add.textContent = t("addVideo");

        const restore = document.createElement("button");
        restore.dataset.action = "restore";
        restore.textContent = t("restoreDefault");

        head.append(title, pick, add, restore);

        const list = document.createElement("div");
        list.className = "clip-list";
        const files = Array.isArray(data.files) ? data.files : [];
        if (files.length === 0) {
          const empty = document.createElement("div");
          empty.className = "empty";
          empty.textContent = t("noVideo");
          list.append(empty);
        } else {
          files.forEach((file, index) => {
            const row = document.createElement("div");
            row.className = "clip-row";
            if (file.missing) row.classList.add("missing");

            const name = document.createElement("span");
            name.className = "clip-name";
            name.title = file.path || "";
            name.textContent = file.missing ? `${file.name} (${t("missing")})` : file.name;

            const actions = document.createElement("div");
            actions.className = "clip-actions";

            const mask = document.createElement("button");
            mask.className = "primary";
            mask.dataset.action = "mask";
            mask.dataset.index = String(index);
            mask.disabled = file.missing;
            mask.textContent = file.mask ? t("regenerateMask") : t("generateMask");
            if (file.mask) mask.title = file.maskMissing ? t("missingMask") : file.mask;

            const up = document.createElement("button");
            up.dataset.action = "up";
            up.dataset.index = String(index);
            up.textContent = t("moveUp");
            up.disabled = index === 0;

            const down = document.createElement("button");
            down.dataset.action = "down";
            down.dataset.index = String(index);
            down.textContent = t("moveDown");
            down.disabled = index === files.length - 1;

            const remove = document.createElement("button");
            remove.dataset.action = "remove";
            remove.dataset.index = String(index);
            remove.textContent = t("remove");

            actions.append(mask, up, down, remove);
            row.append(name, actions);
            list.append(row);
          });
        }

        card.append(head, list);
        return card;
      }),
    );
  }

  async function apply(next) {
    if (next) {
      config = { ...config, ...next };
      applyLanguage(config.language || language);
    }
    render();
    renderEffects();
    renderScale();
  }

  async function saveEffects() {
    if (!window.petBridge) return;
    await apply(await window.petBridge.updateMaskEffects({
      edgeFadePercent: Number(edgeFadeInput?.value),
      overallOpacity: Number(overallInput?.value),
    }));
  }

  function scheduleEffectsSave() {
    window.clearTimeout(effectsSaveTimer);
    effectsSaveTimer = window.setTimeout(() => {
      saveEffects().catch((error) => window.alert(error?.message || t("saveEffectsFailed")));
    }, 80);
  }

  function scheduleScaleSave() {
    window.clearTimeout(scaleSaveTimer);
    scaleSaveTimer = window.setTimeout(() => {
      if (!window.petBridge || !scaleInput) return;
      window.petBridge.updateScale(Number(scaleInput.value)).then(apply).catch((error) => {
        window.alert(error?.message || t("saveScaleFailed"));
      });
    }, 40);
  }

  root.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button || !window.petBridge) return;
    const card = button.closest(".state-card");
    if (!card) return;
    const state = card.dataset.state;
    const action = button.dataset.action;
    const index = Number(button.dataset.index);
    if (action === "add") {
      apply(await window.petBridge.addClipFiles(state));
      return;
    }
    if (action === "restore") {
      apply(await window.petBridge.restoreClipState(state));
      return;
    }
    if (action === "remove") {
      apply(await window.petBridge.updateClipState(state, { removeIndex: index }));
      return;
    }
    if (action === "mask") {
      button.disabled = true;
      button.textContent = t("generating");
      try {
        apply(await window.petBridge.generateClipMask(state, index));
      } catch (error) {
        button.disabled = false;
        button.textContent = t("generateMask");
        window.alert(error?.message || t("generateMaskFailed"));
      }
      return;
    }
    if (action === "up") {
      apply(await window.petBridge.updateClipState(state, { from: index, to: index - 1 }));
      return;
    }
    if (action === "down") {
      apply(await window.petBridge.updateClipState(state, { from: index, to: index + 1 }));
    }
  });

  root.addEventListener("change", async (event) => {
    const select = event.target.closest("select");
    if (!select || select.dataset.action !== "pick" || !window.petBridge) return;
    const card = select.closest(".state-card");
    if (!card) return;
    apply(await window.petBridge.updateClipState(card.dataset.state, { pick: select.value }));
  });

  [edgeFadeInput, overallInput].filter(Boolean).forEach((input) => {
    input.addEventListener("input", () => {
      if (input === edgeFadeInput && edgeFadeValue) edgeFadeValue.textContent = `${input.value}%`;
      if (input === overallInput && overallValue) overallValue.textContent = `${input.value}%`;
      scheduleEffectsSave();
    });
    input.addEventListener("change", () => {
      window.clearTimeout(effectsSaveTimer);
      saveEffects().catch((error) => window.alert(error?.message || t("saveEffectsFailed")));
    });
  });

  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item === button));
      document.querySelectorAll(".tab-panel").forEach((panel) => {
        panel.hidden = panel.id !== (button.dataset.tab === "videos" ? "states" : button.dataset.tab);
      });
    });
  });

  if (languageInput) {
    languageInput.addEventListener("change", async () => {
      if (!window.petBridge) return;
      apply(await window.petBridge.updateLanguage(languageInput.value));
    });
  }

  if (scaleInput) {
    scaleInput.addEventListener("input", () => {
      if (scaleValue) scaleValue.textContent = `${scaleInput.value}%`;
      scheduleScaleSave();
    });
    scaleInput.addEventListener("change", () => {
      window.clearTimeout(scaleSaveTimer);
      if (window.petBridge) {
        window.petBridge.updateScale(Number(scaleInput.value)).then(apply).catch((error) => {
          window.alert(error?.message || t("saveScaleFailed"));
        });
      }
    });
  }

  const restoreAll = document.getElementById("restore-all");
  if (restoreAll) {
    restoreAll.addEventListener("click", async () => {
      if (!window.petBridge) return;
      apply(await window.petBridge.restoreClipState("*"));
    });
  }

  if (window.petBridge) {
    window.petBridge.onLanguage((nextLanguage) => {
      applyLanguage(nextLanguage);
      render();
      renderEffects();
    });
    window.petBridge.onScale((nextScale) => {
      config = { ...config, scale: nextScale };
      renderScale();
    });
    window.petBridge.onClipConfig((data) => apply(data));
    window.petBridge.getClipConfig().then(apply).catch(() => apply({ editor: {} }));
  }
})();
