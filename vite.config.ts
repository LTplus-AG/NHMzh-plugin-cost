import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import federation from "@originjs/vite-plugin-federation";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load environment variables
  const env = loadEnv(mode, process.cwd(), "");

  console.log(`Running in ${mode} mode`);
  console.log(`API URL: ${env.VITE_API_URL}`);
  // console.log(`QTO API URL: ${env.VITE_QTO_API_URL}`); // Assuming this was removed earlier or not needed
  console.log(`WebSocket URL: ${env.VITE_WEBSOCKET_URL}`);

  return {
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
    define: {
      // Expose environment variables to the client
      "import.meta.env.VITE_API_URL": JSON.stringify(env.VITE_API_URL),
      // "import.meta.env.VITE_QTO_API_URL": JSON.stringify(env.VITE_QTO_API_URL), // Assuming this was removed earlier or not needed
      "import.meta.env.VITE_WEBSOCKET_URL": JSON.stringify(
        env.VITE_WEBSOCKET_URL
      ),
    },
    build: {
      target: "esnext",
      minify: mode === "production",
      cssCodeSplit: false,
    },
    preview: {
      port: parseInt(env.VITE_PORT || "4004"),
      strictPort: true,
    },
    server: {
      port: parseInt(env.VITE_PORT || "4004"),
      strictPort: true,
      host: env.VITE_HOST || "localhost",
    },
  };
});
