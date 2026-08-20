# TechSpar Hono / TypeScript / Electron 迁移实施记录

> 状态：已完成代码迁移与本机桌面打包验证
>
> 完成日期：2026-08-20
>
> 当前分支：`main`

详细依赖规则见 [TypeScript 后端架构](typescript-backend-architecture.md)，运行方式见 [部署说明](deployment.md)。

## 1. 分支策略

- `main`：TypeScript + Bun + Hono + Electron 的唯一开发主线。
- `legacy/python-backend`：迁移前最后一个 Python + FastAPI 快照，固定在 `73d1a7c`，不再接收新功能。

旧分支只用于历史排查或紧急回看。任何回滚都必须停止新版、恢复迁移前的数据副本，再启动旧版；禁止两个分支同时写同一份 SQLite 或用户目录。

## 2. 最终结果

| 范围 | 落地结果 |
| --- | --- |
| 语言与工具链 | 主线运行代码全部为 TypeScript；Bun workspace、单一 `bun.lock` |
| API | Hono 4 + Zod/OpenAPI，覆盖 REST、两个 SSE 流和 Copilot WebSocket |
| 业务结构 | 模块化单体 + 六边形边界，核心用例与运行时/传输/供应商解耦 |
| 数据 | 兼容原 SQLite 和用户文件布局；原子 JSON；持久化后台任务 |
| 模型 | OpenAI-compatible LLM/Embedding；本地 Transformers.js + ONNX |
| 外部服务 | DashScope、Tavily、阿里云 OSS、腾讯云 VPR 的 TypeScript 适配器 |
| Web | React/Vite 保持复用，前端类型由 OpenAPI 生成 |
| Desktop | Electron 43，沙箱 Renderer、最小 Preload、编译 Bun/Hono sidecar |
| 部署 | Bun Web、Docker Compose、Electron 多平台打包配置 |

主线已删除 `backend/`、Python requirements、Python Dockerfile、Python 测试目录和前端 npm lockfile。旧 OpenAPI 基线移到 `tests-ts/contracts/fastapi-openapi.json`，只作为兼容对照数据。

## 3. 最终目录

```text
apps/
├── api/                  Hono app factory、路由和 Bun composition root
└── desktop/              Electron main/preload、sidecar 监督与 builder 配置
packages/
├── contracts/            Zod、OpenAPI 和传输协议
├── core/                 用例、状态机、领域类型、端口
├── db/                   SQLite repositories
├── platform/             配置、认证、文件和归档适配器
├── providers/            LLM、Embedding、ASR、OSS、搜索、声纹适配器
└── testing/              测试工具与 fakes
frontend/                 React Web 与 Electron Renderer
tests-ts/                 跨模块回归和旧 OpenAPI 基线
```

核心依赖方向：

```text
Hono routes / Electron host
            ↓
      core use cases
            ↓
     core-owned ports
            ↑
DB / files / model / cloud adapters
```

`scripts/check-boundaries.ts` 阻止 core/contracts 导入 Hono、Bun、Electron 或外层适配器，并检查 Hono app factory 不绑定 Bun。

## 4. 兼容策略

### HTTP 与 OpenAPI

迁移前 FastAPI 基线和当前 Hono OpenAPI 都有 **62 个路径、71 个 HTTP 操作**。契约测试比较方法与路径清单，前端 `schema.d.ts` 从当前 OpenAPI 生成。

路由保留既有状态码、认证方式和主要响应形状。兼容性不等于冻结未来演进；后续有意修改 API 时，应把破坏性变化作为单独版本工作处理。

### SSE 与 WebSocket

- `/api/interview/chat/stream` 保留 token、error、done/is_finished 事件语义。
- `/api/settings/rebuild-index` 保留逐步进度、完成和 fatal 事件。
- `/ws/copilot/:session_id` 保留二进制 PCM 输入与鉴权、ASR、建议、风险、监控和停止事件。

### 数据与认证

- 保留 bcrypt 密码兼容和 HS256 JWT 行为。
- 首次启动会安全创建默认管理员；已有账号不会因环境变量变化被覆盖。
- SQLite 和 `data/users/{user_id}` 继续作为事实数据；索引是可重建派生数据。
- 个人归档支持用户重绑定、幂等导入、敏感凭据默认排除。
- 全站归档使用一致性 SQLite 快照并校验 tar 路径、链接、checksum、重复项和解压上限。

## 5. 本地 Embedding 决策

