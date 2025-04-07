import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import federation from "@originjs/vite-plugin-federation";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    federation({
      name: "cost-uploader",
      // Modules to expose
      exposes: {
        "./App": "./src/App.tsx",
      },
      // Remote modules to import
      remotes: {},

      // Shared modules
      shared: ["react", "react-dom", "react-router-dom"],
    }),
  ],
  build: {
    target: "esnext",
    minify: false,
    cssCodeSplit: false,
  },
  preview: {
    port: 4004,
    strictPort: true,
  },
  server: {
    port: 4004,
    strictPort: true,
    host: true,
  },
});
