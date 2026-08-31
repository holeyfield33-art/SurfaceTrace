import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

describe("controlled replay lab", () => {
  afterEach(() => {
    delete process.env.LAB_HOST;
    delete process.env.LAB_UNSAFE_HOST;
  });

  it("binds to loopback by default and serves deterministic routes", async () => {
    const { server, url } = await startLab();
    try {
      assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
      const baseline = await fetchJson(`${url}/lab/projects/100`);
      assert.deepEqual(baseline, {
        id: 100,
        name: "Alpha",
        owner: "Account A",
      });
      const redirect = await fetch(`${url}/lab/redirect`, {
        redirect: "manual",
      });
      assert.equal(redirect.status, 302);
      assert.equal(redirect.headers.get("location"), "/lab/projects/100");
    } finally {
      await closeServer(server);
    }
  });

  it("rejects non-loopback binding unless explicitly overridden", () => {
    const result = spawnSync(process.execPath, ["lab.mjs"], {
      cwd: dirname(here),
      env: {
        ...process.env,
        LAB_HOST: "0.0.0.0",
        LAB_UNSAFE_HOST: "",
      },
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}${result.stdout}`, /non-loopback/i);
  });

  it("serves a route from the actual lab executable", async () => {
    const port = await availablePort();
    const child = spawn(process.execPath, ["lab.mjs"], {
      cwd: dirname(here),
      env: { ...process.env, LAB_PORT: String(port) },
      stdio: "ignore",
    });
    try {
      const response = await waitForResponse(
        `http://127.0.0.1:${port}/lab/projects/100`,
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        id: 100,
        name: "Alpha",
        owner: "Account A",
      });
    } finally {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
  });
});

async function availablePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = address.port;
  await closeServer(server);
  return port;
}

async function waitForResponse(url) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      return await fetch(url);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`Lab did not start at ${url}`);
}

async function startLab() {
  const server = createServer((request, response) => {
    if (request.method !== "GET") {
      response.writeHead(405, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "method not allowed" }));
      return;
    }
    const url = request.url ?? "";
    if (url === "/lab/projects/100") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ id: 100, name: "Alpha", owner: "Account A" }));
      return;
    }
    if (url === "/lab/redirect") {
      response.writeHead(302, { Location: "/lab/projects/100" });
      response.end();
      return;
    }
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;
  return { server, url };
}

async function fetchJson(url) {
  const response = await fetch(url);
  return response.json();
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}
