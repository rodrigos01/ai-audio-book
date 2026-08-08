import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg'],
      manifest: {
        name: 'AI Audio Book',
        short_name: 'AI Audio Book',
        description: 'Listen to AI-narrated audio books, online or offline.',
        theme_color: '#7c4dff',
        background_color: '#1c1b1f',
        display: 'standalone',
        icons: [
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
        ]
      },
      workbox: {
        // Chapter audio streams and the REST API must never be served from the
        // app-shell cache; only precached build assets (JS/CSS/HTML) go through it.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/samples\//]
      }
    })
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:3005',
      '/samples': 'http://localhost:3005'
    }
  }
})
