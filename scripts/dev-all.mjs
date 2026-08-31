import { spawn } from "node:child_process";
import process from "node:process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const services = [
  ["api", ["run", "dev", "--workspace=@surfacetrace/server"]],
  ["web", ["run", "dev", "--workspace=@surfacetrace/web"]],
  ["lab", ["run", "lab"]],
];
const children = new Map();
let stopping = false;

for (const [name, args] of services) {
  const child = spawn(npm, args, {
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  children.set(name, child);
  child.once("error", (error) => stop(1, `${name} failed to start: ${error.message}`));
  child.once("exit", (code, signal) => {
    if (!stopping)
      stop(
        code ?? 1,
        `${name} exited unexpectedly (${signal ?? `code ${code ?? 1}`})`,
      );
  });
}

process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));

function stop(exitCode, reason) {
  if (stopping) return;
  stopping = true;
  if (reason) console.error(reason);
  for (const child of children.values())
    if (child.exitCode === null && !child.killed) child.kill();
  process.exitCode = exitCode;
}