Python 的 sentence-transformers/PyTorch 路径已由 Transformers.js + ONNX 替代。默认 `Xenova/bge-m3`，支持用户指定模型 ID 或本地路径，模型缓存可独立配置。

桌面后端通过 `bun build --compile` 生成单个可执行文件，并随应用携带当前平台的 ONNX Runtime 原生库。Transformers.js 的图像依赖在桌面文本专用构建中 fail-closed；如果将来加入图像 pipeline，必须显式打包并测试 Sharp，而不能悄悄扩大原生依赖。

实际验收还使用 `Xenova/all-MiniLM-L6-v2` 完成了“下载模型 → 登录 → 设置测试接口 → ONNX 推理”的编译后端冒烟链路。

## 6. Electron 架构

Electron 不在 Renderer 中运行 Node，也不复制业务逻辑：

1. Main 进程读取/创建权限为当前用户私有的随机运行密钥。
2. 选择 `127.0.0.1` 动态端口并启动编译后的 Bun/Hono sidecar。
3. 等待结构化 `techspar:ready` 消息，确认 API 真正就绪。
4. sidecar 从应用资源目录提供同源 React SPA、REST、SSE 和 WebSocket。
5. Main 只允许可信同源导航、受控 HTTPS 外链和当前 Renderer 的麦克风权限。
6. 退出时先优雅停止 sidecar，超时后才强制结束。

关键安全设置：

- `sandbox: true`
- `contextIsolation: true`
- `nodeIntegration: false`
- `webSecurity: true`
- Preload 仅暴露经过来源校验的运行时信息
- 单实例锁、导航限制、权限检查、严格静态资源 CSP

最终用户不需要安装 Bun；Electron、Web 资源、后端可执行文件和 ONNX 原生运行库一起打包。

## 7. 原子提交与切换记录

迁移按大块原子提交直接进入 `main`：

1. `a42026f feat(api): migrate backend to Bun and Hono`
2. `6977f6d feat(desktop): add packaged Electron client`
3. 文档、CI 与部署收尾提交（以 Git 历史为准）

在第一个提交前，远端 `legacy/python-backend` 已指向迁移前快照 `73d1a7c`。这样 Python 版本可追溯，但不会继续占据主分支。

## 8. 验证证据

本次收口时已通过：

- `bun install --frozen-lockfile`
- Bun 与 Node TypeScript 类型检查
- 架构边界检查
- **62 个 Bun 测试 + 3 个前端回归测试**
- 62 路径 / 71 HTTP 操作的旧 OpenAPI 清单对照
- API bundle、Vite production build、Electron main/preload build
- Bun API 与 Nginx Web 两个 Docker 镜像完整构建
- Electron 开发态启动冒烟
- macOS arm64 未签名 `TechSpar.app` 打包态启动冒烟
- Windows x64 NSIS 包及内置 Bun/ONNX PE 资源结构检查
- 编译后端真实 Transformers.js/ONNX 本地 Embedding 冒烟

测试按新架构的行为与风险重新分层，不宣称与旧版 66 个 Python 测试逐文件一一对应。关键覆盖包括认证、provider fallback/额度、知识与个人资料、简历/JD 状态机、任务恢复、Copilot、录音、声纹、归档安全和全站 SQLite 一致性快照。

## 9. 尚需发布环境完成的事项

以下不阻塞“迁移和 Electron 客户端代码完成”，但属于正式发行/生产运维职责：

- 使用真实 Apple Developer ID/Windows 证书签名；macOS notarization。
- 在真实 Windows 环境安装验收当前 x64 包；Linux runner 生成并安装验收 Linux 发行包。
- 用部署方自己的 DashScope、OSS、Tavily、腾讯 VPR 和商业 LLM 凭据做 live smoke；仓库测试不会携带或调用私有密钥。
- 生产切换前做完整数据备份、只读预检和回滚演练。
- 根据实际访问规模配置 TLS、反向代理请求体限制、日志与监控。

## 10. 后续演进规则

- 新业务继续放在 `packages/core` 的明确模块中，不回到全局 service 集合。
- Electron 优先复用同源 Hono 协议；只有真正需要系统能力时才增加最小 IPC。
- 数据 schema 迁移必须手写、可备份、可验证，禁止无审查自动重建旧表。
- provider 配置、连通性测试和运行时必须共享同一规范化逻辑。
- 不重新引入 Python sidecar；确有无法替代的能力时，先形成独立架构决策和迁移影响说明。
