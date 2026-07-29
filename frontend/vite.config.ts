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
    proxy: { "/api": "http://localhost:8000" }
  }
});
