# TypeScript 迁移完整性收尾清单

> 状态：执行中
>
> 审计基线：`legacy/python-backend@73d1a7c` → `main@7938576`
>
> 开始日期：2026-08-20

本文记录 Python/FastAPI 到 TypeScript/Bun/Hono/Electron 迁移的最后一轮功能等价修复。迁移是否完成，不再只按“路由存在、代码可构建”判断，而要同时满足用户主流程、旧数据升级、长期画像、运行安全和发布工程的验收条件。

## 1. 完成定义

只有下列条件全部满足，才把迁移状态改为“完整完成”：

1. Web 客户端实际发送的 JSON 与 Hono/Zod 契约兼容，简历面试、JD 备面和 Personal Agent 主流程不能在路由入口被拒绝。
2. 旧 Python 版生成的个人归档可直接导入，包含 PAX、Unicode 文件名和长路径时仍保持路径、链接与解压大小安全检查。
3. 批量答题、简历复盘和历史分数保持旧版业务语义，不因跳题或异步持久化产生错配。
4. 长期画像保留弱点更新、改善/复发、SM-2 复习、语义去重、历史洞察和跨会话整合能力。
5. 旧 provider 配置可安全转换到 Transformers.js/ONNX 支持的本地 embedding 配置；无法自动转换的本地路径必须给出明确状态，而不是运行时隐式失败。
6. OpenAPI 不只保留 method/path，还要描述请求体必填性、Bearer 鉴权和统一错误响应；真实 HTTP 边界有回归测试。
7. 数据导入、全站恢复、持久任务、Office 解压和 Electron 本地 API 有明确的恢复与安全边界。
8. README、贡献指南、版本信息、CI 和发布说明与实际 TypeScript/Electron 主线一致。
9. 聚焦测试、全量测试、类型检查、架构边界、Web/API/Desktop 构建全部通过，仓库没有未说明的改动。

## 2. 原子提交计划

| 序号 | 修复组 | 主要验收 | 状态 |
| --- | --- | --- | --- |
| 1 | 收尾文档 | 建立可追踪的完成定义和修复顺序 | 处理中 |
| 2 | HTTP 主流程契约 | `null` 兼容、Personal Agent 完整消息、HTTP 回归 | 待处理 |
| 3 | 旧归档兼容 | Python PAX/GNU 归档导入、重建状态明确 | 待处理 |
| 4 | 复盘正确性 | 跳题不串答案、简历分数写回历史 | 待处理 |
| 5 | 长期画像 | SM-2、行为变化、语义记忆、跨会话整合 | 待处理 |
| 6 | API 契约 | OpenAPI 安全/请求/错误声明、400/422/500 边界 | 待处理 |
| 7 | 数据与运行安全 | 系统恢复、任务租约、Office 解压、桌面凭据/CORS | 待处理 |
| 8 | 文档与发布 | 分支说明、贡献指南、版本、跨平台发布工作流 | 待处理 |
| 9 | 总体验收 | 全量检查、构建、提交与远端核验 | 待处理 |

每一组修改都必须先补能够在旧实现语义下失败的回归测试，再完成实现；只暂存该组文件，检查 staged diff 后单独提交。后一组不得依赖未提交的偶然工作区状态。

## 3. 已确认的阻断问题

### 3.1 HTTP 主流程

- 简历模拟面试客户端发送 `topic: null`，迁移后的 Schema 不接受。
- JD 备面会把空 company/position 序列化为 `null`，迁移后的 Schema 不接受。
- Personal Agent 新会话发送 `conversation_id: null`，迁移后的 Schema 不接受。
- Personal Agent 后端返回字符串，但客户端仍按包含 role/content/created_at/sources 的消息对象渲染。

### 3.2 数据升级

- Python `tarfile` 生成的 PAX 扩展头会被当前 TAR 解析器拒绝。
- Electron 使用系统 userData 目录，不会自动发现旧仓库数据，因此归档导入必须是真正可用的标准升级入口。
- 个人资料导入后被标记为 `indexing`，但没有自动排队重建，界面可能永久显示“正在索引”。
- 管理员全站归档只有导出，没有项目提供的恢复入口。

### 3.3 复盘与长期画像

- 批量训练中间跳题时，后续 user turn 会被顺序匹配到前一道题。
- 简历复盘解析出的平均分和维度分没有写回 session overall，历史列表可能没有分数。
- 画像只按精确字符串合并弱点；旧版的语义去重、改善/复发历史、时间衰减、SM-2 实际答题更新和跨会话整合没有完整迁移。
- 旧版显式 `BAAI/bge-m3` 或 sentence-transformers 本地路径没有转换到当前 Transformers.js 配置。

### 3.4 契约、运行与发布工程

- 当前 OpenAPI 等价测试只比较 method/path，没有覆盖 request body、security 和错误响应。
- malformed JSON 的 Hono HTTPException 会被通用异常处理转成 500。
- 持久任务没有数据库租约/所有权，多实例可能重复执行非幂等任务。
- Office 文档在完整解压后才检查大小，无法阻止高压缩比 ZIP 消耗内存。
- Electron 默认管理员凭据固定且全局 CORS 过宽。
- README 的旧分支示例会在同一工作目录切换，可能让新旧版本误用同一份未跟踪数据。
- CONTRIBUTING 仍指导使用 pip、uvicorn、FastAPI 和 pytest。
- API/OpenAPI 版本仍报告 `0.2.0`；跨平台安装包发布、签名和 notarization 尚未自动化。

## 4. 验证边界

本轮代码修复会运行本地 HTTP、数据库、归档、任务和构建验证。真实 Apple/Windows 代码签名、macOS notarization，以及需要用户私有 DashScope、OSS、Tavily、腾讯 VPR、LLM/Embedding 凭据的线上 smoke，必须由发布环境提供凭据；仓库必须提供可执行的 CI/文档入口，但不会把私有凭据写入代码或测试。

## 5. 最终证据

完成后在这里记录每个原子提交、聚焦测试、全量检查、跨平台构建结果和仍需外部凭据完成的发布动作。若仍有任何功能或数据阻断项，本文件状态不得改为“完整完成”。
