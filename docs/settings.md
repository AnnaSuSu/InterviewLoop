# 设置

设置默认按当前登录用户隔离并热加载，不需要重启 API 或 Electron。平台共享兜底和服务启动参数才由部署管理员放进 `.env`。

## LLM

填写 OpenAI-compatible API Base、API Key、Model、API 兼容模式和 Temperature。使用 Atlas Cloud 时可点击 API Base 旁的预设按钮，自动填入 `https://api.atlascloud.ai/v1` 并使用通用 OpenAI 兼容模式；模型名仍需填写当前 Atlas Cloud 账号实际可调用的模型 ID。普通平台选择“通用 OpenAI 兼容”；DeepSeek V4 选择“DeepSeek V4”。先点击测试，确认账号确实能调用该模型，再保存。训练、面试、复盘、个人 Agent 和 Copilot 都使用这套生效中的配置。DeepSeek 模式只会对结构化请求附加 JSON 输出和低推理参数，普通文本请求及其他平台不会收到这些字段。

## Embedding

两种模式二选一：

- **API**：填写 Base、Key、模型和批大小；完整的 `/v1/embeddings` 地址会自动归一化。
- **本地**：填写 Transformers.js/ONNX 模型 ID 或本地路径；默认 `Xenova/bge-m3`，首次测试自动下载。

更换模型会让已有向量失效。保存后使用“重建索引”，等待知识库、个人资料和记忆向量全部完成；简历面试读取全文，不依赖 Embedding。

## 服务密钥

DashScope、Tavily 和阿里云 OSS 在服务配置中按用户保存。DashScope 用于实时/批量语音，Tavily 用于 Copilot 公司搜索，OSS 只用于长录音异步转写。组合和验证步骤见 [外部服务配置](external-services.md)。

## 专项训练与 Copilot

专项训练默认值包括每轮题数和题目发散度，只影响之后新建的会话。Copilot 预测 Agent 按面试需要选择技术追问、项目经验、压力质疑、行为考察或横向扩展；全部开启不一定更聚焦。

## 声纹识别

腾讯云 VPR 凭据和候选人声纹独立保存。先测试凭据，再录制 6–15 秒候选人语音。声纹只辅助 Copilot 标注说话角色，不用于登录或身份认证。

## 账户

管理员可切换是否允许注册。保存后值写入系统设置并优先于 `.env` 初始值；关闭时登录页隐藏注册入口，但已有账号仍可登录。

## 数据迁移

每个用户都能导出/导入个人归档；敏感凭据默认排除。管理员还可以导出全站备份。导入后向量索引不会作为事实数据盲目复用，应回到 Embedding 设置重建。

## 推荐顺序

1. 测试并保存 LLM。
2. 选择并测试 Embedding，必要时重建索引。
3. 按实际功能补 DashScope、Tavily、OSS 和声纹。
4. 调整训练参数和 Copilot Agent。
5. 在大版本升级前导出备份。
