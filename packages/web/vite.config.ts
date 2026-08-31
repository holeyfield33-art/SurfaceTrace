import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const token = loadEnv(mode, process.cwd(), "").SURFACETRACE_API_TOKEN;
  if (token && token.length < 32)
    throw new Error("SURFACETRACE_API_TOKEN must be at least 32 characters");

  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8787",
          changeOrigin: true,
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
  };
});
