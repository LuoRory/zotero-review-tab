# 回顾页面 · 数据接口清单与展示映射

目的：把页面上每个信息块都落到插件真实存在的数据上。结论先说：

- 现有 11 个数据方法（外加设置入口）够支撑「队列 → 单元 → 条目 → 评分」的主流程。
- 原型里有一批信息是虚构的（条目完成状态、条目进度、每单元待回顾数、条目时间、生成单元笔记、全量单元列表），必须换掉或删掉。
- 要完整展示真实状态，还需要 **4 个新增接口 + 2 处字段补齐**（见第六节）。

## 一、现有接口（页面只能从这里取数）

`bootstrap.js` 的 `forWindow()` 暴露：

| 接口 | 参数 | 返回 | 页面用途 |
| --- | --- | --- | --- |
| `ensureInitialContent()` | — | 完整 state | 仅用于首启建档的加载态；页面不应从它渲染 |
| `getDashboard()` | — | `{ initialized, queue, stats, units[], optimizerEligible }` | 首页：今日队列、统计、单元卡片 |
| `getRecentUnits()` | `{ offset, limit, sort }`，`sort` 为 `added` / `modified` | `{ items[], nextOffset, hasMore }` | 近期活动、随意回顾、加载更多 |
| `getUnit()` | `id`, `{ annotationOffset, annotationLimit }` | 单元详情或 `null` | 右栏详情、注释分页 |
| `gradeUnit()` | `id`, `rating`（1 Again / 2 Hard / 3 Good / 4 Easy） | `{ card, log }` | 四档评分；返回值可直接显示下次到期 |
| `recordPractice()` | `id`, `note` | — | 随意回顾：只记一次浏览，不动调度 |
| `setPriority()` | `id`, `low/normal/high/core` | — | 优先级切换 |
| `annotationTypeLabel()` | `type` | 中文标签 | 注释类型文案 |
| `openAnnotation()` | `annotationKey`, `tabID` | — | 跳到 PDF 原文位置 |
| `openNote()` | `noteKey` | — | 打开笔记编辑器 |
| `newNote()` | `parentRef`（`libraryID:key`） | — | 新建条目笔记（Zotero 原生编辑器） |
| `openPreferences()` | — | — | 打开设置面板 |

## 二、数据形状

### unit（`state.units[id]`，`hydrateUnit()` 补全后）

| 字段 | 含义 | 建议展示 |
| --- | --- | --- |
| `id` | `article:<key>` 或 `book-session:<key>:<day>` | 内部用 |
| `parentKey` / `parentRef` | 父条目 | 内部用 |
| `unitType` | `article` / `book-session` | 类型徽标：「论文」/「书籍 · 阅读日」 |
| `sessionDay` | 书籍阅读日 `YYYY-MM-DD` | 书籍单元副标题 |
| `title` / `creator` / `year` | 条目元数据 | 标题、作者、年份 |
| `annotationCount` / `noteCount` / `activityCount` | 注释、笔记、活动总数 | 卡片计数 |
| `pageRange` | `{first,last}` 数字页码范围（可能为 null） | 书籍单元「pp. 88–105」 |
| `firstActivityAt` / `lastActivityAt` | 首末活动时间 | 「最近活动」 |
| `lane` | `new` / `backlog` / `scheduled` | 来源徽标：新内容 / 历史重温 / 已排期 |
| `priority` | `low` / `normal` / `high` / `core` | 优先级标记与切换 |
| `paused` / `stopped` | 布尔 | 队列会跳过；当前无入口 |
| `fsrsCard` | 见下 | 调度面板 |
| `reviewLogs[]` / `practiceLogs[]` | 评分历史 / 浏览历史 | 历史与次数 |
| `lastReviewedAt` / `dueAt` | 上次评分、到期 | 「上次回顾 / 下次到期」 |
| `recentUpdatedAt` | 仅在条目被重建时写入 | 排序（见缺口） |
| `missing`（缺） | 父条目已删除 | 建议新增 |

### fsrsCard

`due`、`effectiveDueAt`、`stability`、`difficulty`、`elapsed_days`、`scheduled_days`、`reps`、`lapses`、`state`（0 New / 1 Learning / 2 Review / 3 Relearning）、`last_review`、`jitterDays`。

### annotation / note

