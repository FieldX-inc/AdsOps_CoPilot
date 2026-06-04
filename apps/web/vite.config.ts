import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  envDir: resolve(__dirname, "../.."),
  server: {
    allowedHosts: [".ngrok-free.app", ".ngrok-free.dev"],
    proxy: {
      "/agent": "http://localhost:8787",
      "/audit-logs": "http://localhost:8787",
      "/auth/session": "http://localhost:8787",
      "/billing": "http://localhost:8787",
      "/connections": "http://localhost:8787",
      "/dashboard": "http://localhost:8787",
      "/feedback": "http://localhost:8787",
      "/google": "http://localhost:8787",
      "/health": "http://localhost:8787",
      "/oauth": "http://localhost:8787",
      "/readiness": "http://localhost:8787",
      "/recommendations": "http://localhost:8787",
      "/setup": "http://localhost:8787",
      "/sync": "http://localhost:8787",
      "/tasks": "http://localhost:8787",
      "/workspace": "http://localhost:8787",
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        lp: resolve(__dirname, "lp.html"),
      },
      output: {
        manualChunks: {
          charts: ["recharts"],
          react: ["react", "react-dom/client"],
          supabase: ["@supabase/supabase-js"],
        },
      },
    },
  },
  plugins: [react()],
});
