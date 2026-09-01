import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const runtime = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const token = runtime.SURFACETRACE_API_TOKEN;
  if (token && token.length < 32)
    throw new Error("SURFACETRACE_API_TOKEN must be at least 32 characters");

  const host = runtime.SURFACETRACE_WEB_HOST || "127.0.0.1";
  const codespaceHost = runtime.CODESPACE_NAME
    ? `${runtime.CODESPACE_NAME}-5173.${runtime.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || "app.github.dev"}`
    : null;
  const configuredHosts = (runtime.SURFACETRACE_ALLOWED_HOSTS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const allowedHosts = [
    "localhost",
    "127.0.0.1",
    ...(codespaceHost ? [codespaceHost] : []),
    ...configuredHosts,
  ];

  const apiProxy = {
    "/api": {
      target: "http://127.0.0.1:8787",
      changeOrigin: true,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      rewrite: (path: string) => path.replace(/^\/api/, ""),
    },
    "/lab": {
      target: "http://127.0.0.1:4040",
      changeOrigin: true,
    },
  };

  return {
    plugins: [react()],
    server: {
      host,
      port: 5173,
      strictPort: true,
      allowedHosts,
      proxy: apiProxy,
    },
    preview: {
      host,
      port: 5173,
      strictPort: true,
      allowedHosts,
      proxy: apiProxy,
    },
  };
});
