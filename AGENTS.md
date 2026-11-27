# AGENTS.md — NC WorldBattle

回合制 3D 即时战略，浏览器直接玩。2–4 名玩家各占正方形地图一角，每回合掷骰子争夺行动点，采集矿石 / 石油 / 肉，建设基地、训练部队，第 6–10 回合有外星人克洛伊乱入，打满所选回合数后基地生命值最高者获胜。

技术栈：Vite + TypeScript（strict）+ three.js 0.187 + Vitest 4，纯前端无后端。目录 `/Users/naku/Documents/NakuRTS`，**不是 git 仓库**（只有 .gitignore）。

## 常用命令

- `npm run dev` — 开发服务器 http://127.0.0.1:5173（strictPort，5173 被占用会失败，不要再起一个）
- `npm test` — 全部规则测试（vitest run）
- `npx vitest run src/game/__tests__/terrain.test.ts` — 只跑某一个测试文件
- `npm run build` — `tsc --noEmit` 类型检查 + `vite build` 打包到 dist/（build 失败 = 类型检查失败，没有单独的 lint）
- `npm run preview` — 预览打包结果

没有 eslint。`tsc` 的 strict + `noUnusedLocals` / `noUnusedParameters` 是唯一的静态检查，未用的 import / 变量会让构建失败。

## 目录结构

- `src/game/` — 纯规则层，**不依赖任何渲染/UI**
  - `data.ts` — 所有数值（单位、建筑、资源、地形、地图大小、五种外星人、积分表、基地布局常量）。调平衡只改这里。
  - `board.ts` — 棋盘几何、领地局部坐标、地形通行、占位、寻路（reachable / route）
  - `terrain.ts` — 随机地图生成（水道、恰好两桥、湖泊、树林、山地）
  - `engine.ts` — 回合流程与所有行动的裁决；`reduce(state, action)` 是唯一入口
  - `ai.ts` — 电脑玩家（aiDecide）
  - `rng.ts` — 种子化随机数（mulberry32），地图/骰子/克洛伊都用它
  - `types.ts` — 类型定义
  - `__tests__/` — 规则测试（`helpers.ts` 提供 newGame / apply / toTurn / rich / spawn / build / playGame）
- `src/render/` — three.js 画面，import game/，不 import ui/
  - `scene.ts` — 棋盘、高亮池、相机与平移（HIGHLIGHT / VIEW_DIR / worldOf）；`showcase()` 是首页的展示镜头（低角度、缓慢自转）
  - `view.ts` — GameView：实体模型、动画、特效、事件播放
  - `models.ts` — 单位 / 建筑 / 资源点 / 克洛伊模型
  - `terrain.ts` — 树林 / 岩石实例化、桥、水面
  - `fx.ts` — 攻击特效与飘字
  - `palette.ts` — 地形颜色（棋盘与小地图共用）
  - `coords.ts` — tile ↔ world 坐标换算
- `src/ui/` — DOM 界面层，import game/ 和 render/
  - `controller.ts` — 主控制器：回合驱动、输入、建筑选址、相机、暂停、存档流程
  - `home.ts` — 首页（大标题、新游戏 / 加载存档、HUD 风格边框）
  - `menus.ts` — 暂停菜单（Esc）与首页的加载面板，液态玻璃卡片
  - `saves.ts` — 存档读写、校验与旧版本迁移（localStorage，3 个存档位，键 `nc-worldbattle.save.N`）
  - `scores.ts` — 小地图下方的积分榜
  - `slots.ts` — 存档位列表（保存和读取共用）
  - `showcase.ts` — 首页背后那块只用于展示的棋盘
  - `hud.ts` — 侧边栏（采集 / 建造 / 生产 / 建筑 / 玩法页签）
  - `overlays.ts` — 弹层服务：开局设置、骰子、横幅、结算、确认框、toast
  - `minimap.ts` — 左上角全局小地图；`paintGround` / `paintZones` / `paintForces` 也用来画存档缩略图
  - `icons.ts` — 手绘 SVG 图标（资源 / 单位 / 建筑 / 地形 / 菜单线性图标 `glyph()`）
  - `rules.ts` — 玩法说明与共享文案
  - `store.ts` — Store：持有唯一 live 状态并向 view 广播事件
  - `dom.ts` — `h()` 元素构造器、玻璃高光、焦点工具
  - `__tests__/` — 界面逻辑测试：存档文件；用最小假元素测暂停菜单与弹层的开关
