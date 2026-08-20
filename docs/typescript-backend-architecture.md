# TechSpar TypeScript 后端架构

> 决策：模块化单体 + 六边形架构
>
> 适用：Hono/Bun 服务端，以及 Electron 主进程 + 编译 Bun sidecar 宿主

## 1. 架构目标

迁移不是把 `backend/*.py` 逐文件翻译成 `.ts`。新结构需要同时解决：

- HTTP、SSE、WebSocket 与业务逻辑分离；
- 用户身份、取消信号和调用链上下文显式传递；
- SQLite、文件、LLM、Embedding、ASR、OSS 可替换和可测试；
- 长任务可恢复、可取消、可幂等重试；
- Web 服务与 Electron sidecar 共享同一套业务和传输契约；
- 在保持旧数据和接口兼容的前提下，阻止新的全局状态和跨模块耦合。

本项目保持单体部署，不引入微服务、消息中间件或分布式事务。边界先在代码中成立，未来确有扩展需要时再拆进程。

## 2. 四层结构

```text
┌─────────────────────────────────────────────────────────────┐
│ Hosts                                                       │
│ apps/api (Hono/Bun)       apps/desktop (Electron -> sidecar)│
├─────────────────────────────────────────────────────────────┤
│ Inbound adapters                                             │
│ REST routes  SSE routes  WebSocket gateway  CLI/import tools│
├─────────────────────────────────────────────────────────────┤
│ Core modules                                                 │
│ domain types + use cases + state machines + owned ports      │
├─────────────────────────────────────────────────────────────┤
│ Outbound adapters                                            │
│ SQLite  files  OpenAI-compatible  local ONNX  ASR  OSS  jobs │
└─────────────────────────────────────────────────────────────┘
```

依赖只能向内：

- Host 可以依赖所有适配器并负责组装；
- 入站适配器只依赖 contracts 和 core 的公开用例；
- core 不依赖 Hono、Drizzle、Bun、Node、Electron 或供应商 SDK；
- 出站适配器实现 core 拥有的端口；
- contracts 只定义外部协议，不承载业务决策。

## 3. 业务模块

`packages/core/src/` 按业务能力划分：

| 模块 | 拥有的状态与规则 | 允许调用的外部端口 |
| --- | --- | --- |
| `account` | 用户、登录、注册策略、管理员判定 | UserRepository、PasswordHasher、TokenService、IdGenerator |
| `provider` | 用户/平台配置选择、配额、模型调用记账 | ProviderConfigRepository、UsageRepository、Chat/Embedding gateway |
| `knowledge` | 文档解析后的领域模型、chunk、索引生命周期、检索 | KnowledgeRepository、FileStore、Embedding gateway、VectorRepository |
| `personal-agent` | 个人文档、对话、长期记忆 | DocumentRepository、ConversationRepository、MemoryRepository、Chat gateway |
| `interview` | 专项训练、简历/JD 流程、评分和会话恢复 | SessionRepository、ResumeReader、KnowledgeQuery、Chat gateway |
| `profile` | 画像、主题掌握度、SM-2 复习和图谱投影 | ProfileRepository、SessionQuery、VectorRepository |
| `recording` | 转写/分析任务状态机 | TaskRepository、ObjectStore、Transcription gateway、Chat gateway |
| `copilot` | prep、策略树、实时会话、回答建议和监控 | PrepRepository、ASR、VAD、Voiceprint、Search、Chat gateway |

模块不得直接读取另一个模块的表或用户文件。跨模块协作通过公开 query/use case，例如 `interview` 调用 `KnowledgeQuery`，而不是导入 `knowledge` 的 SQLite repository。

## 4. 模块内部结构

每个模块按需要使用以下结构，不强制制造空目录：

```text
account/
├── model.ts             # 领域类型和值对象
├── ports.ts             # 此模块需要的出站端口、公开用例接口
├── auth-service.ts      # 应用用例
└── auth-service.test.ts # 纯内存单测
```

规则：

- `model.ts` 不做 I/O；
- `ports.ts` 由使用端拥有，而不是由数据库包拥有；
- 用例构造函数接收依赖，禁止隐藏的 service locator；
- 预期失败使用明确的 `AppError` 子类；意外异常交给最外层统一记录；
- 时间、随机 ID 和重试等待都可注入，确保测试确定性；
- 核心返回领域结果，不返回 Hono `Response`、数据库 row 或供应商 SDK object。

## 5. 外部契约

`packages/contracts` 是前端与后端共享的边界语言：

- Zod request/response schema；
- OpenAPI metadata；
- SSE event union；
- WebSocket client/server discriminated union；
- 稳定错误 code。

路由流程固定为：

```text
HTTP input
  -> Zod validation
  -> RequestContext(userId/requestId/signal)
  -> core use case
  -> response mapper
  -> contract-validated output
```

contracts 不导入 Hono。Hono 的 `createRoute` 和 transport-specific metadata 留在 `apps/api`，这样 Electron IPC 可以复用相同 Zod schema。

## 6. 上下文与鉴权

禁止复制 Python `ContextVar` 模式。所有需要用户隔离的用例显式接收：

