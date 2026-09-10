(() => {
  const TEXT = {
    "zh-CN": {
      title: "桌宠设置",
      subtitle: "配置通用选项、Agent Hook、状态视频和显示效果。",
      restoreAll: "全部恢复默认",
      settingsCategory: "设置分类",
      generalTab: "通用设置",
      agentsTab: "Agent 设置",
      videosTab: "状态视频",
      effectsTab: "显示效果",
      language: "界面语言",
      windowScale: "桌宠缩放",
      windowScaleHelp: "可在 10%–200% 之间连续调节，也可按住 Ctrl/Command 滚动鼠标滚轮。",
      mousePassthrough: "允许鼠标穿透",
      mousePassthroughHelp: "开启后，鼠标可穿过桌宠的透明区域操作下方窗口；关闭后，桌宠窗口会接收范围内的鼠标操作。",
      videoToggleShortcut: "视频显隐快捷键：Alt + V。",
      agentsHelp: "会把桌宠通知 Hook 合并进各 Agent 的用户配置，不会整份覆盖已有 Hook。安装后如需信任，请在对应 Agent 里运行 /hooks。",
      installAllHooks: "一键配置全部",
      uninstallAllHooks: "全部移除",
      installHooks: "安装 / 更新",
      uninstallHooks: "移除",
      hookInstalled: "已安装",
      hookPartial: "部分安装",
      hookMissing: "未安装",
      hookError: "配置损坏",
      hookBusy: "正在写入…",
      hookInstallFailed: "安装 Hook 失败",
      hookUninstallFailed: "移除 Hook 失败",
      hookLoadFailed: "读取 Hook 状态失败",
      agentNotes: {
        codex: "写入 ~/.codex/hooks.json。安装后请在 Codex 运行 /hooks 并信任新命令。",
        cursor: "写入用户级 ~/.cursor/hooks.json。保存后会自动重载；若未生效请重启 Cursor。",
        "codely-cli": "写入 ~/.codely-cli/extensions/desktop-pet（扩展级 Hook，不走项目信任拦截），并打开 settings.json 的 hooks.enabled。请重启 Codely CLI 后运行 /hooks 确认。",
        "claude-code": "合并进 ~/.claude/settings.json，不会覆盖其他设置。可在 Claude Code 运行 /hooks 确认。",
      },
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
      states: { idle: "空闲", waiting: "等待确认", working: "工作中", completed: "完成" },
    },
    en: {
      title: "Desktop Pet Settings",
      subtitle: "Configure general options, agent hooks, status videos, and visual effects.",
      restoreAll: "Restore All Defaults",
      settingsCategory: "Settings categories",
      generalTab: "General",
      agentsTab: "Agents",
      videosTab: "Status Videos",
      effectsTab: "Visual Effects",
      language: "Language",
      windowScale: "Pet Scale",
      windowScaleHelp: "Adjust continuously from 10% to 200%, or hold Ctrl/Command while scrolling the mouse wheel.",
      mousePassthrough: "Allow Mouse Click-Through",
      mousePassthroughHelp: "When enabled, the pointer can pass through transparent pet areas to the window underneath. When disabled, the pet window receives pointer input within its bounds.",
      videoToggleShortcut: "Show/hide video shortcut: Alt + V.",
      agentsHelp: "Merges the desktop-pet notify hook into each agent's user config without replacing existing hooks. If trust is required, run /hooks in that agent.",
      installAllHooks: "Configure All",
      uninstallAllHooks: "Remove All",
      installHooks: "Install / Update",
      uninstallHooks: "Remove",
      hookInstalled: "Installed",
      hookPartial: "Partial",
      hookMissing: "Not installed",
      hookError: "Broken config",
      hookBusy: "Writing…",
      hookInstallFailed: "Failed to install hooks",
      hookUninstallFailed: "Failed to remove hooks",
      hookLoadFailed: "Failed to load hook status",
      agentNotes: {
        codex: "Writes ~/.codex/hooks.json. After install, run /hooks in Codex and trust the new commands.",
        cursor: "Writes user hooks to ~/.cursor/hooks.json. Cursor reloads on save; restart Cursor if they do not appear.",
        "codely-cli": "Installs ~/.codely-cli/extensions/desktop-pet (extension hooks skip project trust) and sets hooks.enabled. Restart Codely CLI, then run /hooks to confirm.",
        "claude-code": "Merges into ~/.claude/settings.json without replacing other settings. Confirm with /hooks in Claude Code.",
      },
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
      states: { idle: "Idle", waiting: "Needs Input", working: "Working", completed: "Done" },
    },
  };
  const STATE_IDS = {};
  const ORDER = ["idle", "waiting", "working", "completed"];
  const root = document.getElementById("states");
  const languageInput = document.getElementById("language");
  const scaleInput = document.getElementById("window-scale");
  const scaleValue = document.getElementById("window-scale-value");
  const mousePassthroughInput = document.getElementById("mouse-passthrough");
  const edgeFadeInput = document.getElementById("edge-fade-percent");
  const edgeFadeValue = document.getElementById("edge-fade-percent-value");
  const overallInput = document.getElementById("overall-opacity");
  const overallValue = document.getElementById("overall-opacity-value");
  const agentsList = document.getElementById("agents-list");
  const agentsLog = document.getElementById("agents-log");
  const DEFAULT_EFFECTS = { edgeFadePercent: 12, overallOpacity: 80 };
  let config = { editor: {}, clips: {} };
  let language = "zh-CN";
  let effectsSaveTimer = 0;
  let scaleSaveTimer = 0;
  let hookStatus = { agents: [] };
  let hooksBusy = false;

  function t(key) {
    return TEXT[language]?.[key] ?? TEXT["zh-CN"][key] ?? key;
  }

  function stateLabel(state) {
    return TEXT[language]?.states?.[state] || state;
  }

  function hookStatusLabel(status) {
    if (status === "installed") return t("hookInstalled");
    if (status === "partial") return t("hookPartial");
    if (status === "error") return t("hookError");
    return t("hookMissing");
  }

  function agentNoteText(id) {
    return TEXT[language]?.agentNotes?.[id] || TEXT["zh-CN"].agentNotes?.[id] || "";
  }

  function setAgentsLog(message) {
    if (!agentsLog) return;
    if (!message) {
      agentsLog.hidden = true;
      agentsLog.textContent = "";
      return;
    }
    agentsLog.hidden = false;
    agentsLog.textContent = message;
  }

  function renderAgents() {
    if (!agentsList) return;
    const agents = Array.isArray(hookStatus.agents) ? hookStatus.agents : [];
    agentsList.replaceChildren(
      ...agents.map((agent) => {
        const card = document.createElement("section");
        card.className = "agent-card";
        card.dataset.agent = agent.id;

        const head = document.createElement("div");
        head.className = "agent-head";
        const title = document.createElement("h2");
        title.textContent = agent.name;
        const status = document.createElement("span");
        status.className = `agent-status ${agent.status || "missing"}`;
        status.textContent = hookStatusLabel(agent.status);
        head.append(title, status);

        const pathLine = document.createElement("p");
        pathLine.className = "agent-path";
        pathLine.textContent = agent.displayPath || agent.configPath || "";

        const note = document.createElement("p");
        note.className = "agent-note";
        note.textContent = agent.error || agentNoteText(agent.id);

        const actions = document.createElement("div");
        actions.className = "agent-actions";
        const install = document.createElement("button");
        install.className = "primary";
        install.dataset.action = "install";
        install.disabled = hooksBusy;
        install.textContent = hooksBusy ? t("hookBusy") : t("installHooks");
        const uninstall = document.createElement("button");
        uninstall.dataset.action = "uninstall";
        uninstall.disabled = hooksBusy || agent.status === "missing";
        uninstall.textContent = t("uninstallHooks");
        actions.append(install, uninstall);

        card.append(head, pathLine, note, actions);
        return card;
      }),
    );
    ["install-all-hooks", "uninstall-all-hooks"].forEach((id) => {
      const button = document.getElementById(id);
      if (button) button.disabled = hooksBusy;
    });
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

  function renderMousePassthrough() {
    if (mousePassthroughInput) mousePassthroughInput.checked = config.mousePassthrough !== false;
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
    renderMousePassthrough();
    renderAgents();
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

  if (mousePassthroughInput) {
    mousePassthroughInput.addEventListener("change", () => {
      if (!window.petBridge) return;
      window.petBridge.updateMousePassthrough(mousePassthroughInput.checked).then(apply).catch((error) => {
        window.alert(error?.message || "Failed to update mouse click-through");
      });
    });
  }

  const restoreAll = document.getElementById("restore-all");
  if (restoreAll) {
    restoreAll.addEventListener("click", async () => {
      if (!window.petBridge) return;
      apply(await window.petBridge.restoreClipState("*"));
    });
  }

  async function loadHooks() {
    if (!window.petBridge?.getHookStatus) return;
    hookStatus = await window.petBridge.getHookStatus();
    renderAgents();
  }

  async function runHookAction(action, agentId) {
    if (!window.petBridge || hooksBusy) return;
    hooksBusy = true;
    renderAgents();
    try {
      const next = action === "uninstall"
        ? await window.petBridge.uninstallHooks(agentId)
        : await window.petBridge.installHooks(agentId);
      hookStatus = next;
      const written = (next.results || []).map((item) => item.configPath).filter(Boolean);
      setAgentsLog(written.join("\n"));
      renderAgents();
    } catch (error) {
      renderAgents();
      window.alert(error?.message || (action === "uninstall" ? t("hookUninstallFailed") : t("hookInstallFailed")));
    } finally {
      hooksBusy = false;
      renderAgents();
    }
  }

  if (agentsList) {
    agentsList.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      const card = button.closest(".agent-card");
      if (!card) return;
      runHookAction(button.dataset.action, card.dataset.agent);
    });
  }

  const installAll = document.getElementById("install-all-hooks");
  if (installAll) {
    installAll.addEventListener("click", () => runHookAction("install", "*"));
  }
  const uninstallAll = document.getElementById("uninstall-all-hooks");
  if (uninstallAll) {
    uninstallAll.addEventListener("click", () => runHookAction("uninstall", "*"));
  }

  if (window.petBridge) {
    window.petBridge.onLanguage((nextLanguage) => {
      applyLanguage(nextLanguage);
      render();
      renderEffects();
      renderAgents();
    });
    window.petBridge.onScale((nextScale) => {
      config = { ...config, scale: nextScale };
      renderScale();
    });
    window.petBridge.onClipConfig((data) => apply(data));
    window.petBridge.getClipConfig().then(apply).catch(() => apply({ editor: {} }));
    loadHooks().catch((error) => {
      setAgentsLog(error?.message || t("hookLoadFailed"));
    });
  }
})();
