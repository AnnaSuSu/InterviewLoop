# 外部服务配置

外部服务凭据默认按用户隔离。登录后进入“设置”，填写并用页面上的测试操作确认连通；不要把个人密钥写进仓库或普通日志。

## 功能组合

| 目标能力 | 必需配置 | 不配置时 |
| --- | --- | --- |
| 训练、简历/JD 面试、复盘 | OpenAI-compatible LLM | 依赖模型的生成能力不可用 |
| RAG/个人资料检索 | Embedding API，或本地 ONNX 模型 | 无法建立和查询向量索引 |
| Copilot 文本建议 | LLM + Embedding | 无法生成策略、建议或匹配策略树 |
| Copilot 实时字幕 | DashScope API Key | 仍可手动输入 HR 问题 |
| Copilot 公司搜索 | Tavily API Key | 跳过联网公司情报，其余准备流程继续 |
| 长录音自动转写 | DashScope + 阿里云 OSS | 可以先粘贴人工逐字稿做复盘 |
| 自动区分 HR/候选人 | DashScope + 腾讯云 VPR + 已注册声纹 | 使用手动角色切换 |

## LLM

在“设置 → LLM”填写：

- API Base
- API Key
- Model
- Temperature

接口遵循 OpenAI-compatible chat/streaming 协议。模型名必须是当前账号真实可调用的 ID；不同供应商对 Base URL 是否包含 `/v1` 的要求不同，以供应商文档为准。

保存前先点击测试。保存后训练、面试、复盘、个人 Agent 和 Copilot 共用这套用户配置。

## Embedding

### API 模式

填写 Base URL、API Key、模型名和批大小。系统会把完整的 `.../v1/embeddings` 地址归一化为 API Base；批请求若收到明确的 400 兼容错误，会回退为逐条请求并记住能力。

### 本地模式

本地模式通过 Transformers.js + ONNX 运行，默认模型为 `Xenova/bge-m3`。首次测试会自动下载模型并写入模型缓存，不需要 Python、PyTorch 或 pip。

切换模型后，现有派生索引会失效。保存并执行“重建索引”，等待 SSE 进度完成后再判断检索效果。

## DashScope

用户服务配置中的 DashScope API Key 同时用于：

- 答题时的短音频转写；
- Copilot 的 `qwen3-asr-flash-realtime` 实时字幕；
- 录音复盘的长音频异步转写。

配置后先用短音频或 Copilot 实时字幕验证。缺少 key 时，文本输入和人工逐字稿路径仍然可用。

## Tavily

Tavily API Key 只用于 Copilot Prep 的公司联网搜索。配置后，用真实公司名和岗位创建一次 Prep；结果中能出现联网公司情报即表示连通。不配置不会让整个 Prep 失败。

## 阿里云 OSS

长录音异步转写需要 DashScope 能访问一个临时公网 URL，因此还要填写：

- Access Key ID
- Access Key Secret
- Bucket
- Endpoint

Bucket 可以保持私有。适配器上传文件后生成短期签名 URL，并在任务结束后清理临时对象。短音频和 Copilot 实时字幕不需要 OSS。

## 腾讯云 VPR 声纹

在“设置 → 声纹识别”填写腾讯云 SecretId/SecretKey，可选 AppId，先测试凭据，再录制 6–15 秒候选人语音注册声纹。凭据加密后按用户保存。

实时识别同时依赖 DashScope ASR 切段。建议注册和面试使用相近的麦克风与环境；信道变化、多人重叠或强噪声都会降低判断质量。声纹只能辅助角色标注，不应作为身份认证手段。

## 平台共享兜底

机构部署可以在 `.env` 中设置 `PLATFORM_LLM_*`、`PLATFORM_EMBEDDING_*` 和 `PLATFORM_DAILY_CALL_LIMIT`，为未填写个人模型配置的用户提供共享额度。已经配置个人 key 的用户继续使用自己的配置，不占平台限额。

共享平台 key 会产生集中成本和滥用风险。公开部署必须设置额度、保护 `.env`，并避免把响应或请求头中的密钥写入日志。

启动、Docker、桌面数据目录和备份策略见 [部署说明](deployment.md)。