```ts
type RequestContext = {
  requestId: string
  userId?: string
  signal: AbortSignal
}
```

- HTTP middleware 只负责验证 token 并构造 context；
- WebSocket 在 upgrade 前验证 token，失败以 1008 关闭；
- provider、repository 和任务提交都从 context 获取显式 userId 参数；
- 后台任务保存 userId 与必要输入，不能依赖发起请求的内存上下文；
- `AbortSignal` 必须传到 LLM/Embedding/ASR 和 SSE 生成链路。

## 7. 持久化边界

SQLite 与用户文件共同构成当前数据模型，但不能假装它们有统一事务。

- SQLite 操作由 repository 封装；多表原子操作通过 Unit of Work/单个事务完成；
- JSON 写入使用同目录临时文件、flush 后原子替换；
- “数据库 + 文件”用例先写可恢复的事实，再执行派生写入；失败时记录状态或执行补偿；
- 向量、图谱投影和 `.index_cache` 是可重建派生数据；
- schema migration 必须手写、带版本、可备份和可验证，禁止生产自动 `push`；
- Web 与 Electron 都使用同一套 Bun SQLite repository；repository contract tests 直接覆盖真实 SQLite 和临时用户目录。

`packages/db` 只能导出 repository 实现和 schema，不允许路由层直接使用 Drizzle 查询。

## 8. Provider 边界

每种能力定义最小端口：

```ts
interface ChatGateway {
  complete(request: ChatRequest, context: RequestContext): Promise<ChatResult>
  stream(request: ChatRequest, context: RequestContext): AsyncIterable<ChatEvent>
}

interface EmbeddingGateway {
  embed(texts: readonly string[], context: RequestContext): Promise<readonly Float32Array[]>
}
```

provider 解析、配额和记账属于应用逻辑；OpenAI-compatible、Transformers.js、DashScope 等只是适配器。供应商响应先转换为内部类型，禁止泄漏到 interview/copilot 模块。

Embedding 缓存以 `(userId, normalized provider signature)` 为键，并有明确失效方法；不使用全局隐式当前用户。

## 9. 长任务

录音转写、索引重建、Copilot prep 等统一使用持久化任务模型：

```text
queued -> running -> succeeded
                  -> failed
                  -> cancelling -> cancelled
```

每个任务保存：`taskId`、`userId`、`type`、`status`、`progress`、`inputRef`、`resultRef`、`error`、`attempt`、`idempotencyKey`、时间戳。

- HTTP 只提交/查询/取消任务；
- Bun 首版可在同进程 worker 执行，但状态必须落 SQLite；
- 启动时将遗留 `running` 恢复为 `queued` 或明确失败；
- handler 必须可幂等重试；
- Electron 由同一个编译后的 Bun sidecar 执行 worker，主进程只负责监督生命周期，无需改变用例。

## 10. 实时链路

Copilot 拆为三部分：

1. `CopilotSession`：纯状态机，处理 start/audio/final transcript/manual/stop；
2. `RealtimeOrchestrator`：协调 ASR、VAD、voiceprint、LLM 和监控；
3. `WebSocketGateway`：解析/验证协议，处理背压和关闭码。

音频 chunk 和供应商 callback 不直接写 WebSocket。它们先产生内部 event，再由 gateway 映射为 contracts 中的 server event。这样可用录制 PCM 在无网络条件下测试完整状态机。

## 11. 组合入口

只有 composition root 知道所有具体实现：

```text
apps/api/src/entry.bun.ts
  -> load config
  -> open Bun SQLite + repositories
  -> create provider adapters
  -> create core use cases
  -> create Hono routes
  -> start Bun server/worker

apps/desktop/src/main.ts
  -> create private runtime secrets and a dynamic loopback port
  -> spawn compiled apps/api Bun executable
  -> wait for structured readiness and load the same-origin React/Hono URL
  -> expose only constrained runtime-info IPC
```

`createApp()` 接收公开用例接口，不在内部 new 数据库、SDK 或业务 service。

## 12. 自动守卫

CI 必须自动检查：

- core/contracts 不导入 Hono、Bun、Electron、Drizzle 或 adapter package；
- `apps/api/src/app.ts` 不引用 `bun:*` 或 `Bun.*`；
- core/contracts/providers 通过 Node 类型检查；
- repository contract tests 使用真实 Bun SQLite 和临时数据目录运行；
- OpenAPI、SSE、WebSocket schema 与基线对照；
- 所有模块使用显式 userId，不出现“当前用户”全局变量；
- route handler 只做 transport mapping，复杂度超过阈值时必须下沉用例。

## 13. 暂不采用的设计

- 不做微服务：当前部署和数据模型不需要网络边界；
- 不上事件溯源/CQRS 框架：状态机和 query 接口足够，避免复杂度失控；
- 不引入全局依赖注入容器：显式 composition root 更容易追踪；
- 不让 tRPC 替换 REST：需要保持现有 OpenAPI 和前端兼容；
- 不把所有对象抽象成 repository：只对真实 I/O 边界建端口；
- 不为了“DDD”制造大量无行为 class：优先纯函数、明确类型和小型用例服务。
