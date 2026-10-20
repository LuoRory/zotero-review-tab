# 回顾页面 · 开发交接文档

配套原型：[review-page-v2.html](review-page-v2.html)。原型里的数字、标题、注释都是**占位数据，不需要让数据层去匹配**；实现时要对齐的是「每个控件调用哪个接口」，见 §3。也可以用浏览器直接打开原型，点一遍评分、优先级、逐条浏览，确认交互预期。

## 1. 范围

本次只重构「回顾」主页面：

- 今日队列（左栏）
- 单元详情（右栏）
- 逐条浏览（覆盖层）

不在本次范围：近期活动页、随意回顾页、设置面板本身、暂停/停止、条目级状态、「生成单元笔记」。这些沿用现有实现或后续单独设计。

## 2. 页面结构

```text
App
├─ Header            标题 / 队列统计 / 设置
├─ ListPane          分组列表：到期 → 新内容 → 历史重温 → 今日已完成
│  └─ UnitCard       类型、标题、作者、来源、计数、到期/活动、优先级
└─ DetailPane
   ├─ DetailHead     标题、元信息、优先级、逐条浏览
   ├─ FsrsSummary    状态 / 到期 / 上次回顾 / 稳定度 / 难度 / 复习与遗忘
   ├─ GradeBlock     四档评分 + 记录浏览
   ├─ NotesSection   笔记预览、打开笔记、新建笔记
   └─ Annotations    按页分组、打开原文、加载更多
└─ ImmersiveDialog   逐条浏览 → 结束页评分
```

## 3. 操作接口映射（核心）

| # | 控件 | 位置 | 插件接口 | 调用 | 成功反馈 | 失败/降级 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 选择单元 | 左栏卡片 | `getUnit` | `getUnit(id, { annotationOffset: 0, annotationLimit: 100 })` | 右栏渲染详情 | 显示错误条，保留列表与当前选中 |
| 2 | 四档评分 | 详情评分区 / 逐条浏览结束页 | `gradeUnit` | `gradeUnit(id, rating)`，rating 为 1–4 | 用返回的 `card.effectiveDueAt` 显示「下次回顾」；刷新统计；卡片转入「今日已完成」 | 按钮禁用至返回；失败恢复并提示 |
| 3 | 记录浏览 | 评分区下方链接 | `recordPractice` | `recordPractice(id)` | Toast：已记录浏览，不影响到期 | 提示错误，不改变任何状态 |
| 4 | 优先级 | 详情头按钮 | `setPriority` | `setPriority(id, next)`，`normal → high → core → normal` | 图标与文案立即更新 | 失败回滚文案并提示 |
| 5 | 逐条浏览 | 详情头按钮 | 无（本地视图） | 用已加载的注释 + 笔记组成队列 | 打开覆盖层 | 无条目时按钮禁用 |
| 6 | 在 PDF 中打开 | 注释行 / 覆盖层 | `openAnnotation` | `openAnnotation(key, tabID)` | Zotero 打开 PDF 并定位 | 调用失败时提示 |
| 7 | 打开笔记 | 笔记行 | `openNote` | `openNote(key)` | 打开笔记编辑器 | 提示错误 |
| 8 | 新建笔记 | 笔记区右上 | `newNote` | `newNote(parentRef)` | 打开 Zotero 原生新建笔记 | 提示错误 |
| 9 | 加载更多 | 注释区底部 | `getUnit` | `getUnit(id, { annotationOffset: loaded, annotationLimit: 100 })` | 追加注释、去重、更新「加载更多」 | 保留已加载内容并提示 |
| 10 | 设置 | 顶栏 | `openPreferences` | `openPreferences()` | 打开插件设置面板 | 无法打开时保留页面 |
| — | 主题切换 | 顶栏 | 仅原型 | — | 原型演示用，**实现时删除** | — |

补充：

- 评分后不要从队列快照里删除单元；`queue.items` 是当天快照。用 `units[].completedToday`（建议后端补，见 §6）或视图内 `gradedToday` 集合标记，刷新后仍能显示「今日已完成」。
- `gradeUnit` 的返回值直接包含新卡，不要自己算到期。
- 「逐条浏览」不是接口，是本地浏览模式；不要因此给条目加 `done/later` 状态。

## 4. 页面状态

| 状态 | 触发 | 表现 |
| --- | --- | --- |
| 首次建档 | `ensureInitialContent()` 未完成 | 顶栏 + 居中的「正在整理笔记与注释…」；不要渲染空列表 |
| 加载详情 | 选中单元后 `getUnit` 未返回 | 右栏骨架/「正在加载单元…」，保留标题与左栏 |
| 空队列 | `getDashboard().units` 为空 | 左栏空态：「今天没有待回顾内容」；右栏空态 |
| 无笔记 | `unit.notes.length === 0` | 「还没有条目笔记。新建笔记会打开 Zotero 原生编辑器。」 |
| 无注释 | `unit.annotations.length === 0` | 「这个单元还没有 PDF 注释。」 |
| 父条目已删除 | `hydrateUnit` 返回占位标题 | 标题显示「已删除的 Zotero 条目」，禁用新建笔记与逐条浏览，保留说明 |
| 评分中 | 点击四档之一 | 四个按钮禁用，当前按钮显示进行中；防止连点 |
| 评分失败 | `gradeUnit` 抛错 | 恢复按钮，Toast/错误条，不改变卡片状态 |
| 加载更多失败 | `getUnit` 抛错 | 保留已有注释，按钮恢复可点 |
| 注释超过 100 条 | `hasMoreAnnotations` 为真 | 显示「加载更多（已加载 / 总数）」；追加时按 `key` 去重 |

