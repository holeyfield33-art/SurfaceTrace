import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const expected = ["packages/core", "packages/server", "packages/web"];
const configured = new Set(manifest.workspaces ?? []);

for (const workspace of expected) {
  if (!configured.has("packages/*"))
    throw new Error(`Expected workspace glob packages/* is missing for ${workspace}`);
  const packageManifest = JSON.parse(
    readFileSync(join(root, workspace, "package.json"), "utf8"),
  );
  if (!packageManifest.scripts?.lint)
    throw new Error(`${workspace} must define a lint script`);
}

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is required to run workspace linting");
const result = spawnSync(process.execPath, [npmCli, "run", "lint", "--workspaces", "--if-present"], {
  cwd: root,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
