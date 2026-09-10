"use strict";

const { spawn } = require("node:child_process");

function normalizeAppName(value) {
  return String(value || "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\.exe$/i, "")
    .toLowerCase();
}

function normalizeExcludedApps(value) {
  const entries = Array.isArray(value) ? value : String(value || "").split(/[\r\n,;]+/);
  return [...new Set(entries.map(normalizeAppName).filter(Boolean))];
}

function isAppExcluded(appName, excludedApps) {
  const normalized = normalizeAppName(appName);
  return Boolean(normalized && normalizeExcludedApps(excludedApps).includes(normalized));
}

function normalizeVisibleApps(value) {
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  const seen = new Set();
  return rows
    .map((row) => ({
      pid: Number(row?.Id || row?.pid || 0),
      name: String(row?.ProcessName || row?.name || "").trim(),
      title: String(row?.MainWindowTitle || row?.title || "").trim(),
    }))
    .filter((row) => {
      const key = normalizeAppName(row.name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function listVisibleApps({ platform = process.platform, spawnProcess = spawn } = {}) {
  if (platform !== "win32") return Promise.resolve([]);
  const script = "Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.ProcessName } | Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress";
  return new Promise((resolve, reject) => {
    const child = spawnProcess("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let errorOutput = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { output += chunk; });
    child.stderr?.on("data", (chunk) => { errorOutput += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) return reject(new Error(errorOutput.trim() || `App listing exited with code ${code}`));
      try {
        resolve(normalizeVisibleApps(output.trim() ? JSON.parse(output) : []));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function createForegroundAppWatcher({ platform = process.platform, onChange, spawnProcess = spawn } = {}) {
  if (platform !== "win32") return { start() {}, stop() {}, supported: false };

  let child = null;
  let stopped = false;
  let restartTimer = null;
  let pending = "";

  const script = [
    "$signature = '[DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);'",
    "Add-Type -MemberDefinition $signature -Name NativeMethods -Namespace DesktopPet",
    "$last = ''",
    "while ($true) {",
    "  $handle = [DesktopPet.NativeMethods]::GetForegroundWindow()",
    "  [uint32]$processId = 0",
    "  [void][DesktopPet.NativeMethods]::GetWindowThreadProcessId($handle, [ref]$processId)",
    "  try { $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName } catch { $processName = '' }",
    "  $current = \"$processId`t$processName\"",
    "  if ($current -ne $last) { [Console]::Out.WriteLine($current); [Console]::Out.Flush(); $last = $current }",
    "  Start-Sleep -Milliseconds 500",
    "}",
  ].join("\n");

  function launch() {
    if (stopped || child) return;
    child = spawnProcess("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || "";
      for (const line of lines) {
        const [pidText, ...nameParts] = line.split("\t");
        const pid = Number(pidText);
        const name = nameParts.join("\t").trim();
        if (Number.isFinite(pid) && pid > 0 && name) onChange?.({ pid, name });
      }
    });
    child.once("error", () => {});
    child.once("close", () => {
      child = null;
      if (!stopped) restartTimer = setTimeout(launch, 1500);
    });
  }

  return {
    supported: true,
    start() {
      stopped = false;
      launch();
    },
    stop() {
      stopped = true;
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = null;
      if (child) child.kill();
      child = null;
    },
  };
}

module.exports = { createForegroundAppWatcher, isAppExcluded, listVisibleApps, normalizeAppName, normalizeExcludedApps, normalizeVisibleApps };
