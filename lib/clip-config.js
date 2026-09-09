"use strict";

const fs = require("node:fs");
const path = require("node:path");

const STATES = ["idle", "working", "completed"];
const LOOP_DEFAULT = {
  idle: true,
  working: true,
  completed: true,
};
const DEFAULT_MASK_EFFECTS = {
  edgeFadePercent: 12,
  overallOpacity: 80,
};

function pathToFileUrl(filePath) {
  const resolved = path.resolve(filePath).replace(/\\/g, "/");
  return encodeURI(`file:///${resolved}`);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function fileList(clip) {
  if (!clip || typeof clip !== "object") return [];
  if (Array.isArray(clip.files)) return clip.files.map(String).filter(Boolean);
  if (clip.file) return [String(clip.file)];
  return [];
}

function normalizeMaskEffects(value) {
  const configuredPercent = Number(value?.edgeFadePercent);
  const legacyPx = Number(value?.edgeFadePx);
  const edgeFadePercent = Number.isFinite(configuredPercent)
    ? configuredPercent
    : Number.isFinite(legacyPx)
      ? legacyPx / 4
      : DEFAULT_MASK_EFFECTS.edgeFadePercent;
  const overallOpacity = Math.round(Number(value?.overallOpacity));
  return {
    edgeFadePercent: Math.min(50, Math.max(0, Math.round(edgeFadePercent))),
    overallOpacity: Number.isFinite(overallOpacity)
      ? Math.min(100, Math.max(0, overallOpacity))
      : DEFAULT_MASK_EFFECTS.overallOpacity,
  };
}

function maskMap(clip) {
  if (!clip?.masks || typeof clip.masks !== "object" || Array.isArray(clip.masks)) return {};
  return Object.fromEntries(
    Object.entries(clip.masks)
      .filter(([file, mask]) => file && typeof mask === "string" && mask)
      .map(([file, mask]) => [String(file), mask]),
  );
}

function normalizeClip(clip, state) {
  return {
    files: fileList(clip),
    masks: maskMap(clip),
    loop: typeof clip?.loop === "boolean" ? clip.loop : Boolean(LOOP_DEFAULT[state]),
    pick: clip?.pick === "sequence" ? "sequence" : "random",
    next: clip?.next || (!LOOP_DEFAULT[state] ? "idle" : undefined),
  };
}

function resolveExisting(file, petDir) {
  const abs = path.isAbsolute(file) ? file : path.join(petDir, file);
  const resolved = path.resolve(abs);
  return { original: file, abs: resolved, exists: fs.existsSync(resolved) };
}

function loadDefaultManifest(petDir) {
  const raw = readJson(path.join(petDir, "manifest.json")) || {};
  const clips = {};
  for (const state of STATES) {
    clips[state] = normalizeClip(raw.clips?.[state], state);
  }
  return {
    size: Array.isArray(raw.size) ? raw.size : [360, 360],
    clips,
  };
}

function loadUserClips(userConfigPath) {
  const raw = readJson(userConfigPath);
  if (!raw || typeof raw !== "object") return {};
  const source = raw.clips && typeof raw.clips === "object" ? raw.clips : raw;
  const clips = {};
  for (const state of STATES) {
    const legacy = state === "completed" && fileList(source.review).length ? source.review : null;
    if (source[state] || legacy) clips[state] = normalizeClip(source[state] || legacy, state);
  }
  return clips;
}

function mergedClips(petDir, userConfigPath) {
  const defaults = loadDefaultManifest(petDir);
  const user = loadUserClips(userConfigPath);
  const clips = {};
  for (const state of STATES) {
    clips[state] = user[state] ? { ...defaults.clips[state], ...user[state] } : defaults.clips[state];
  }
  const rawUser = readJson(userConfigPath);
  return { ...defaults, clips, effects: normalizeMaskEffects(rawUser?.effects) };
}

function loadClipConfig({ petDir, userConfigPath }) {
  const merged = mergedClips(petDir, userConfigPath);
  const files = {};
  const missing = {};
  const masks = {};
  const editor = {};
  const clips = {};

  for (const state of STATES) {
    const clip = merged.clips[state];
    const resolved = clip.files.map((file) => resolveExisting(file, petDir));
    const present = resolved.filter((row) => row.exists);
    files[state] = present.map((row) => pathToFileUrl(row.abs));
    masks[state] = {};
    for (const row of present) {
      const mask = clip.masks[row.original];
      if (!mask) continue;
      const resolvedMask = resolveExisting(mask, petDir);
      if (resolvedMask.exists) masks[state][pathToFileUrl(row.abs)] = pathToFileUrl(resolvedMask.abs);
    }
    missing[state] = resolved.filter((row) => !row.exists).map((row) => row.original);
    clips[state] = {
      files: clip.files,
      loop: clip.loop,
      pick: clip.pick,
      next: clip.next,
    };
    editor[state] = {
      loop: clip.loop,
      pick: clip.pick,
      files: resolved.map((row) => ({
        path: row.abs,
        name: path.basename(row.abs),
        missing: !row.exists,
        mask: clip.masks[row.original] || "",
        maskMissing: Boolean(clip.masks[row.original]) && !resolveExisting(clip.masks[row.original], petDir).exists,
      })),
    };
  }

  return {
    size: merged.size,
    clips,
    files,
    missing,
    masks,
    editor,
    states: STATES,
    effects: merged.effects,
  };
}

function writeUserClips(userConfigPath, userClips) {
  const existing = readJson(userConfigPath) || {};
  fs.mkdirSync(path.dirname(userConfigPath), { recursive: true });
  fs.writeFileSync(userConfigPath, `${JSON.stringify({ ...existing, clips: userClips }, null, 2)}\n`);
}

function updateMaskEffects(petDir, userConfigPath, patch = {}) {
  const existing = readJson(userConfigPath) || {};
  const effects = normalizeMaskEffects({ ...existing.effects, ...patch });
  fs.mkdirSync(path.dirname(userConfigPath), { recursive: true });
  fs.writeFileSync(userConfigPath, `${JSON.stringify({ ...existing, effects }, null, 2)}\n`);
  return loadClipConfig({ petDir, userConfigPath });
}

function saveState(petDir, userConfigPath, state, patch) {
  if (!STATES.includes(state)) return loadClipConfig({ petDir, userConfigPath });
  const merged = mergedClips(petDir, userConfigPath);
  const user = loadUserClips(userConfigPath);
  const current = merged.clips[state];
  const files = Array.isArray(patch.files) ? patch.files.filter(Boolean) : current.files;
  const masks = patch.masks && typeof patch.masks === "object" ? patch.masks : current.masks;
  user[state] = {
    files,
    masks,
    loop: typeof patch.loop === "boolean" ? patch.loop : current.loop,
    pick: patch.pick === "sequence" || patch.pick === "random" ? patch.pick : current.pick,
  };
  writeUserClips(userConfigPath, user);
  return loadClipConfig({ petDir, userConfigPath });
}

function addClipFiles(petDir, userConfigPath, state, paths) {
  if (!STATES.includes(state)) return loadClipConfig({ petDir, userConfigPath });
  const merged = mergedClips(petDir, userConfigPath);
  const current = [...merged.clips[state].files];
  const seen = new Set(current.map((file) => resolveExisting(file, petDir).abs.toLowerCase()));
  for (const file of paths || []) {
    const abs = path.resolve(file);
    if (!seen.has(abs.toLowerCase())) {
      current.push(abs);
      seen.add(abs.toLowerCase());
    }
  }
  return saveState(petDir, userConfigPath, state, { files: current });
}

function updateClipState(petDir, userConfigPath, state, patch = {}) {
  if (!STATES.includes(state)) return loadClipConfig({ petDir, userConfigPath });
  const merged = mergedClips(petDir, userConfigPath);
  let files = [...merged.clips[state].files];
  const masks = { ...merged.clips[state].masks };
  if (Number.isInteger(patch.removeIndex) && patch.removeIndex >= 0 && patch.removeIndex < files.length) {
    const [removed] = files.splice(patch.removeIndex, 1);
    if (removed) delete masks[removed];
  }
  if (Number.isInteger(patch.from) && Number.isInteger(patch.to) && patch.from !== patch.to) {
    if (patch.from >= 0 && patch.from < files.length) {
      const [item] = files.splice(patch.from, 1);
      const target = Math.max(0, Math.min(files.length, patch.to));
      if (item) files.splice(target, 0, item);
    }
  }
  if (Array.isArray(patch.files)) files = patch.files.filter(Boolean);
  return saveState(petDir, userConfigPath, state, {
    files,
    masks,
    pick: patch.pick,
    loop: patch.loop,
  });
}

function clipFileAt(petDir, userConfigPath, state, index) {
  if (!STATES.includes(state) || !Number.isInteger(index)) return null;
  const merged = mergedClips(petDir, userConfigPath);
  const file = merged.clips[state].files[index];
  if (!file) return null;
  return resolveExisting(file, petDir);
}

function setClipMask(petDir, userConfigPath, state, index, maskPath) {
  if (!STATES.includes(state) || !Number.isInteger(index)) return loadClipConfig({ petDir, userConfigPath });
  const merged = mergedClips(petDir, userConfigPath);
  const files = [...merged.clips[state].files];
  const file = files[index];
  if (!file) return loadClipConfig({ petDir, userConfigPath });
  const masks = { ...merged.clips[state].masks, [file]: path.resolve(maskPath) };
  return saveState(petDir, userConfigPath, state, { files, masks });
}

function restoreClipState(petDir, userConfigPath, state) {
  const user = loadUserClips(userConfigPath);
  if (!state || state === "*") {
    writeUserClips(userConfigPath, {});
    return loadClipConfig({ petDir, userConfigPath });
  }
  if (!STATES.includes(state)) return loadClipConfig({ petDir, userConfigPath });
  delete user[state];
  writeUserClips(userConfigPath, user);
  return loadClipConfig({ petDir, userConfigPath });
}

module.exports = {
  STATES,
  pathToFileUrl,
  loadClipConfig,
  addClipFiles,
  clipFileAt,
  updateClipState,
  setClipMask,
  updateMaskEffects,
  restoreClipState,
};
