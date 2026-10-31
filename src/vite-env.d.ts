/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** 构建期由 vite.config.ts 的 define 注入，值来自 package.json 的 version */
declare const __APP_VERSION__: string;

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}
