import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "UmaLab",
        short_name: "UmaLab",
        description: "Uma Musume roster tracking and breeding tools",
        theme_color: "#101418",
        background_color: "#101418",
        display: "standalone",
        icons: [
          // TODO: add real icons (192 + 512 png) in /public before installing to a phone
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" }
        ]
      }
    })
  ],
  server: {
    // IPv4 explicitly, at BOTH ends, because `localhost` is ambiguous on
    // Windows and the two servers resolved it differently: vite bound `::1`
    // while uvicorn bound `127.0.0.1`. Firefox then spent ~2s per new
    // connection trying IPv4 before falling back to IPv6, and vite's proxy
    // paid ~33ms on its first connection failing over the other way.
    // Chromium's fail-over is fast enough to hide both, which is why this
    // only showed up in one browser.
    host: "127.0.0.1",
    proxy: { "/api": "http://127.0.0.1:8000" }
  }
});
