const supportedMajor = 22;
const activeMajor = Number(process.versions.node.split(".")[0]);

if (activeMajor !== supportedMajor) {
  console.error(`
SurfaceTrace requires Node 22, but this terminal is using Node ${process.versions.node}.

Native dependencies such as better-sqlite3 must match the active Node runtime.
Select Node 22, verify with "node --version", run "npm install", then retry.
See README.md under Quick Start for Windows PowerShell instructions.
`);
  process.exit(1);
}

console.log(`SurfaceTrace Node check passed (${process.versions.node}).`);
