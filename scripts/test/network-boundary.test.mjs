import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createServer, loadConfigFromFile } from "vite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const configFile = join(root, "packages", "web", "vite.config.ts");

test("normal development configuration is loopback-only", async () => {
  const [rootPackage, configSource, composeSource] = await Promise.all([
    readFile(join(root, "package.json"), "utf8"),
    readFile(configFile, "utf8"),
    readFile(join(root, "docker-compose.yml"), "utf8"),
  ]);
  assert.doesNotMatch(rootPackage, /(?:--host\s+)?0\.0\.0\.0/);
  const rootScripts = JSON.parse(rootPackage).scripts;
  for (const script of ["predev", "predev:all"]) {
    assert.match(
      rootScripts[script],
      /npm run build --workspace=@surfacetrace\/core/,
    );
  }
  assert.doesNotMatch(configSource, /host:\s*["']0\.0\.0\.0["']/);
  assert.match(
    configSource,
    /SURFACETRACE_WEB_HOST\s*\|\|\s*["']127\.0\.0\.1["']/,
  );
  assert.match(
    composeSource,
    /["']127\.0\.0\.1:5173:5173["']/,
  );
  assert.match(
    composeSource,
    /SURFACETRACE_WEB_HOST:\s*["']0\.0\.0\.0["']/,
  );
  assert.doesNotMatch(
    composeSource,
    /^\s*-\s*["']127\.0\.0\.1:(?:8787|4040):/m,
  );
  for (const workspace of ["core", "server", "web"]) {
    assert.match(
      composeSource,
      new RegExp(
        `surfacetrace-${workspace}-node-modules:/workspace/SurfaceTrace/packages/${workspace}/node_modules`,
      ),
    );
  }

  const loaded = await loadConfigFromFile(
    { command: "serve", mode: "test" },
    configFile,
  );
  assert.ok(loaded);
  const server = await createServer({
    ...loaded.config,
    configFile: false,
    server: { ...loaded.config.server, port: 0, strictPort: false },
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    assert.ok(address && typeof address === "object");
    assert.equal(address.address, "127.0.0.1");
  } finally {
    await server.close();
  }
});