- `src/main.ts` — 三层组装；引入首页字体 `@fontsource/chakra-petch`（随包打包，不联网）
- `docs/GAME_DESIGN.md` — 设计文档，**规则解读与数值表的权威来源**

## 架构边界

- `game/` 只 import 自己的文件（board / data / engine / terrain / rng / types），不 import render/ 或 ui/。保持规则层可测、纯逻辑。
- `render/` import game/（类型、数据、几何、engine 查询函数），不 import ui/。
- `ui/` import game/ 和 render/。
- `main.ts` 负责装配。不要把 UI 概念塞进 game/，也不要让 render/ 认识 ui/。
- 规则层没有 DOM 依赖；`engine.ts` 里的 `reduce` 是唯一的行动入口，就地修改 GameState 并返回事件列表。
- **加一种外星人**要动四处：`data.ts` 的 `ALIENS`（数值与 `fx`）、`render/models.ts` 的 `buildAlien`、`ui/icons.ts` 的 `ALIEN_ART`，再在 `src/game/__tests__/aliens.test.ts` 补测试。外星人占的格子记在 `BoardIndex.others`；小蜘蛛（`s.brood`）不算在外星人上限里。
- **每个玩家的领地大小不一样**（基地升级后多一圈）：判断“在不在领地里”一律用 `board.ts` 的 `zoneSize(p)`，不要用 `ZONE_SIZE` 常量。
- **GameState 必须保持纯 JSON 数据**（不能有类实例、Map、函数、undefined 依赖）：存档就是 `JSON.stringify(state)`，`src/game/__tests__/save.test.ts` 会验证“任意一步存档、读档后结局一致”。
- **对局里的一切等待都走 `Controller.nap()`**（暂停感知），不要直接用 `wait()`；动画速度只通过 `syncClock()` 设置 `view.timeScale`。弹层必须经 `Overlays.open()` 登记，换局时才能被清理。
- 对局中 Esc 永远是暂停菜单；暂停期间 `dispatch()` 一律拒绝，任何新的异步流程都要先过 `gate()` / `running()`。

## 约定

- **中文**：用户可见文案（UI、弹层、`docs/` 与 README 的正文）用简体中文；代码标识符、文件名、注释保持英文。
- 所有游戏数值放在 `src/game/data.ts`，不要在别的文件写死；改数值时同步 `docs/GAME_DESIGN.md`。
- 规则层里不要 `console.log`（测试文件例外）。
- 测试默认不依赖渲染与 DOM（node 环境），用 `__tests__/helpers.ts` 里的工具函数。

## 测试

- 跑全部：`npm test`；只跑一个文件：`npx vitest run <path>`。测试文件放在 `src/**/__tests__/*.test.ts`。
- **弹层必须经 `Overlays.open()` 登记，关闭时必须调用它返回的函数**：只移除 DOM 会让 `blocking` 一直为真，棋盘从此点不动（出过这个 bug，`ui/__tests__/menus.test.ts` 守着它）。
- `helpers.ts` 的 `newGame()` 默认 `terrain: 'plain'`（平原），保证数字只由规则决定；需要随机地形的测试显式传 `{ terrain: 'random' }`。
- 常用工具：`apply` / `tryApply` / `toTurn` / `nextTurn` / `rich` / `spawn` / `build` / `placeBuilding` / `playGame`（整局模拟）。
- 写规则类测试时断言规则（伤害、价格、限制），写地形类测试时用 `setTerrain` 或随机地图断言不变量（桥的数量、水道带区、领地干净）。

## 浏览器验证（可选）

- 开发构建有全局 handle `window.nc = { scene, view, game, THREE }`（仅 dev），可在控制台里查状态。
- 游戏从首页的“新游戏 → 开始游戏”进入；直接调用内部方法可以开局，但开局设置的遮罩不会收起。
- 改动源码会触发 Vite 刷新页面回到首页；未保存的对局会丢，所以要先把状态存进存档位（localStorage 在刷新后保留）。
- 存档只在 `localStorage` 的 `nc-worldbattle.save.0..2` 里，调试时可以直接读写这几个键。

## 改动前先读

- `docs/GAME_DESIGN.md` — 规则解读表（第 1 节）与数值/平衡表（第 11 节）。几个规则解读（行动点 = 一次采集、地形加成只作用于站上去的单位等）等用户确认，改之前先过目。
- `src/game/data.ts` — 数值真相。
- `README.md` — 运行方式与结构。