- 注释：`{ key, type, text, comment, color, pageLabel }`，`type` 取 `highlight / underline / note / image / ink`。
- 笔记：`{ key, html }`。
- 两者都 **没有** `dateAdded`；`pageLabel` 是字符串（可能是 `iv`、空串），真实顺序是查询返回的 `sortIndex` 顺序。

### queue / stats / prefs

- `queue`：`{ dayKey, createdAt, items: [{ unitId, source }], stats: { due, new, backlog } }`。
- `stats`（当日）：`{ fsrsCompleted, good, again, newAdmitted, backlogReleased, practice }`。
- `prefs`：`enabled`、`openOnStartup`、`dailyCount`、`newCardLimit`、`boundary`、`firstDays`（`firstDays` 当前代码未使用）。

## 三、页面需要展示的 6 组信息

| 组 | 内容 | 数据来源 | 优先级 |
| --- | --- | --- | --- |
| A 今日队列与统计 | due / new / backlog 数量、今日已完成、Good / Again、practice、容量 | `queue.stats`、`stats`、设置 | P0 |
| B 单元身份与来源 | 标题、作者、年份、类型、阅读日、页码范围、lane | unit 字段 | P0 |
| C 内容条目 | 注释（类型/页码/颜色/正文/评论）、笔记正文、分页 | `getUnit` | P0 |
| D 调度状态 | lane、FSRS 状态、到期、稳定度/难度、复习/遗忘次数、上次评分、历史 | `fsrsCard`、`reviewLogs` | P0（基础）/ P1（细节） |
| E 操作 | 四档评分、practice 记录、优先级、打开原文/笔记、新建笔记、设置、排序、加载更多 | 对应接口 | P0 |
| F 反馈 | 首启加载、空态、错误、优化器资格、父条目已删除 | `initialized`、`optimizerEligible`、错误 | P1 |

## 四、原型与真实数据不对齐的地方

| # | 原型 | 真实情况 | 处理 |
| --- | --- | --- | --- |
| 1 | 单元只有「论文 / 书籍」 | `unitType` 是 `article` / `book-session`；书籍按阅读日拆成多个单元 | 徽标显示「论文 / 书籍 · 阅读日」，书籍附 `sessionDay` |
| 2 | 「上次回顾 2 天前」 | `lastReviewedAt` 可为 null；`lastActivityAt` 是内容活动，不是回顾 | 分开显示「上次回顾」与「最近活动」，从未回顾显示「未复习」 |
| 3 | 条目 `done / later` | 不存在条目级状态，调度只到单元 | 删除条目勾选；「稍后」改为本次会话内跳过 |
| 4 | 进度条 +「已回顾 x / y」 | 没有条目完成度分母 | 换成 FSRS 维度：状态、到期、复习次数；或队列完成度 |
| 5 | 「待回顾 N 条」 | 没有每单元待回顾条目数 | 改为「注释 N · 笔记 M」，或按 lane 显示 |
| 6 | 顶栏「今天待回顾 X 个单元」 | 队列是 due / new / backlog 三类 + 每日容量 | 显示「到期 4 · 新内容 3 · 历史 2 / 上限 20」 |
| 7 | 条目「3 天前」 | 注释、笔记 DTO 都没有时间 | 补 `dateAdded`，或删掉条目时间 |
| 8 | 注释按页码数字排序 | `pageLabel` 是字符串，可能罗马数字或为空 | 按返回顺序（`sortIndex`）分组，页码只作标签 |
| 9 | 「生成单元笔记」 | 数据边界只允许 Zotero 原生界面写笔记 | 删除；保留「新建笔记」入口 |
| 10 | 「开始逐条回顾」+ 条目勾选 | 评分是单元级 FSRS，四档 | 沉浸式改为「只读逐条浏览 → 末尾一次单元评分」 |
| 11 | `data-theme` 手动切换、固定 12px | Zotero 变量跟随主题，`font: menu` | 迁移时用 Zotero 变量，字号继承 |
| 12 | 左栏像「全部单元」 | 首页应是今日队列；全部单元属于近期活动 | 左栏=今日队列（按 source 分组）；近期活动独立页 |

## 五、沉浸式回顾的正确姿势

原型一次点一条「已回顾」，但插件没有条目级调度。两种自洽做法：

