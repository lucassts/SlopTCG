import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'SlopTCG',
        short_name: 'SlopTCG',
        description: 'Card games no navegador, de código aberto.',
        theme_color: '#0f1115',
        background_color: '#0f1115',
        display: 'standalone',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // NÃO pré-cachear o app: num jogo self-hosted, sem servidor não há
        // partida — e o precache prendia jogadores em versões antigas do
        // cliente (visto em produção na v0.3.0/v0.4.0). O SW existe só para
        // o cache de imagens do Scryfall abaixo.
        globPatterns: [],
        navigateFallback: null,
        // Imagens de carta do Scryfall: cache agressivo (são imutáveis por URL).
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/(api|cards)\.scryfall\.(io|com)\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'scryfall',
              expiration: { maxEntries: 800, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: { port: 5173 },
});
