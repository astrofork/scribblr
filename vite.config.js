import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  define: { "process.env.IS_PREACT": JSON.stringify("false") },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 6000 },
});
