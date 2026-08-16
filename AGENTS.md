# SpeakFlow 工程规范

## 产品背景

SpeakFlow 是一个 AI 英语对话学习 Web 应用，主打陪伴式、朋友式的英文对话体验。

用户可以与 AI 进行自然的英文交流，在持续对话中提升表达能力。AI 需要具备持久化记忆，能够记住用户曾经提到的信息、偏好和对话上下文，让后续交流更像与熟悉的朋友聊天。未来可能支持 AI 性格设定，例如语气、表达风格和陪伴方式。

产品界面和功能应尽可能简洁，优先保证对话体验，不引入与核心交流无关的复杂功能。

当前 MVP 实现文字和回合制语音对话闭环：

1. 用户进入聊天页面。
2. 用户输入英文消息，或使用浏览器语音识别生成可编辑的英文文本。
3. AI 返回英文回复。
4. 页面展示连续聊天记录，并可使用服务端 CosyVoice 朗读新回复。
5. 刷新或重新进入后，能够恢复必要的聊天记录和记忆。

语音功能保持回合制：浏览器负责语音识别，服务端代理 CosyVoice 语音合成。应用不保存音频，也不提前扩展为实时双向通话。

## 业务模块职责

- `chat`：负责 AI 聊天页面、消息列表、消息输入、发送状态、错误处理和聊天上下文。
- `memory`：负责用户记忆的生成、展示、编辑、删除和持久化，为 AI 提供后续聊天所需的记忆上下文。
- `profile`：负责用户基本信息、英语学习偏好和聊天偏好，为后续个性化聊天提供配置。
- `personality`：预留 AI 性格和交流风格相关能力，例如语气、角色设定和陪伴方式；MVP 阶段可以暂不实现。
- `shared`：存放跨业务复用的 UI 组件、基础模型、通用工具和基础数据访问能力。

MVP 阶段优先实现 `chat` 和 `memory`，`profile` 只保留必要配置，`personality` 先预留模块边界，不提前实现复杂功能。

## 项目架构

- 本项目是基于 Nx Integrated Monorepo 的 Angular Standalone 应用。
- 按业务领域组织代码，包括 `chat`、`memory`、`profile`、`personality` 和 `shared`。
- 应用项目应保持轻量，业务逻辑应放在 library 中。
- Feature library 可以依赖 data-access、ui、models 和 shared library。
- Shared library 不得依赖具体业务领域的 library。
- 只有至少被两个业务领域使用的组件，才能移动到 shared 中。

推荐的业务 library 结构：

```text
libs/
├── chat/
│   ├── feature/
│   ├── data-access/
│   ├── ui/
│   └── models/
├── memory/
│   ├── feature/
│   ├── data-access/
│   ├── ui/
│   └── models/
├── profile/
│   └── models/
├── personality/
└── shared/
```

`personality` 在 MVP 阶段只预留模块边界，不提前生成复杂实现。

## Angular

- 使用 Standalone Component，不创建 NgModule。
- 业务组件默认使用 `ChangeDetectionStrategy.OnPush`；特殊情况可以说明原因后使用 Default。
- Angular 组件样式统一使用 SCSS；Nx generator 的组件样式默认值保持为 `scss`。
- 优先使用 `inject()` 进行依赖注入。
- 非简单表单使用 Angular Reactive Forms。
- 顶级业务页面使用懒加载路由，小型 UI 组件不做不必要的懒加载。
- 保持模板声明式，将业务逻辑移出模板。
- 除非确实需要执行命令式副作用，否则不要在组件中手动调用 `subscribe()`。
- 必须进行命令式订阅时，使用 `takeUntilDestroyed()` 管理订阅生命周期。

## RxJS

- 异步 API 请求使用 Angular HttpClient 返回的 Observable。
- 请求组合、取消、重试和错误处理应放在 data-access service 或 facade 中。
- 当新请求应该取消旧请求时，使用 `switchMap`。
- 当一个操作执行期间需要忽略重复提交时，使用 `exhaustMap`。
- 当操作必须按照顺序执行时，使用 `concatMap`。
- 当状态由多个持续变化的数据源派生时，使用 `combineLatest`。
- 只有确实需要共享和回放最近结果时，才使用 `shareReplay({ bufferSize: 1, refCount: true })`。
- 禁止嵌套订阅。
- 禁止在一个 `subscribe()` 中再次调用 `subscribe()`。
- 除非必须跨越一个只接受 Promise 的 API 边界，否则不要将 Observable 转换为 Promise。
- 必须明确处理加载、成功、空数据和错误状态。
- 应在能够提供有意义恢复策略的代码层处理 `catchError`。
- 不得使用 `any` 绕过 Observable 的类型检查。

