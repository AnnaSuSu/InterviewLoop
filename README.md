<div align="center">

<img src="images/techspar-horizontal-logo.svg" alt="TechSpar" width="520" />


**把专项训练、简历面试、JD 备面、实时 Copilot 与录音复盘，串成一个持续进化的技术面试闭环。**

[在线 Demo](https://techspar.top/) · [快速开始](#快速开始) · [English](README.en.md)


[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg)](LICENSE)


![TechSpar 产品总览](images/techspar-overview.png)
</div>

> TechSpar 的核心不是某一个单独功能页面。  
> 它的核心是同一套长期记忆、画像更新和下一轮训练调度机制。
> 专项训练、简历面试、JD 备面、实时 Copilot 与录音复盘，不是彼此孤立的五个页面，而是围绕同一套长期记忆、掌握度和画像系统协同工作的同一个闭环。

---

## 它不是“再来一组题”

大多数 AI 面试产品的问题不在于题不够多，而在于**没有闭环**。

你今天答得差，系统知道。  
但你明天再来，它又像第一次见你一样重新开始。

TechSpar 要解决的不是“生成更多题”，而是把一次次训练、模拟、实战辅助和复盘连接起来，形成一条持续进化的路径：

| 传统面试工具 | TechSpar |
| --- | --- |
| 场景割裂：刷题、模拟、复盘各做各的 | 专项训练、简历面试、JD 备面、实时 Copilot 与录音复盘共用同一套画像与长期记忆 |
| 每次开始都像第一次使用 | 每次进入新一轮前都会读取历史掌握度、薄弱点、训练轨迹和上下文 |
| 训练结果停留在当前会话 | 训练结果会写回画像、掌握度、薄弱点和复习调度 |
| 很难把“准备阶段”和“真实面试”连接起来 | 从备面、模拟到实战辅助、复盘形成连续链路 |
| 反馈只对这一次有用 | 每次反馈都会改变下一轮训练重点 |
| 产品通常只覆盖单一环节 | 覆盖专项训练、简历面试、JD 备面、实时 Copilot 与录音复盘 |
| 用完即结束 | 训练 -> 评估 -> 画像更新 -> 下轮更精准，形成持续进化闭环 |

> **TechSpar 不是帮你“刷一轮题”，而是帮你建立一整套从备面到复盘、从单次训练到长期提升的技术面试闭环。**

---

## 题库为什么是核心设计

很多人会把“题库”理解成一组固定题目列表，但 TechSpar 的题库不是这个意思。

它本质上是一个**动态出题底座**，不是一个“把旧题存起来给你反复刷”的静态题单。

- **核心知识库**：定义这个领域该覆盖哪些知识边界，给出题和评分提供语义参考
- **高频题库**：标记真实面试里更常出现、更值得优先覆盖的考点
- **历史训练记录**：记录最近练过什么、哪些题答得差、哪些薄弱点还没补上
- **长期画像与掌握度**：决定这轮该继续补短板，还是向更难、更广的方向拓展

最终的题目不是“从题库里抽出来”，而是系统综合这些信息后，**为这一轮训练动态生成**。

也就是说：

- 传统题库产品：先有一批固定题，再让你去做
- TechSpar：先判断你现在最该练什么，再生成这一轮最合适的题

这也是为什么题库在这里不是边缘功能，而是整个闭环里的核心基础设施。

---

## 在线体验