## 5. 组件规格

### 5.1 Header

- 统计从 `getDashboard()` 来：`queue.stats.due / new / backlog`、`stats.fsrsCompleted`。
- 剩余数 = 队列单元中未完成的数量；不要直接用 `queue.stats` 减，快照不会随评分更新。
- 「今日已完成 N / 总数」中的 N 由 `completedToday` 统计。
- 设置按钮调用 `openPreferences()`。

### 5.2 UnitCard

- 整卡是 `<button>`，`aria-pressed` 表示选中；键盘 Enter/Space 可用。
- 类型：`unitType === 'article'` → 论文；`book-session` → 书籍。书籍额外显示 `sessionDay`。
- 来源徽标：`due` 到期 / `new` 新内容 / `backlog` 历史重温；已完成显示「已完成」。
- 日期：有 `fsrsCard` 显示 `effectiveDueAt`；没有则显示 `lastActivityAt` 并加「活动」前缀，避免被误解为到期。
- 优先级：`high` 用 ⚑，`core` 用 ◆，`normal` 不显示。
- 已完成卡片降低不透明度，但仍可点开查看。

### 5.3 DetailHead

- 标题、类型、作者、年份；书籍加 `sessionDay` 和 `pageRange`。
- 优先级按钮循环切换；文案「优先级：普通 / 高 / 核心」。
- 逐条浏览按钮显示条目数（已加载注释 + 笔记）；数量为 0 时禁用。

### 5.4 FsrsSummary

- 有卡：状态（0 新卡 / 1 学习中 / 2 复习中 / 3 重学中）、下次到期、上次回顾、稳定度、难度、复习/遗忘。
- 无卡：显示「尚未开始」「最近活动」「注释 / 笔记」，并提示首次评分后进入调度。
- 字段缺失时整格隐藏，不要显示 `NaN`。

### 5.5 GradeBlock

- 四个按钮固定顺序：没记住（1）/ 困难（2）/ 继续（3）/ 容易（4）。
- 原型在按钮下显示「N 天后」；这需要 `previewGrades()`（见 §6，可选）。没有该接口时隐藏小字，只保留按钮。
- 评分后显示绿色横幅：「今天已评分：继续 · 下次回顾 10月28日」，并提供「再评一次」。
- 「记录一次浏览」调用 `recordPractice`，明确写「不改变到期」。
- 文案必须说明评分只作用于单元、不修改笔记与注释。

### 5.6 NotesSection

- 用 `stripHTML(note.html)` 生成纯文本预览，最多三行（CSS `-webkit-line-clamp`）。
- 「打开笔记」→ `openNote(key)`；「新建笔记」→ `newNote(parentRef)`。
- 笔记内容一律用 `textContent` 写入，禁止拼进 `innerHTML`。

### 5.7 Annotations

- 顺序以 `getUnit` 返回顺序为准（`sortIndex`），不要按 `pageLabel` 数字排序；`pageLabel` 可能是罗马数字或空串。
- 相邻同页合并成一个分组；空 `pageLabel` 显示「未标页码」。
- 颜色条用 `annotation.color`，缺失时用中性色；类型用 `annotationTypeLabel(type)`。
- 有 `comment` 才显示评论块。
- 「在 PDF 中打开」→ `openAnnotation(key, tabID)`。

### 5.8 ImmersiveDialog

- 条目队列 = 已加载注释（原顺序）+ 笔记。
- 顶部进度「当前 / 总数」；覆盖层 `role="dialog"`、`aria-modal="true"`。
- 键盘：←/→ 切换，`O` 打开原文（仅注释），`Esc` 关闭；结束页 `1–4` 评分。
- 结束页：未评分显示四档评分；已评分显示「今天已经评过分了」+ 关闭。
- 关闭后焦点回到「逐条浏览」按钮；打开时锁定背景滚动。
- 覆盖层内点击评分后保持打开，显示完成态，不自动关闭。

## 6. 数据映射

实现时直接消费现有 DTO：