## Signal 与 RxJS

- Signal 用于同步的局部 UI 状态。
- RxJS 用于异步流程、事件流、请求协调、请求取消和重试。
- 仅在明确的边界处使用 `toSignal()` 或 `toObservable()`。
- 不要同时使用 Signal 和 Observable 保存同一份状态。

## TypeScript

- 启用并保持严格类型检查。
- 禁止使用 `any`；类型未知时使用 `unknown`，并通过类型收窄进行处理。
- 使用可辨识联合类型描述领域状态，避免使用可能相互冲突的多个布尔变量。
- 当 API DTO 与领域模型结构不同时，将两者分开定义。
- 优先使用不可变更新。
- Service 和 facade 的公开方法应声明明确的返回类型。
- 复杂逻辑使用简短注释解释设计原因和关键约束，不添加逐行或重复代码含义的注释。
- 协作说明代码时，应先说明目标，再解释关键类型、语法和设计取舍，并给出对应的格式化、类型检查或测试命令。

## 代码格式

- 所有受版本控制的代码和配置文件应持续保持 Prettier 格式。
- 提交前对受影响文件运行 `npx prettier --check`；需要格式化时使用 `npx prettier --write`。
- 使用 Nx generator 后，应检查并清理无关文件的自动格式化变化，避免将格式噪音混入功能性 commit。

## UI 样式

- 聊天主界面必须保持极简，只展示完成核心对话所需的信息和操作；设置、偏好开关、管理入口等非核心控件默认不得放入聊天主界面，确需新增时应先确认产品必要性和放置位置。
- `apps/speak-flow/src/app/practice-welcome.ts` 是本项目 UI 样式的主要参考文件；新增页面和组件应优先参考其中的排版、间距、色彩、响应式布局和交互状态。
- 业务组件样式仍使用独立的 SCSS 文件，只提取实际需要的设计规则，不要复制整个 starter 模板或无关的全局 reset 样式。
- 当设计决策与参考文件不一致时，应在组件或 feature 的边界内明确实现，避免把一次性业务样式扩散到全局。

## 组件

- Feature 组件负责协调状态和用户事件。
- UI 组件通过 Input 接收数据，通过 Output 发出用户意图。
- UI 组件不得直接调用业务 API。
- 避免在一个组件中组合互不相关的业务区域。
- 交互控件使用语义化 HTML，并提供可访问名称。
- 使用 `@for` 渲染业务实体时，通过稳定且唯一的业务标识进行追踪，例如 `track message.id`；仅固定且不会重排的静态列表可以使用 `track $index`。

## 测试

- 使用 Vitest 编写单元测试。
- 测试 RxJS 流程、表单规则、状态转换和错误恢复。
- 避免只验证内部实现细节的测试。
- 修复行为缺陷时，应添加对应的回归测试。
- 在项目明确选定 E2E 工具之前，不要引入 E2E 测试框架。

## Nx 项目与缓存

- 新建 library 必须使用 Nx generator，或补齐等价的 `project.json`、TypeScript 和测试配置。
- 新建 library 后运行 `npx nx show projects`，确认其已被 Nx project graph 识别。
- 修改 library、路径别名或项目依赖关系后，最终验证至少运行一次带 `--skip-nx-cache` 的受影响测试。
- 不得仅根据 Nx 缓存命中的测试结果判断新代码通过。

## Git

- Commit message 使用英文。
- 使用不带 scope 的简洁 Conventional Commits 格式，例如 `feat: add chat message input`。

## 完成标准

完成代码变更前：

1. 运行受影响 Nx 项目的相关测试。
2. 运行受影响项目的 lint。
3. 修改路由、项目配置或共享代码时，运行生产构建。
4. 汇报已经执行的检查，以及因条件限制而未能执行的检查。
