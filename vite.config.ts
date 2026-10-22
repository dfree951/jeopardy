import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: { include: ["@breezystack/lamejs"] },
  server: { host: "127.0.0.1" },
});
