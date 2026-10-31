import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

// 部署路径只在这里读一次环境变量，其余全部派生：
//   · GitHub Pages 项目页 → /hotel-toolbox/（默认）
//   · Cloudflare Pages     → /（BASE_PATH=/ npm run build，或 npm run build:cf）
// 这样同一份 commit 能同时部署到两个平台，改路径不用改代码。
const BASE = (process.env.BASE_PATH || '/hotel-toolbox/').replace(/\/*$/, '/');

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { version: string };

export default defineConfig({
  base: BASE,
  // 版本号只信 package.json，避免「我的」页显示值与发布版本漂移
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      // 不写 includeAssets：public/ 下的 svg/png 已由 globPatterns 收进预缓存，
      // 两处都写会产生重复的预缓存条目（dist/sw.js 里同 revision 出现两次）。
      manifest: {
        name: '酒店入住工具箱',
        short_name: '入住工具箱',
        description: '规则驱动的酒店入住工具箱：准备清单、入住与退房检查、证据分级知识库',
        lang: 'zh-CN',
        theme_color: '#f5f7fa',
        background_color: '#f5f7fa',
        display: 'standalone',
        // start_url 跟随部署路径；scope 不手写，由插件按 start_url 推导
        start_url: BASE,
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // maskable 用带安全边的版本，避免安卓自适配圆形时被裁掉
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // ⚠️ 这里必须是**预缓存清单里的键**（相对路径 'index.html'）。
        // 之前写的是 '/hotel-toolbox/' 目录，不在 precache 清单中，
        // createHandlerBoundToURL 会在 SW 启动时抛 non-precached-url，
        // 整个 Service Worker 直接装不上（离线能力等于没有）。
        navigateFallback: 'index.html',
        directoryIndex: 'index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
