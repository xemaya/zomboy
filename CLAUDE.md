# CLAUDE.md — ZOM-BOY+ Web 版

## 工程背景

ZOM-BOY+ 是一个**独立小游戏**(与 `games/` 下的 loop / banwei fork **无关**,不互借代码、不混做)。
浏览器单页、僵尸 vs 幸存者棋类对战:8×8 网格,幸存者靠「跳杀」得分,僵尸靠「感染」得分,先满 4 杀者胜。
支持两种模式:**双人热座** + **单人对战内置规则型 AI**(非大模型)。已上线公开试玩。

**规则的唯一真源 = 用户口述的完整规则**,落到 `docs/superpowers/specs/2026-05-15-zomboy-design.md`(v2 canonical)。
早期 v1 实现有偏差(卡牌/全僵尸上场/30 回合上限),v2 已全部修正。**改规则前先读这份 spec,不要凭记忆改。**

## 技术栈 / 命令

- Vite + TypeScript,**无框架,原生 DOM**,CSS Grid 渲染棋盘。像素 sprite 由 DeerAPI gpt-image-2 生成。
- `npm run dev` — 开发服务器,固定 `127.0.0.1:1424`(`strictPort`,端口被占会直接报错而非换端口)。
- `npm run build` — `tsc && vite build`,产物在 `dist/`。
- `npx tsx scripts/simulate.ts` — **平衡测试 harness**:AI vs AI 跑 4 组配置 × 100 局,输出胜率/局长/卡牌使用/得分直方图/活锁率。**任何平衡改动都要用它复测并报真实数字**,不要凭感觉下结论。
- `scripts/gen_sprites.py` + `scripts/chromakey.py` — 重新生成/抠图 sprite(透明走 `#FF00FF` chroma-key,不接受 `background=transparent` 参数)。

## 架构(改代码前必须理解)

**全部游戏状态集中在一个可变 `State` 对象**(`src/game/types.ts`)。
**所有玩法只有一个入口:`clickCell(state, r, c)`**(`src/game/state.ts`)。UI(`main.ts`)只是反复调用它再 `render()`;AI(`src/game/ai.ts`)也只是生成一串等价于玩家点击的 `(r,c)` 序列,回放进同一个 `clickCell`。

> 这是本工程最重要的不变量:**人和 AI 走同一条规则代码路径,规则一致性 0 风险。** 新功能不要绕开 `clickCell` 另搞一套动作系统。

- `src/game/rules.ts` — 纯函数:`legalMoves` / `legalJumps` / `emptyCells` / `checkWinner` / `pieceAt` / `ORTHO`。`runInfection` **有副作用,会改 state**。
- `src/game/state.ts` — 状态机。僵尸回合动作类型**从点击推断**(点空地+库存>0=召唤;点己方僵尸=进入移动 2 步模式),非显式选择。幸存者踩未消耗的房子 → `deck.shift()` 抽卡 → 进入 `pendingCard` 多阶段交互,由 `resolvePendingCardClick` 推进。每个动作末尾走 `runEndOfTurn`(感染→胜负→切边)。
- `src/game/ai.ts` — 规则型 AI,无搜索框架:对每个候选「整回合」克隆 state、应用、跑同样的回合末结算、打分取最优;`hard` 额外加 1 ply 最坏对手回应。难度 `easy|medium|hard` 由 `EPS` 噪声区分。`planTurn` / `planCardResolution` 是对外入口。
- `src/ui/*` — board / hud / cardModal / rulesModal / sprites,纯渲染 + 转发点击。

## 设计原则

- **规则忠于用户口述真源**,不自行发明;有歧义先问,别猜。
- **MVP 取舍优先防 cheese / 防过强**,牺牲一点"原文字面"也接受(见下方平衡裁决)。
- 视觉:标题 `Press Start 2P`(单层粉色阴影,无双层重影),正文 `Noto Sans SC`;暗背景 `#2a2724` + cream 面板 `#f6f1e0` + pink `#c93f74`。
- 不做:联网、存档、声音、大模型 AI。

## 平衡裁决(有意为之,**不要回退**)

这些是用 harness 复测后的刻意决定,看着"偏离原文"但都是为平衡:

- **鬼魂卡 = 永久驱散**:从场上彻底移除该僵尸,**不回库存、不算幸存者得分**。原"传送到空地"过弱,2026-05-15 改。
- **库存=0 后取消「僵尸全图瞬移」**:库存空时僵尸只能"移动 2 步",不能瞬移。瞬移过强。
- **房子一次性消耗**:踩过即失效,防反复刷卡 cheese。
- **奖励走(靴子/咖啡/跳杀落点)不再触发踩房子抽卡**,不连锁。
- **`STALE_PLY_CAP` 防活锁平局**:N 个半回合无新击杀则判定(领先方胜/平),只为救 AI vs AI 病态僵局。
- `hard` 幸存者会主动进攻(不是纯逃跑)。

改动这些前先问用户,并说明会破坏什么平衡。

## 部署 / 运维

线上部署与排查问题的完整手册(SWAS 实例细节、一次性 key 部署流程、nginx log 取数 shortcut)在 **`OPS.local.md`**(本地文件,已 gitignore,不进公开仓库)。要部署或排查线上时先看那份。

## 协作约定

- 平衡决策:先用 harness 出真实数字 → 偏 feel 的取舍用 `AskUserQuestion` 给选项让用户定方向 → 技术上该 pushback 就 pushback,别迎合。
- 让用户试玩时直接给 URL(本地 `http://127.0.0.1:1424`;线上地址见 `OPS.local.md`),别让用户自己翻。
- `src/**/*.js` 已 gitignore(tsc 产物),不要提交。
