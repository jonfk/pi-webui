import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    cssCodeSplit: true,
    rollupOptions: {
      input: "src/client/sidebar/main.tsx",
      output: {
        entryFileNames: "sidebar.js",
        chunkFileNames: "sidebar-[hash].js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".css")) return "sidebar.css";
          return "[name][extname]";
        },
      },
    },
  },
});