1. **推荐**：沉浸式只负责「读」——按 `sortIndex` 逐条展示注释/笔记，支持 ←/→ 翻页、`O` 打开原文；结束时弹出单元四档评分（1–4 快捷键）。条目状态不落库。
2. 若坚持条目级勾选：在 state 里加 `entryStates: { [key]: { status, at } }`，只作 UI 记忆、不参与 FSRS；升 schema v4 并处理迁移与同步笔记体积。不建议。

## 六、需要新增 / 补齐的接口

### 1. `getSettings()`（P0）

```js
{ enabled, openOnStartup, dailyCount, newCardLimit, boundaryHour, firstReviewDays,
  schedulerVersion, optimizerEligibleAt }
```

用途：顶栏显示「今日上限 20 · 新卡 6 · 4:00 换日」；设置摘要；优化器提示。现在页面拿不到这些值。

### 2. `previewGrades(unitId)`（P0）

```js
{ again: { dueAt, days }, hard: {...}, good: {...}, easy: {...} }
```

实现：`fsrs-adapter` 增加 `previewGrades(card, now)`，调用 ts-fsrs 的 `scheduler.repeat(card, now)`（vendor 5.4.2 已支持）。评分按钮直接写「没记住 · 1 天」「继续 · 3 天」，把 FSRS 的黑盒变成可预期。

### 3. `hydrateUnit` 补字段（P0）

- 注释 / 笔记补 `dateAdded`（条目时间与「最近新增」）；
- 父条目已删除时返回 `missing: true`，不要只靠标题判断；
- `recentUpdatedAt` 目前只在 notifier 重建时写入，初次建档为 `undefined`，导致「最后修改」排序实际退化；初始化时用 `lastActivityAt` 兜底。

### 4. `getDashboard()` 补 `completedToday`（P0）

队列快照在评分后不会移除单元，首页无法区分「今天已评过」。用 `lastReviewedAt` 与 `queue.dayKey` 比较，在 `units` 上返回 `completedToday`，或单独返回 `completedUnitIds`。

### 5. `setPaused()` / `setStopped()`（P2）

队列已过滤 `paused` / `stopped`，但没有任何入口。要做「暂时跳过这本书」才需要。

### 6. `retrievability`（P2）

`fsrs-adapter` 已有 `retrievability()`，但没暴露。要显示「记忆可提取性 82%」时再接到 `getUnit`。

## 七、建议的页面结构（与接口一一对应）

- **首页（今日队列）**
  - 顶栏：`queue.stats`（到期/新内容/历史）+ `stats`（已完成、Good/Again、practice）+ `getSettings()` 的容量 + 设置入口。
  - 左栏：队列单元按 due → new → backlog 分组；卡片显示标题、类型、来源、到期、注释/笔记数、优先级、`completedToday`。
  - 右栏：单元头（标题/作者/年份/类型/阅读日/页码范围）→ FSRS 面板（状态、到期、稳定度、难度、复习/遗忘、上次评分）→ 四档评分（带 `previewGrades`）→ 笔记 → 注释（分页、按页标签分组、打开原文）→ 新建笔记。
- **沉浸式**：只读逐条浏览 + 末尾评分，键盘 ←/→ 翻条、1–4 评分、Esc 退出。
- **近期活动**：`getRecentUnits`，排序（按 `lastActivityAt` / `recentUpdatedAt`）+ 加载更多。
- **随意回顾**：`getRecentUnits` 取样 + `recordPractice`，明确提示「不改变到期」。
- **首启 / 空态 / 错误 / 优化器资格**：单独状态位，不混进正常列表。

## 八、原型改造清单

P0（不改就无法接真实数据）：

- 用真实字段重写模拟数据；删除条目 `status`、进度条、「已回顾 x/y」、「待回顾 N 条」；
- 左栏改为队列分组（due / new / backlog），加 `completedToday` 与到期；
- 右栏加 FSRS 面板与四档评分；「开始逐条回顾」改成「浏览单元条目」；
- 删除「生成单元笔记」，换成「新建条目笔记」；
- 注释按返回顺序分组，不再数字排序；补加载更多；
- 顶栏接 `queue.stats` + `dailyStats` + 设置入口。

P1：

- 优先级、优化器资格提示、条目时间、父条目缺失态、首启加载/空态/错误态；
- 近期活动与随意回顾两个独立视图。

P2：

- 暂停/停止、`retrievability`、practice 备注、历史评分列表。
