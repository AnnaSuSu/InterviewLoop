# 部署说明

这页只写当前仓库真实可用的启动方式。

### 环境要求

* Python `3.11+`
* Node.js `18+`
* 一个可用的 **OpenAI 兼容 LLM 接口**
* 一个可用的 **Embedding 接口**，或者本地 Embedding 模型

录音上传转写不是必需功能；如果你要用它，再额外配置语音相关环境变量。

### 1. 复制环境变量

```bash
cp .env.example .env
```

### 2. 最小可运行配置

如果你想先把项目跑起来，推荐先用 **API Embedding** 模式。如果你使用远程 Embedding API，最小可运行配置如下：

```env
API_BASE=https://your-llm-api-base/v1
API_KEY=sk-your-api-key
MODEL=your-model-name
EMBEDDING_BACKEND=api
EMBEDDING_API_BASE=https://your-embedding-api-base/v1
EMBEDDING_API_KEY=sk-your-embedding-key
EMBEDDING_API_MODEL=your-embedding-model
```

这些变量分别是：

* `API_BASE`：主 LLM 的 OpenAI 兼容接口地址。面试、复盘、JD 分析都会走它。
* `API_KEY`：上面这个 LLM 接口的密钥。
* `MODEL`：主 LLM 模型名。
* `EMBEDDING_BACKEND`：Embedding 走哪条路，只能是 `api` 或 `local`。
* `EMBEDDING_API_BASE`：Embedding 接口地址。如果你用官方 OpenAI Embedding，这个值可以留空。
* `EMBEDDING_API_KEY`：Embedding 接口密钥。
* `EMBEDDING_API_MODEL`：Embedding 模型名。这里不要照抄示例，应该改成你的服务实际支持的模型。

默认认证配置如下；如果不改，启动后可以直接登录：

```env
DEFAULT_EMAIL=admin@techspar.local
DEFAULT_PASSWORD=admin123
ALLOW_REGISTRATION=false
```

### 3. 如果你想用本地 Embedding

如果你不想走远程 Embedding API，可以改成：

```env
EMBEDDING_BACKEND=local
LOCAL_EMBEDDING_MODEL=BAAI/bge-m3
LOCAL_EMBEDDING_PATH=
```

说明：

* `LOCAL_EMBEDDING_MODEL`：本地 Embedding 模型名。
* `LOCAL_EMBEDDING_PATH`：如果你已经把模型下载到本地，可以直接写本地路径。
* `LOCAL_EMBEDDING_MODEL` 和 `LOCAL_EMBEDDING_PATH` 二选一即可。
* 本地模式需要额外安装依赖：`pip install -r requirements.local-embedding.txt`

### 4. 本地手动启动

后端：

```bash
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
```

前端：

```bash
cd frontend
npm install
npm run dev
```

启动后访问：

```text
http://localhost:5173
```

### 5. Docker 启动

```bash
docker compose up --build
```

启动后访问：

```text
http://localhost
```

### 6. 录音转写的额外配置

如果你要使用“上传录音 -> 自动转写”这条链路，还需要补齐：

```env
DASHSCOPE_API_KEY=
QINIU_ACCESS_KEY=
QINIU_SECRET_KEY=
QINIU_BUCKET=
QINIU_DOMAIN=
```

这些变量不是可有可无的一半配置，而是同一条链路里的两段能力：

* `DASHSCOPE_API_KEY`：阿里云 DashScope 的语音转写能力。
* `QINIU_ACCESS_KEY`
* `QINIU_SECRET_KEY`
* `QINIU_BUCKET`
* `QINIU_DOMAIN`

当前代码的转写流程是：**先把音频传到七牛拿公网 URL，再把 URL 交给 DashScope 转写**。所以如果你要走“上传录音并自动转写”，`DASHSCOPE_API_KEY` 和整组 `QINIU_*` 都要配置。

如果这些没配，也不影响主要训练流程；录音复盘可以直接粘贴逐字稿文本。

### 7. 线上部署注意事项

* 手动开发模式下，前端默认是 `5173`，后端是 `8000`。
* Docker 模式下，前端默认对外暴露 `80` 端口。
* 如果你在线上要使用麦克风或录音相关能力，建议启用 HTTPS；浏览器对非 `localhost` 的音频权限更严格。
* 线上环境不要保留默认的 `JWT_SECRET`、`DEFAULT_PASSWORD`。
