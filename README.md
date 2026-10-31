<h1 align="center">酒店入住工具箱</h1>

<p align="center">
  <b>简体中文</b> | <a href="./README_EN.md">English</a>
  <br><br>
  <a href="https://github.com/ChenChen913/hotel-toolbox/actions/workflows/deploy.yml"><img src="https://github.com/ChenChen913/hotel-toolbox/actions/workflows/deploy.yml/badge.svg" alt="Deploy"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

Rule-driven hotel stay toolbox: packing list, room & checkout checks, evidence-graded knowledge. No backend.

中文：规则驱动的酒店入住工具箱——准备清单、入住与退房检查、证据分级知识库。无后端，手机优先。

在线使用：<https://chenchen913.github.io/hotel-toolbox/>

## 目录

- [为什么做这个项目](#为什么做这个项目)
- [快速开始](#快速开始)
- [用法](#用法)
- [配置](#配置)
- [项目结构](#项目结构)
- [开发](#开发)
- [常见问题](#常见问题)
- [已知限制](#已知限制)
- [如何贡献](#如何贡献)
- [许可证](#许可证)

## 为什么做这个项目

这个项目始于一份个人酒店注意事项笔记，在产品定义阶段被重新定义为「以一次入住行程为核心对象的工具箱」：核心对象不是文章，而是一次具体的入住（stay），清单、检查与知识围绕它组织。

三个设计决策，均有存档依据：

- 固定规则驱动，不用 AI。每个问题必须能回答「这个答案会改变什么」，否则不问（见 `聊天记录/聊03.txt`）
- 清单区分「使用人数」与「准备数量」，消耗品按「人数 ×（晚数 + 1）」计算（见 `docs/规则表.md`）
- 知识条目全部标注证据等级与来源，不收录会制造错误安全感的伪检测方法（结论来自仓库内三份事实核查文档）

## 快速开始

前置要求：Node.js（仓库 CI 在 Node 22 下构建与测试）、npm。

```sh
git clone https://github.com/ChenChen913/hotel-toolbox.git
cd hotel-toolbox
npm install
npm run dev
```

打开 <http://localhost:5173/hotel-toolbox/> 即可使用。

## 用法

主流程：

1. 首页点「创建一次入住」，走 7 步向导（关掉「替其他人管行李」时收成 5 步）：性别、日期与晚数、人数、同行人员与关系、住宿场景与天气温度、个人偏好、确认清单
2. 系统按规则生成清单，共 56 条物品规则参与计算，数量自动按人数与晚数折算；第 7 步可逐项改数量、把某项减到 0（收进「已设为不带」，随时可恢复）、或追加自定义物品与衣物 / 化妆品
3. 旅程页分「准备 / 入住 / 退房」三段：准备段逐条打勾、指定使用人、挂好物；到店过「入住检查」（15 项 / 5 组，含消防观察与应急物资确认）；走前过「退房检查」（14 项 / 6 组 + 押金与账单 2 项）
4. 「知识库」收录 44 条带证据等级与来源的条目，按 11 个模块分组，顶部有证据 / 风险图例；紧急联络模块提供可一键复制的话术
5. 「好物」页汇总记过的好物，按分类分组，展示为「物品名称 + 品牌」；添加时**按物品名称自动归类**（如「充电宝」→ 电子），手动点过分类后不再自动覆盖
6. 「我的」页负责备份与恢复（导出 / 导入 JSON 文件）、免责声明与隐私说明、清空本机数据

行程保存在浏览器本地，首页可「复制上一次入住」作为模板（关系、天气等扩展条件一并带上）。

## 配置

| 环境变量 | 必填 | 默认值 | 说明 |
|---------|------|--------|------|
| `BASE_PATH` | 否 | `/hotel-toolbox/` | 部署路径。GitHub Pages 项目页保持默认；Cloudflare Pages 用 `/`（`npm run build:cf` 已代设） |

数据保存在浏览器 `localStorage`，不上传服务器。用到的键：`htb_stays_v1`（行程）、`htb_gear_v5`（好物，含 v4/v3 迁移源）、`htb_ext_v1`（住宿关系 / 天气温度等扩展）、`htb_ui_collapsed_v2`（分组折叠态）、`htb_stays_v1_corrupt` / `htb_gear_corrupt`（损坏原文隔离）。

## 项目结构

```
src/
├── data.ts             # 56 条物品规则、固定清单（入住 15 / 退房 14）、44 条知识、好物种子
├── types.ts            # 领域类型（与小程序端零差异）
├── engine.ts           # 规则求值、行程存取、好物收藏（含旧版本数据迁移）
├── extra.ts            # 扩展层：住宿关系、天气温度、性别与目的、追加物品、退房押金、扩展备份
├── repair.ts           # 存储读修复与备份净化（坏数据不再白屏）
├── rich.ts             # 知识正文的段落 / 加粗预解析（不用 v-html）
├── platform.ts         # 浏览器存储适配（localStorage + 读修复 + 写失败提示）
├── store.ts            # 视图状态、日期格式化、阶段推断
├── ui.ts / toast.ts    # 全局轻提示与文案 / 时长口径
├── styles/
│   ├── global.css      # 设计令牌与全局类（冷灰白 + 深海军蓝 + 琥珀）
│   └── icons.css       # 49 个自绘图标（base64 内联，无第三方图标库）
├── components/         # AppIcon / Stepper / Toggle / ItemRow / DatePicker /
│                       # ClothingAdd / GearPanel / ProgressPill / AppModal / AppToast / TabBar
└── views/              # 六个页面：Home / Wizard / Stay / Knowledge / Gear / Mine
tests/
├── engine.test.ts      # 源项目 38 个用例（逐字未改）
└── parity.test.ts      # 23 个与小程序端同口径的扩展层 / 修复层用例
docs/
└── 规则表.md            # 规则设计文档（问卷、条件、数量公式）
```

## 开发

技术栈：Vite、Vue 3、TypeScript、Vitest；图标为自绘 SVG（base64 内联，零第三方图标库）；通过 vite-plugin-pwa 支持安装到主屏与离线使用。

```sh
npm test          # 运行测试（67 个用例）
npm run build     # 类型检查 + 产物构建
npm run preview   # 本地预览构建产物
```

推送到 main 后，GitHub Actions 会自动执行测试、构建并部署到 GitHub Pages（配置见 `.github/workflows/deploy.yml`）。

### 部署到 Cloudflare Pages（可选，与 GitHub Pages 并行）

同一份代码、同一个 commit，只差一个部署路径：

```sh
npm run build:cf      # BASE_PATH=/ 的构建（产物在 dist/）
npm run deploy:cf     # wrangler pages deploy（首次会要求登录或提供 API Token）
```

也可以走 Cloudflare 控制台的 Git 集成：构建命令 `npm run build:cf`，输出目录 `dist`。
仓库里已经放好 `wrangler.toml`、`public/_redirects`（SPA 回退）与 `public/_headers`（入口与 SW 不缓存、静态资源长缓存）。

想让 GitHub Actions 自动发布到 Cloudflare，在仓库 Secrets 里加 `CLOUDFLARE_API_TOKEN`（权限：Account → Cloudflare Pages → Edit）与 `CLOUDFLARE_ACCOUNT_ID`；未配置时 `.github/workflows/deploy-cloudflare.yml` 会自动跳过，不会让 CI 变红。

> ⚠️ 换域名（GitHub Pages ↔ Cloudflare Pages）等于换 origin：`localStorage` 不共享，旧站的数据要先在「我的」页导出，再到新站导入。

## 常见问题

**Q：换设备或清除浏览器数据后，行程还在吗？**
A：不在。行程只存本机浏览器，换设备前请自行记录；应用内的「复制上一次入住」可以快速重建一份清单。

**Q：为什么清单里没有我想带的东西？**
A：系统只推荐能由规则推断的物品。职业、爱好相关的物品（相机、药品、宠物用品等）走「添加我的必带物品」，应用会在生成清单后给出提示词。

**Q：为什么不用 AI 生成清单？**
A：设计定稿是固定规则驱动：规则可解释、可测试、离线可用。AI 入口留作后续扩展。

**Q：「好物」和清单是什么关系？**
A：好物记的是「哪件东西你认哪个牌子」，展示为「物品名称 + 品牌」（如「充电宝 · 小米」），品牌可以留空。清单每行的「＋ 好物」只显示这一件物品的品牌；「好物」页按分类汇总全部。

**Q：好物的分类会自己选对吗？**
A：会。输入物品名称时按关键词联想（18 个分类、412 个关键词，覆盖常见叫法），猜不出就保持原样、不会瞎猜。**联想只是省一步，随时可以点标签改**；一旦你手动点过分类，后面再改名称也不会覆盖你的选择。

## 已知限制

- 行程数据存浏览器 localStorage，清除浏览器数据即丢失；可在「我的」页导出 JSON 备份、导入恢复
- 天气与温度不联网、不接天气预报，由向导里手动选择；不选时相关规则一律不触发
- 数量公式是简化建议值（人数 ×（晚数 + 1）等），可在清单中逐项手动调整；湿巾等无法按人数推导的物品请自行修改
- V1.2 规划（来自外部评审意见）：完整采购状态闭环（待购买/已购买/家里已有）、多儿童独立年龄段（Guest 完整模型）、PC 宽屏双栏布局

## 如何贡献

这是个人项目，欢迎通过 [Issues](https://github.com/ChenChen913/hotel-toolbox/issues) 提出问题与建议；PR 请先开 Issue 讨论。

## 许可证

[MIT](LICENSE) © 2026 ChenChen913
