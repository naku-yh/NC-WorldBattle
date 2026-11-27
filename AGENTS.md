# AGENTS.md — NC WorldBattle

回合制 3D 即时战略，浏览器直接玩。2–4 名玩家各占正方形地图一角，每回合掷骰子争夺行动点，采集矿石 / 石油 / 肉，建设基地、训练部队，第 5–8 回合起有外星人来袭，打满所选回合数后积分最高者获胜。

技术栈：Vite + TypeScript（strict）+ three.js 0.187 + Vitest 4，纯前端无后端。仓库根目录就是项目根目录。

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
  - `view.ts` — GameView：实体模型、动画、特效、事件播放；`load()` 负责把上一块棋盘的东西清干净。血条只在受伤时显示，选中的单位头顶是绿色倒三角（`selectionMark`）
  - `models.ts` — 单位 / 建筑 / 资源点 / 五种外星人模型。`bake()` 把一个模型里不动的零件按材质合并成少量网格，`scrap()` 在模型离场时释放它独占的几何体和材质
  - `dome.ts` — 防御网的穹顶（着色器：边缘轮廓光、网格、上爬的光环、受击涟漪）
  - `plumes.ts` — 烟囱冒出的蒸汽和烟（整块棋盘共用一个 Points）
  - `terrain.ts` — 树林 / 岩石 / 小草 / 野花（实例化，随风摇摆）、桥、水面着色器
  - `fx.ts` — 攻击特效与飘字
  - `palette.ts` — 地形颜色（棋盘与小地图共用）
  - `coords.ts` — tile ↔ world 坐标换算
- `src/ui/` — DOM 界面层，import game/ 和 render/
  - `controller.ts` — 主控制器：回合驱动、输入、建筑选址、相机、暂停、存档流程
  - `home.ts` — 首页（大标题、新游戏 / 加载存档、HUD 风格边框）
  - `menus.ts` — 暂停菜单（Esc：继续 / 玩法 / 存档 / 重新开始 / 退出）与首页的加载面板，液态玻璃卡片
  - `saves.ts` — 存档读写、校验与旧版本迁移（localStorage，3 个存档位，键 `nc-worldbattle.save.N`）
  - `scores.ts` — 小地图下方的积分榜
  - `slots.ts` — 存档位列表（保存和读取共用）
  - `showcase.ts` — 首页背后那块只用于展示的棋盘
  - `hud.ts` — 侧边栏（建造 / 生产 / 建筑页签）、侧边栏左边的采集面板（只在人类玩家有行动点时出现）、底部的单位卡片（数值画成格子，见 `Meter`）
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
- **GameState 必须保持纯 JSON 数据**（不能有类实例、Map、函数、undefined 依赖）：存档就是 `JSON.stringify(state)`，`src/game/__tests__/save.test.ts` 会验证“任意一步存档、读档后结局一致”。改了已有字段的**含义**（不是加字段）时，在 `ui/saves.ts` 里把 `VERSION` 加一，照着 `fromSecondVersion` 写一个迁移函数、补一条测试，旧存档才不会读成另一种意思。
- **`Building.level` 是从 1 起算的级数，可以大于 2**（防御网有 5 级）。取“下一级”一律用 `engine.ts` 的 `nextLevelOf(b)`，别写 `levels[1]`；判断“是不是最高级”用 `nextLevelOf(b) === null`。
- **换棋盘时不能留下任何东西**。`GameView.load()` 每次放上新棋盘都会跑（首页、开局设置每点一下都会重画展示棋盘），它把上一块棋盘的实体、运输车、资源点、穹顶全部移除并 `scrap()`。往 `scene.dynamic` 里**直接**加东西（不经 `create()`）时必须同时：记在一个列表里、在 `load()` 里移除并 `scrap()`。自己建的几何体 / 贴图 / `InstancedMesh` 要在 `dispose()` 里释放。曾经漏掉资源点和运输车，一局下来每帧一万九千次绘制调用。
- **挂在单位下面、又要正对镜头的东西**（血条、选中标记）必须用 `view.ts` 的 `faceCamera()`：单位自身有朝向，直接抄相机的四元数会被单位的朝向拧歪。血条的三层（边框、已损失、剩余）必须都是透明材质、靠 `renderOrder` 排顺序：只要有一层是不透明的，它会先画，然后被半透明的底色盖住，整条血条就成了黑条。
- **模型里会动的零件**（炮塔、雷达、风扇、抽油机）放进标了 `userData.live = true` 的 Group，`bake()` 会把它们单独合并、保持可动；完全不能合并的 Mesh 标 `userData.keep`（运输车的货斗）。用 `new` 创建、又留在 `bake()` 之外的网格，几何体要标 `userData.owned = true` 才会在离场时被释放。
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
- 贴在另一个面上的薄片（奶牛的黑斑、墙上的窗带）要明显凸出来（≥ 0.004），不能和底面共面，否则拖动镜头时会闪。

## 浏览器验证（可选）

- 开发构建有全局 handle `window.nc = { scene, view, game, THREE }`（仅 dev），可在控制台里查状态。`view.state` 是当前画面对应的状态（首页的展示棋盘也在里面），`game.store` 只在对局中存在。
- 游戏从首页的“新游戏 → 开始游戏”进入；直接调用内部方法可以开局，但开局设置的遮罩不会收起。
- 改动源码会触发 Vite 刷新页面回到首页；未保存的对局会丢，所以要先把状态存进存档位（localStorage 在刷新后保留）。
- 性能自查：`nc.scene.renderer.info.render.calls` 是每帧绘制调用数，`nc.scene.renderer.info.memory.geometries` / `.textures` 是显卡上的几何体和贴图数。在首页和几局之间来回切换后，后两个数应当回到同一个值；一直涨就是有东西没释放。
- 存档只在 `localStorage` 的 `nc-worldbattle.save.0..2` 里，调试时可以直接读写这几个键。

## 改动前先读

- `docs/GAME_DESIGN.md` — 规则解读表（第 1 节）与数值/平衡表（第 11 节）。几个规则解读（行动点 = 一次采集、地形加成只作用于站上去的单位等）等用户确认，改之前先过目。
- `src/game/data.ts` — 数值真相。
- `README.md` — 运行方式与结构。
