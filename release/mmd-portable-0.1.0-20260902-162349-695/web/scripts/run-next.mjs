import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const nextCliEntrypoint = path.join(rootDir, "node_modules", "next", "dist", "bin", "next");

const command = process.argv[2] || "dev";
const extraArgs = process.argv.slice(3);

const defaultDistDirByCommand = {
  dev: ".next-codex-dev",
  build: ".next-codex-build",
  start: ".next-codex-build",
};

const distDir = process.env.NEXT_DIST_DIR || defaultDistDirByCommand[command] || ".next-codex-dev";
const resolvedDistDir = path.resolve(rootDir, distDir);

if (command === "dev" || command === "build") {
  fs.rmSync(resolvedDistDir, { recursive: true, force: true });
}

fs.mkdirSync(resolvedDistDir, { recursive: true });
fs.writeFileSync(
  path.join(resolvedDistDir, "package.json"),
  `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
  "utf8",
);

const child = spawn(process.execPath, [nextCliEntrypoint, command, ...extraArgs], {
  cwd: rootDir,
  env: {
    ...process.env,
    NEXT_DIST_DIR: distDir,
  },
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
