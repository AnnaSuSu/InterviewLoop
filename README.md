<div align="center">

<img src="images/techspar-horizontal-logo.svg" alt="TechSpar" width="520" />

**把专项训练、简历面试、JD 备面、实时 Copilot 与录音复盘，串成一个持续进化的技术面试闭环。**

[在线 Demo](https://techspar.top/) · [快速开始](#快速开始) · [English](README.en.md)

[![Bun](https://img.shields.io/badge/Bun-1.3+-000000.svg)](https://bun.sh/)
[![Hono](https://img.shields.io/badge/Hono-4-E36002.svg)](https://hono.dev/)
[![Electron](https://img.shields.io/badge/Electron-43-47848F.svg)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg)](LICENSE)

![TechSpar 产品总览](images/techspar-overview.png)
</div>

TechSpar 不只是生成一组面试题。专项训练、简历面试、JD 备面、实时 Copilot 和录音复盘共用同一套长期画像、知识库、薄弱点和复习调度；每轮结果会写回系统，改变下一轮训练重点。

## 版本与分支

- **`main`**：当前版本。后端已完全迁移为 TypeScript + Bun + Hono，使用 Bun workspace 统一管理前后端依赖；新功能和修复都在这里继续。
- **`legacy/python-backend`**：迁移前最后一个 Python + FastAPI 版本，固定在提交 `73d1a7c`，只作为历史归档和紧急回看，不再接收新功能。

查看旧版时必须使用独立 checkout 和迁移前的数据副本。推荐从当前 `main` checkout 创建只读 worktree：

```bash
git fetch origin legacy/python-backend
git worktree add --detach ../TechSpar-python-legacy origin/legacy/python-backend
cp -R /path/to/pre-migration-data-backup/. ../TechSpar-python-legacy/data/
```

也可以把 `legacy/python-backend` 单独 clone 到另一个目录。不要在当前工作目录直接切换分支，不要软链接或复用 `data/`，也不要让新旧服务同时连接同一份 SQLite、用户文件或模型缓存。没有迁移前备份时，只用空数据启动旧版做代码回看。

## 功能闭环

- **专项强化训练**：结合题库、知识库、历史薄弱点和掌握度动态出题。
- **简历模拟面试**：读取简历并按自我介绍、技术问题、项目深挖、反问环节推进。
- **JD 定向备面**：拆解岗位描述，结合简历与历史画像生成岗位相关策略和问题。
- **实时 Copilot**：实时 ASR、追问方向预测、回答建议、风险提示，以及可选声纹角色识别。
- **录音复盘**：转写长短录音，结构化 Q&A，输出逐题分析与改进建议。
- **长期画像**：汇总强项、薄弱点、训练轨迹，并通过 SM-2 安排复习。
- **个人资料库**：导入 PDF、DOCX、Markdown 和文本，为训练与个人 Agent 提供上下文。
- **数据迁移**：导出/导入单账户或管理员全站归档；个人敏感凭证默认不导出。

## 快速开始

### 环境要求

- Bun `1.3.14` 或兼容的 `1.3.x`
- macOS、Linux 或 Windows

已经构建好的桌面客户端自带 Electron 和编译后的 Bun 后端，最终用户不需要另外安装 Bun。

源码开发或本机构建先执行：

```bash
git clone https://github.com/AnnaSuSu/TechSpar.git
cd TechSpar
bun install --frozen-lockfile
cp .env.example .env
```

### Electron 桌面客户端

已发布版本可从 [GitHub Releases](https://github.com/AnnaSuSu/TechSpar/releases) 下载 macOS 与 Windows 安装包。

开发模式会同时启动 Vite、Hono 和 Electron：

```bash
bun run dev:desktop
```

构建当前平台的可运行应用目录：

```bash
bun run pack:desktop
```

构建当前平台的安装包/归档文件：

```bash
bun run dist:desktop
```

构建正式发布目标：

```bash
bun run dist:desktop:mac-arm64 # macOS Apple Silicon：DMG + ZIP
bun run dist:desktop:win-x64   # Windows x64：NSIS 安装包
```

产物位于 `dist/desktop/`。当前仓库配置了 macOS DMG/ZIP、Windows NSIS、Linux AppImage/DEB；v0.3.1 提供 macOS arm64 与 Windows x64 包。当前公开包未配置商业代码签名，安装时可能触发系统安全提示；真实安装与启动仍应在对应目标平台验收。

发布新版本时先同步根 `package.json` 与桌面包版本，再推送同名 `vX.Y.Z` tag。发布工作流会分别构建 macOS arm64 和 Windows x64 客户端、校验 tag、生成 SHA-256 校验文件并上传到 [GitHub Releases](https://github.com/AnnaSuSu/TechSpar/releases)；签名和 macOS 公证会在仓库配置对应 secrets 后自动启用。

### Web 本地开发

终端一启动 API：

```bash
bun run dev:api
```

终端二启动 Web：

```bash
bun run dev:web
```

访问 <http://localhost:5173>。服务端开发环境的默认登录信息：

```text
admin@techspar.local
admin123
```

服务端首次登录后请立即在设置页修改默认密码，部署时也必须在 `.env` 中修改 `JWT_SECRET`。Electron 桌面版会生成随机的本机凭证并自动进入，不使用上述固定密码。

### Docker

```bash
docker compose up --build
```

启动后访问 <http://localhost>。

## 模型与服务配置

LLM、Embedding、DashScope、Tavily、OSS 与腾讯云 VPR 密钥默认按用户隔离保存在本地数据目录，登录后在“设置”中填写；`.env` 只放启动配置和可选的平台兜底模型。

- **LLM**：任意 OpenAI-compatible API。
- **Embedding API**：任意 OpenAI-compatible embeddings 接口；完整的 `/v1/embeddings` 地址会自动归一化。
- **本地 Embedding**：使用 Transformers.js + ONNX，默认 `Xenova/bge-m3`；首次运行自动下载并缓存，不需要 Python、PyTorch 或 pip。
- **DashScope**：语音输入、录音转写和 Copilot 实时 ASR。
- **Tavily**：Copilot 公司信息搜索。
- **阿里云 OSS**：长录音异步转写的临时对象存储。
- **腾讯云 VPR**：可选的 HR/候选人声纹区分。

## 技术架构

| 层 | 技术 |
| --- | --- |
| API Host | Bun 1.3、Hono 4、`@hono/zod-openapi` |
| Desktop | Electron 43、沙箱 Renderer、受限 Preload、编译后的 Bun sidecar |
| Core | 纯 TypeScript 用例、状态机和端口 |
| Storage | SQLite、原子 JSON/文件存储 |
| Providers | OpenAI-compatible、Transformers.js、DashScope、OSS、Tavily、腾讯云 VPR |
| Web | React 19、React Router 7、Vite 8、Tailwind CSS 4 |
| Contracts | Zod、OpenAPI 3.1、生成的前端类型 |
| Test | Bun Test、OpenAPI 契约对照、Node 兼容性检查 |

项目采用模块化单体和六边形边界：Hono 只负责 HTTP/SSE/WebSocket 映射，业务规则在 `packages/core`，数据库、文件和供应商实现位于外层适配器。详见 [TypeScript 后端架构](docs/typescript-backend-architecture.md)。

```text
apps/api/             Bun + Hono 组合入口与路由
apps/desktop/         Electron 主进程、Preload、sidecar 监督与打包配置
packages/contracts/   OpenAPI 与传输协议
packages/core/        业务用例、状态机、端口
packages/db/          SQLite repositories
packages/platform/    文件、认证、配置与归档适配器
packages/providers/   LLM、Embedding、ASR、OSS、搜索与声纹适配器
frontend/             React Web 客户端
tests-ts/             TypeScript 测试与旧版 OpenAPI 基线
```

## 质量检查

```bash
bun run check
```

该命令依次执行 Bun/Node 类型检查、架构边界检查、后端与前端测试、前端 TypeScript/ESLint，以及 API、Web、Electron 主进程和编译 sidecar 构建。OpenAPI 文件和前端类型可通过以下命令重新生成：

```bash
bun run gen:api
```

桌面端还有三条独立验收命令：

```bash
bun run smoke:desktop          # Electron + Hono 启动链路
bun run smoke:local-embedding  # 编译后端执行真实 ONNX 本地向量
bun run pack:desktop           # 当前平台完整应用目录
```

## 数据与备份

默认数据位于 `data/`：SQLite 保存会话和任务状态，用户文件位于 `data/users/{user_id}/`。在“设置 → 数据迁移”中可以：

- 导出当前账户的可移植备份；敏感凭证需要显式选择才会包含；
- 将个人备份导入另一个账户，数据会安全重绑定到当前用户；
- 管理员导出完整系统备份。

归档会验证路径、链接、tar 校验和与解压上限；向量索引作为派生数据在导入后重建。

管理员系统归档的恢复是离线运维操作。先把归档放在目标 `data/` 之外并执行只读预检：

```bash
bun run restore:system -- --archive=/safe/backups/techspar-system.tar.gz --data-dir=/srv/techspar/data
```

预检通过后停止 TechSpar API、桌面 sidecar 和其他所有可能写入该目录的进程，再显式确认恢复：

```bash
bun run restore:system -- --archive=/safe/backups/techspar-system.tar.gz --data-dir=/srv/techspar/data --confirm
```

恢复会先构建并校验暂存数据，再原子切换目录；原 `data/` 会保留为同级、带时间戳的 `data.before-system-restore-*` 备份目录，不会直接删除。

Electron 使用系统标准的应用数据目录，数据库、用户文件、模型缓存和每次安装随机生成的运行密钥都放在那里；本地 Hono sidecar 只监听 `127.0.0.1` 的动态端口。

## 参与贡献

欢迎提交 [Issue](https://github.com/AnnaSuSu/TechSpar/issues) 或 PR。开发约定和流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

CC BY-NC 4.0。

例外：`frontend/src/resume/` 的简历编辑与模板代码移植自 [Magic Resume](https://github.com/JOYCEQL/magic-resume)，保留该目录内的原始协议与附加条款。

## 致谢

感谢 [LINUX DO](https://linux.do/) 社区，以及 Magic Resume 原作者 [@JOYCEQL](https://github.com/JOYCEQL)。
