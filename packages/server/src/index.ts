import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);
if (!loopbackHosts.has(host) && !process.env.SURFACETRACE_API_TOKEN) {
  throw new Error(
    "Non-loopback HOST requires SURFACETRACE_API_TOKEN with at least 32 characters",
  );
}

const app = buildApp({
  maxBodyBytes: Number(process.env.MAX_HAR_BODY_BYTES ?? 10 * 1024 * 1024),
  maxHarEntries: Number(process.env.MAX_HAR_ENTRIES ?? 5000),
  allowedOrigins: (process.env.CORS_ORIGINS ?? "http://127.0.0.1:5173,http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
});

try {
  await app.listen({ port, host });
  console.log(`SurfaceTrace server listening on http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
