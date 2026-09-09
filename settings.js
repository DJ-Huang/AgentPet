(() => {
  const LABELS = {
    idle: "空闲",
    thinking: "思考",
    working: "工作",
    waiting: "等待",
    review: "回顾",
    failed: "失败",
  };
  const ORDER = ["idle", "thinking", "working", "waiting", "review", "failed"];
  const root = document.getElementById("states");
  let config = { editor: {}, clips: {} };

  function editorFor(state) {
    return config.editor?.[state] || { files: [], pick: "random", loop: true };
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
        title.innerHTML = `${LABELS[state] || state} <span class="state-id">${state}</span>`;

        const pick = document.createElement("select");
        pick.dataset.action = "pick";
        pick.innerHTML = '<option value="random">随机</option><option value="sequence">依次</option>';
        pick.value = data.pick === "sequence" ? "sequence" : "random";

        const add = document.createElement("button");
        add.className = "primary";
        add.dataset.action = "add";
        add.textContent = "添加视频";

        const restore = document.createElement("button");
        restore.dataset.action = "restore";
        restore.textContent = "恢复默认";

        head.append(title, pick, add, restore);

        const list = document.createElement("div");
        list.className = "clip-list";
        const files = Array.isArray(data.files) ? data.files : [];
        if (files.length === 0) {
          const empty = document.createElement("div");
          empty.className = "empty";
          empty.textContent = "还没有视频，清空后不会继续播旧片段";
          list.append(empty);
        } else {
          files.forEach((file, index) => {
            const row = document.createElement("div");
            row.className = "clip-row";
            if (file.missing) row.classList.add("missing");

            const name = document.createElement("span");
            name.className = "clip-name";
            name.title = file.path || "";
            name.textContent = file.missing ? `${file.name}（找不到）` : file.name;

            const actions = document.createElement("div");
            actions.className = "clip-actions";

            const mask = document.createElement("button");
            mask.className = "primary";
            mask.dataset.action = "mask";
            mask.dataset.index = String(index);
            mask.disabled = file.missing;
            mask.textContent = file.mask ? "重新生成 Mask" : "生成 Mask";
            if (file.mask) mask.title = file.maskMissing ? "已关联的 Mask 文件找不到，将重新生成" : file.mask;

            const up = document.createElement("button");
            up.dataset.action = "up";
            up.dataset.index = String(index);
            up.textContent = "上移";
            up.disabled = index === 0;

            const down = document.createElement("button");
            down.dataset.action = "down";
            down.dataset.index = String(index);
            down.textContent = "下移";
            down.disabled = index === files.length - 1;

            const remove = document.createElement("button");
            remove.dataset.action = "remove";
            remove.dataset.index = String(index);
            remove.textContent = "删除";

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
    if (next) config = next;
    render();
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
      button.textContent = "正在生成…";
      try {
        apply(await window.petBridge.generateClipMask(state, index));
      } catch (error) {
        button.disabled = false;
        button.textContent = "生成 Mask";
        window.alert(error?.message || "生成 Mask 失败");
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

  const restoreAll = document.getElementById("restore-all");
  if (restoreAll) {
    restoreAll.addEventListener("click", async () => {
      if (!window.petBridge) return;
      apply(await window.petBridge.restoreClipState("*"));
    });
  }

  if (window.petBridge) {
    window.petBridge.onClipConfig((data) => apply(data));
    window.petBridge.getClipConfig().then(apply).catch(() => apply({ editor: {} }));
  }
})();
