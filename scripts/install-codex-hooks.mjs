import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { installHooks } = require("../lib/agent-hooks.js");

const target = process.argv[2] || "*";
const results = installHooks(target);
for (const result of results) {
  console.log(`Wrote ${result.configPath}`);
  if (result.backupPath) console.log(`Backup ${result.backupPath}`);
  console.log(`${result.id}: ${result.coverage.status}`);
}
console.log("Restart the agent after install. Codex / Claude Code may ask you to trust new commands via /hooks.");
