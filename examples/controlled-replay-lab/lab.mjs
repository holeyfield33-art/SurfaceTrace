import { createServer } from "node:http";

const PORT = Number(process.env.LAB_PORT ?? 4040);
const HOST = process.env.LAB_HOST ?? "127.0.0.1";
const unsafeHost = process.env.LAB_UNSAFE_HOST ?? "";

if (HOST !== "127.0.0.1" && unsafeHost !== "allow-nonloopback") {
  throw new Error(
    "LAB_REFUSED: non-loopback binding requires LAB_UNSAFE_HOST=allow-nonloopback",
  );
}

const routes = {
  "/": json(200, {
    ok: true,
    service: "surfacetrace-controlled-replay-lab",
    routes: [
      "/lab/projects/100",
      "/lab/projects/200",
      "/lab/redirect",
      "/lab/slow",
      "/lab/large",
    ],
  }),
  "/lab/projects/100": json(200, { id: 100, name: "Alpha", owner: "Account A" }),
  "/lab/projects/200": json(200, {
    id: 200,
    name: "Beta",
    owner: "Account B",
  }),
  "/lab/projects/redirect": json(302, null, {
    Location: "/lab/projects/100",
  }),
  "/lab/redirect": json(302, null, { Location: "/lab/projects/100" }),
  "/lab/slow": async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return json(200, { ok: true, note: "slow response" });
  },
  "/lab/large": json(
    200,
    { ok: true, payload: "x".repeat(2048), truncated: true },
  ),
};

const server = createServer(async (request, response) => {
  if (request.method !== "GET") {
    response.writeHead(405, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "method not allowed" }));
    return;
  }
  const handler = routes[request.url ?? ""];
  if (!handler) {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
    return;
  }
  const result = typeof handler === "function" ? await handler() : handler;
  response.writeHead(result.status, {
    "Content-Type": "application/json",
    ...result.headers,
  });
  response.end(result.body);
});

server.listen(PORT, HOST, () => {
  console.log(`Controlled Replay Lab listening on http://${HOST}:${PORT}`);
});

function json(status, value, headers = {}) {
  return {
    status,
    headers,
    body: JSON.stringify(value),
  };
}