直接体验：**[https://techspar.top/](https://techspar.top/)**

在登录页**注册一个自己的账号**即可开始——每个账号数据互相隔离。首次登录有两步引导，让你填入**自己的** LLM 和 Embedding API Key（演示环境不共享 key，也不会用到别人的）。

> 没有 key 也能零成本跑通：主 LLM 用 ModelScope 的 `ZhipuAI/GLM-5`，Embedding 用 SiliconFlow 的 `BAAI/bge-large-zh-v1.5`，两家都有免费额度。
>
> 演示环境请不要上传真实简历、真实录音或任何敏感个人信息。

---

## 这个闭环如何运转

### 1. 训练前：先确定你该练什么

系统不会把你当成“新用户”反复重置，而是先读取已有信息：

- **Session Context**：简历、JD、知识库、最近训练记录
- **Topic Mastery**：领域掌握度、历史薄弱点、练习轨迹
- **Global Profile**：跨领域强项、弱项、思维模式、沟通风格

这决定了下一轮问题更像“延续训练”，而不是“重新开始”。

### 2. 训练中：不同入口共享同一条主线

#### 专项强化训练

围绕某个领域集中训练，优先命中历史薄弱点，并结合掌握度调节难度和发散度。

#### 简历模拟面试

AI 读取简历，通过内置状态机推进完整流程：自我介绍 -> 技术问题 -> 项目深挖 -> 反问环节。

#### JD 定向备面

输入岗位描述后，系统会先拆解 JD，再围绕岗位要求、简历经历和知识库内容生成更贴近真实岗位的问题。

#### 实时 Copilot

先基于 JD、简历和历史画像做预处理，生成提问策略树与高危路径；进入实时模式后，系统持续转写 HR 发言、预测追问方向，并给出回答建议。

#### 录音复盘

上传面试录音或粘贴面试文本，系统自动转写、结构化 Q&A，并输出逐题分析与改进建议。

### 3. 训练后：不是结束，而是写回系统

每次训练结束后，系统不会只给一句总评，而是继续向后推进：

- 逐题评估回答质量
- 提取薄弱点、强项和行为特征
- 更新领域掌握度与长期画像
- 用 **SM-2** 调度后续复习
- 把这次结果带入下一轮训练

这意味着：**每次训练都会改变下一次训练。**

---

## 每轮结束后你会得到什么

- **逐题评分**：不是只看整体感觉，而是逐题拆开评估
- **薄弱点提取**：明确知道自己卡在哪，而不是笼统地“回答一般”
- **掌握度变化**：跟踪某个领域到底是在进步还是原地打转
- **长期画像更新**：系统会记住你的习惯性问题，而不是下一次重新开始
- **复习优先级**：会根据遗忘风险安排后续训练重点
- **参考答案与二次重练入口**：复盘后可以继续对照修正，而不是看完报告就结束

---

## 适合谁

- 正在准备后端、算法、AI 应用、Agent、RAG 等技术岗位面试的人
- 已经刷了很多题，但训练缺乏连续性和复盘闭环的人
- 想围绕简历项目和 JD 做更接近真实面试练习的人
- 想在真实面试前做针对性准备，或在面试中借助实时 Copilot 辅助判断追问方向的人
- 想长期跟踪自己能力变化，而不是做一次性问答的人

---

## 快速开始

### 1. 配置环境变量

```bash
cp .env.example .env
```

`.env` 里**不放任何 API Key**——只有启动引导项（管理员账号、`JWT_SECRET`、是否开放注册等）。所有模型与服务密钥都是**每个用户自己的**，登录后在「设置」里填；首次登录会有两步引导带你配好 **LLM + Embedding**（Embedding 必需，用于知识库、个人资料库和记忆向量化；简历直接读取全文）。

设置页里填什么：

- **LLM**：任意 OpenAI 兼容接口（API Base + Key + Model）。
- **Embedding**：`api` 模式走兼容接口；或 `local` 模式用本地 HuggingFace 模型（需额外 `pip install -r requirements.local-embedding.txt`）。

没有 key 也能零成本跑通，免费示例（两家都有免费额度，可分开用）：

- 主 LLM：ModelScope 的 `ZhipuAI/GLM-5`，Base `https://api-inference.modelscope.cn/v1`，Key 填 ModelScope SDK Token（<https://modelscope.cn/home>）
- Embedding：SiliconFlow 的 `BAAI/bge-large-zh-v1.5`，Base `https://api.siliconflow.cn/v1`，Key 填 SiliconFlow API Key（<https://cloud.siliconflow.cn/>）

认证默认值如下，不配置也能启动：

```env
JWT_SECRET=change-me-in-production
DEFAULT_EMAIL=admin@techspar.local
DEFAULT_PASSWORD=admin123
DEFAULT_NAME=admin
ALLOW_REGISTRATION=false
```

**可选服务**也都是 per-user，在「设置 → 可选服务 / 声纹识别」按需填，不填则对应功能关闭：

- **DashScope**（阿里云百炼，<https://bailian.console.aliyun.com/>，有免费额度）：答题语音输入 / 录音复盘转写 / Copilot 实时语音识别。
- **Tavily**（<https://tavily.com/>，免费每月 `1,000 credits`）：Copilot 联网搜索公司情报。
- **阿里云 OSS**：录音复盘上传长音频（答题短语音走同步链路，不需要）。
- **腾讯云 VPR 声纹识别**（<https://console.cloud.tencent.com/vpr>）：Copilot 自动区分 HR 与候选人音色，不填则手动按钮切换。

Copilot 不再单独配模型，直接用你的主 LLM。

### 2. Docker 启动

```bash
docker compose up --build
```

启动后访问：

```text
http://localhost
```

### 3. 手动启动

后端：

```bash
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
```

如果你要使用本地 embedding，再额外安装：

```bash
pip install -r requirements.local-embedding.txt
```

前端：

```bash
cd frontend
npm install
npm run dev
```

访问：

```text
http://localhost:5173
```

登录后可从侧栏进入 `面试 Copilot`，或直接访问：

```text
http://localhost:5173/copilot
```

---

## 技术栈

| Component | Technology |
| --- | --- |
| Backend | FastAPI |
| Frontend | React 19, React Router v7, Vite, Tailwind CSS v4 |
| Storage | SQLite, semantic embeddings |
| Auth | JWT, bcrypt |
| LLM | Any OpenAI-compatible API |

---

## 项目结构

为了避免文档继续变成过时快照，这里只保留稳定结构：

- `backend/main.py`：FastAPI 入口和主要接口
- `backend/graphs/`：简历面试、专项训练、JD 备面、录音复盘、Copilot 预处理等核心流程
- `backend/copilot/`：实时辅助相关的策略树、方向预测、回答建议、语音流处理
- `backend/storage/`：会话、Copilot prep 等持久化
- `frontend/src/pages/`：训练、画像、图谱、题库、Copilot、设置、复盘等页面
- `frontend/src/api/`、`frontend/src/contexts/`、`frontend/src/hooks/`：接口封装、全局状态和实时交互逻辑
- `data/users/{user_id}/`：每个用户的画像、简历、知识库、题库、设置与各项 API 密钥（provider.json / voiceprint.json）
- `docker-compose.yml`、`requirements*.txt`、`.env.example`：部署和运行入口

---

## 数据迁移（跨电脑同步）

换机器或重装时，可以在 **设置 → 数据迁移** 卡片里点导出 / 导入；或用 `scripts/` 下的脚本（适合脚本化、批量、跨用户）：

```bash
# 旧机器：导出（生成 techspar-backup-<timestamp>.tar.gz）
python3 scripts/export_data.py

# 新机器：先按 README 部署好，再导入
python3 scripts/import_data.py techspar-backup-<timestamp>.tar.gz
```

UI 导入会把归档中的数据全部归到当前登录账户（即使原 `user_id` 不同），适合个人换机；CLI 默认保留原 `user_id`，适合管理员级整库迁移。

打包内容：`data/interviews.db` + `data/users/<user_id>/`（画像/简历/知识库/题库/训练偏好）。
**不打包**：`.index_cache/`（导入后会自动重建）、`.env`（只剩 `JWT_SECRET`/管理员账号等引导项，需手工同步；模型密钥已存在 `data/users/` 里随包迁移）。

可选参数：
- `--user-id <id>`：仅导出指定用户（多用户部署时使用）
- `--db-strategy overwrite`：导入时同一 `session_id` 用归档版本覆盖本地（默认保留本地）
- `--overwrite-files`：导入时覆盖 `data/users/` 已存在的文件（默认保留本地）

---

## 参与贡献

这个项目还在持续打磨，很欢迎你一起把它做得更好。

- **用着别扭、发现 bug、有想法**：直接开个 [Issue](https://github.com/AnnaSuSu/TechSpar/issues) 聊，不用拘谨，把场景说清楚就行。
- **想动手改**：欢迎直接提 PR——修 bug、补文档、加功能、优化体验都可以。小改动直接发；改动比较大，建议先开个 Issue 对一下方向，免得白做。
- 接入了新的模型 / 服务商、或者跑通了某个部署方式，也很欢迎回来分享一下，让后面的人少踩坑。

开发环境、代码约定和 PR 流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## License

CC BY-NC 4.0

例外:`frontend/src/resume/` 目录下的简历编辑与模板渲染代码移植自 [Magic Resume](https://github.com/JOYCEQL/magic-resume),保留其原始协议(Apache 2.0 + 附加商业限制条款),详见该目录下的 `LICENSE` 与 `README.md`。

## 致谢

感谢 [LINUX DO](https://linux.do/) 社区的支持。

简历管理模块基于 [Magic Resume](https://github.com/JOYCEQL/magic-resume) 移植,感谢原作者 [@JOYCEQL](https://github.com/JOYCEQL) 的出色工作。
