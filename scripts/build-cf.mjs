// 构建 Cloudflare Pages 版本：把部署路径从 /hotel-toolbox/ 换成根路径 /。
//
// 为什么单独一个脚本：
//   Windows 的 cmd/PowerShell 不支持 `BASE_PATH=/ npm run build` 这种前置赋值，
//   写进 npm script 会在 Windows 上静默失效；这里用 Node 显式设置环境变量，
//   Windows / macOS / Linux / CI 行为一致。
//
// 同一份代码、同一个 commit：
//   npm run build      → GitHub Pages（/hotel-toolbox/）
//   npm run build:cf   → Cloudflare Pages（/）
import { spawnSync } from 'node:child_process';

const env = { ...process.env, BASE_PATH: '/' };

for (const [cmd, args] of [
  ['npx', ['vue-tsc', '-b']],
  ['npx', ['vite', 'build']],
]) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
