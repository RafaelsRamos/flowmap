import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Relative base so the built app works from any folder or GitHub Pages path.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { outDir: "dist-web", chunkSizeWarningLimit: 2500 },
});
