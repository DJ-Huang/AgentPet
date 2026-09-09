import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PET_DIR = path.join(ROOT, "assets", "pet");
const TRAY = path.join(ROOT, "assets", "tray.png");

const CLIPS = [
  { name: "idle", r: 94, g: 196, b: 214 },
  { name: "thinking", r: 232, g: 196, b: 88 },
  { name: "working", r: 110, g: 196, b: 120 },
  { name: "waiting", r: 232, g: 156, b: 72 },
  { name: "review", r: 176, g: 132, b: 220 },
  { name: "failed", r: 220, g: 88, b: 88 },
];

function run(args) {
  const result = spawnSync("ffmpeg", args, { stdio: "inherit", windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed: ${args.join(" ")}`);
  }
}

fs.mkdirSync(PET_DIR, { recursive: true });

for (const clip of CLIPS) {
  const out = path.join(PET_DIR, `${clip.name}.webm`);
  const vf = `geq=r=${clip.r}:g=${clip.g}:b=${clip.b}:a='if(lt(hypot(X-180\\,Y-200)\\,96+10*sin(3.1416*T))\\,230\\,0)',format=yuva420p`;
  run([
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=black@0.0:s=360x360:d=2:r=12,format=rgba",
    "-vf",
    vf,
    "-c:v",
    "libvpx-vp9",
    "-pix_fmt",
    "yuva420p",
    "-auto-alt-ref",
    "0",
    "-b:v",
    "0",
    "-crf",
    "38",
    "-an",
    out,
  ]);
}

run([
  "-y",
  "-f",
  "lavfi",
  "-i",
  "color=c=0x5EC8E3:s=32x32:d=0.04",
  "-frames:v",
  "1",
  TRAY,
]);

console.log(`Wrote placeholder clips in ${PET_DIR}`);
console.log(`Wrote ${TRAY}`);