| 页面元素 | 字段 |
| --- | --- |
| 卡片标题/作者/年份 | `title` / `creator` / `year` |
| 类型/阅读日/页码 | `unitType` / `sessionDay` / `pageRange` |
| 来源 | `queue.items[].source`（`getDashboard` 里也会映射为 `queueSource`） |
| 调度 | `fsrsCard.state / effectiveDueAt / stability / difficulty / reps / lapses`、`lastReviewedAt` |
| 计数 | `annotationTotal`、`notes.length` |
| 注释 | `annotations[].key / type / text / comment / color / pageLabel` |
| 笔记 | `notes[].key / html` |
| 分页 | `annotationTotal`、`hasMoreAnnotations` |
| 统计 | `queue.stats`、`stats.fsrsCompleted / good / again / practice` |

注意：`getDashboard().units` 是 `detail: false` 的水合结果，`notes` / `annotations` 为空数组。**选中单元后必须再调 `getUnit()` 才能拿到内容。**

### 可选接口（不做也能上线）

| 接口 | 用途 | 建议实现 |
| --- | --- | --- |
| `completedToday`（dashboard unit 字段） | 今日已完成标记与剩余数 | `lastReviewedAt` 与 `queue.dayKey` 用同一 `boundary` 比较 |
| `previewGrades(unitId)` | 按钮上的「N 天后」 | adapter 调 `scheduler.repeat(card, now)` |
| `getSettings()` | 顶栏显示每日上限/换日时间 | 返回 prefs 与 `optimizerEligibleAt` |

## 7. 视觉与主题

- 原型 Token 已按 Zotero 7 变量命名：`--fill-primary`、`--fill-secondary`、`--fill-quaternary`、`--text-primary/secondary/tertiary`、`--accent-blue`、`--accent-green`。实现时换成 Zotero 变量，删除 `[data-theme]` 与主题切换按钮。
- 字体：原型用固定 12px 与系统字体；插件里改为 `font: menu`，字号继承 Zotero UI，不要锁死。
- `color-mix()` 在 Zotero 7 的 Firefox 115 可用；若担心旧版，用预计算 rgba。
- 左栏 340px；宽窗口下页面不整体滚动，左右两栏各自滚动。窗口宽度 < 900px 时上下堆叠：整页滚动，左栏最大高度 34vh 且自身滚动，顶栏统计换到第二行。
- 不要用 hover 才显示操作按钮；所有操作始终可见或用 `:focus-visible` 补足。

## 8. 实现约束

- 继续用 `content/review-tab.js` 的 `ReviewTabView`，vanilla DOM，不引入框架。
- 用户内容（标题、注释、评论、笔记）必须走 `textContent` 或先 `escapeHTML`；禁止把 `note.html` / `annotation.text` 直接拼进 `innerHTML`。
- 不改同步状态 schema，不写用户笔记，不修改注释；所有写操作只走 §3 的接口。
- 键盘监听绑在标签页根节点或做 `tabID` 判断，避免影响 Zotero 其它窗口。
- 异步按钮加 `busy` 标志；评分失败要恢复按钮。
- 保留现有 `cleanText` / `notePreview` / `annotationTypeLabel` 等工具，不要重复造。
- 原型里的 `alert()` 全部换成 Toast 或内联错误条。

## 9. 验收清单

- [ ] 四个评分按钮分别调用 `gradeUnit(id, 1..4)`，返回后用新卡显示下次到期
- [ ] 「记录一次浏览」调用 `recordPractice`，到期日不变
- [ ] 优先级在 普通 → 高 → 核心 之间循环，并调用 `setPriority`
- [ ] 每条注释可调 `openAnnotation(key, tabID)`，每条笔记可调 `openNote`
- [ ] 新建笔记调 `newNote(parentRef)`，不直接写笔记内容
- [ ] 选中单元先显示加载态，再调 `getUnit` 渲染详情
- [ ] 超过 100 条注释时能追加、去重、保留滚动位置
- [ ] 沉浸式 ←/→/O/Esc/1–4 可用，关闭后焦点回到触发按钮
- [ ] 暗色与窄窗口（700px）下不重叠、不截断操作
- [ ] 空队列、无笔记、无注释、父条目删除均有独立空态
- [ ] 评分/加载失败有可见提示且可重试
- [ ] 页面不出现条目级 done/later，不出现「生成单元笔记」

## 10. 与现有代码的对应

| 现有 | 处理 |
| --- | --- |
| `renderHome()` 的统计卡 + 卡片网格 | 由新 Header + ListPane 取代 |
| `renderDetail()` | 由新 DetailPane 取代；保留 `getUnit` 分页逻辑 |
| `renderRecent()` / `renderPractice()` | 本次不动 |
| `bind()` 的事件绑定 | 改为按区域绑定；保留 `data-*` 方式 |
| `review-tab.css` | 按原型重写主页面样式；保留 `.rt-status` 等通用类 |

建议实现顺序：静态结构 → 列表与详情取数 → 评分/浏览操作 → 分页与空态 → 键盘与可访问性 → 主题与窄窗口。

## 11. 原型自检记录

用无头 Chromium 在 1280×860 与 760×900 下跑过：首屏、评分后、切换到无卡单元、逐条浏览、浏览结束评分、暗色、窄窗口，均无控制台报错，交互符合 §3 的调用约定。
