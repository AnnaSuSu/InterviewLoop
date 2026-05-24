<div align="center">

<img src="images/logo.png" alt="TechSpar" width="520" />


**Connect focused drills, resume interviews, JD-based prep, realtime Copilot, and recording review into one continuously improving technical interview loop.**

[Online Demo](https://aari.top/) · [Quick Start](#quick-start) · [Chinese](README.md)


[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)
[![LangGraph](https://img.shields.io/badge/LangGraph-Powered-1C3C3C.svg)](https://www.langchain.com/langgraph)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg)](LICENSE)


![TechSpar product overview](images/techspar-overview.png)
</div>

> TechSpar is not centered on one isolated feature page.  
> Its core is a shared mechanism for long-term memory, profile updates, and next-round training scheduling.
> Focused drills, resume interviews, JD-based prep, realtime Copilot, and recording review are not five disconnected pages. They work together around the same long-term memory, mastery, and profile system.

---

## Not Just Another Question Set

Most AI interview tools do not fail because they have too few questions. They fail because they have **no feedback loop**.

You may answer poorly today, and the system may know it.  
But tomorrow, it starts again as if it has never met you.

TechSpar is not built to "generate more questions." It connects practice, mock interviews, real interview assistance, and review into a continuously improving path:

| Traditional interview tools | TechSpar |
| --- | --- |
| Fragmented scenarios: question practice, mock interviews, and review are separate | Focused drills, resume interviews, JD-based prep, realtime Copilot, and recording review share one profile and long-term memory system |
| Every session starts like the first session | Before each new round, TechSpar reads historical mastery, weak spots, training traces, and context |
| Practice results stay inside the current session | Results are written back into the profile, mastery records, weak spots, and review schedule |
| Hard to connect preparation with real interviews | Prep, mock practice, realtime assistance, and review form one continuous chain |
| Feedback only helps this one attempt | Every piece of feedback changes the focus of the next round |
| Usually covers only one interview stage | Covers focused drills, resume interviews, JD-based prep, realtime Copilot, and recording review |
| Ends after use | Training -> evaluation -> profile update -> more precise next round, forming an evolving loop |

> **TechSpar does not help you "do one round of questions." It helps you build a full technical interview loop from preparation to review, from one training session to long-term improvement.**

---

## Why The Question Bank Is Core

Many people understand a "question bank" as a fixed list of stored questions. That is not what TechSpar means.

In TechSpar, the question bank is a **dynamic question-generation foundation**, not a static list that stores old questions for repeated drilling.

- **Core knowledge base**: defines the knowledge boundaries for a domain and provides semantic reference for question generation and scoring
- **High-frequency question bank**: marks topics that appear more often in real interviews and deserve higher priority
- **Historical training records**: tracks what you recently practiced, which answers were weak, and which gaps still need work
- **Long-term profile and mastery**: decides whether this round should continue fixing weak spots or expand toward harder and broader areas

The final questions are not simply "drawn from the bank." They are **generated dynamically for the current round** after the system combines all these signals.

In other words:

- Traditional question-bank products: start with a fixed batch of questions, then ask you to answer them
- TechSpar: first decides what you most need to practice now, then generates the most suitable questions for this round

That is why the question bank is not a side feature here. It is core infrastructure for the whole loop.

---

## Online Demo

Try it directly: **[https://aari.top/](https://aari.top/)**

| Email | Password |
| --- | --- |
| admin@techspar.local | admin123 |

> Do not upload real resumes, real recordings, or sensitive personal information to the demo environment.

---

## How The Loop Works

### 1. Before training: decide what you should practice

The system does not repeatedly reset you as a "new user." It first reads what it already knows:

- **Session Context**: resume, JD, knowledge base, and recent training history
- **Topic Mastery**: domain mastery, historical weak spots, and practice trajectory
- **Global Profile**: cross-domain strengths and weaknesses, thinking patterns, and communication style

This makes the next round feel like continued training, not a restart.

### 2. During training: different entry points share one main thread

#### Focused drills

Train around one domain, prioritize historical weak spots, and adapt difficulty and breadth based on mastery.

#### Resume mock interview

The AI reads your resume and uses a LangGraph state machine to drive a full flow: self-introduction -> technical questions -> project deep dive -> candidate Q&A.

#### JD-based prep

After you paste a job description, the system decomposes the JD first, then generates questions closer to the real role based on requirements, resume experience, and knowledge-base content.

#### Realtime Copilot

The system first preprocesses the JD, resume, and historical profile to generate a questioning strategy tree and high-risk paths. In realtime mode, it continuously transcribes the HR/interviewer side, predicts follow-up directions, and suggests answer strategies.

#### Recording review

Upload an interview recording or paste interview text. The system transcribes it, structures Q&A, and outputs per-question analysis and improvement suggestions.

### 3. After training: write results back into the system

When a training round ends, the system does not stop at a generic summary. It continues downstream:

- Evaluate answer quality per question
- Extract weak spots, strengths, and behavioral signals
- Update domain mastery and long-term profile
- Use **SM-2** to schedule later review
- Carry the result into the next training round

This means: **every training session changes the next one.**

---

## What You Get After Each Round

- **Per-question scoring**: evaluates each answer instead of relying only on an overall impression
- **Weakness extraction**: shows where you got stuck instead of saying only "average answer"
- **Mastery changes**: tracks whether a domain is improving or going in circles
- **Long-term profile updates**: remembers recurring problems instead of starting over next time
- **Review priority**: schedules later training based on forgetting risk
- **Reference answers and retry entry**: lets you revise and practice again after review

---

## Who It Is For

- People preparing for backend, algorithm, AI application, Agent, RAG, and other technical interviews
- People who have practiced many questions but lack continuity and a review loop
- People who want practice closer to real interviews around their resume projects and target JD
- People who want targeted preparation before real interviews, or realtime Copilot support during interviews to judge likely follow-up directions
- People who want to track ability changes over time instead of doing one-off Q&A

---

## Quick Start

### 1. Configure environment variables

```bash
cp .env.example .env
```

The minimum required configuration is **LLM + Embedding**. Embedding is not optional. Choose one of the following:

- `EMBEDDING_BACKEND=api`: recommended default, using an OpenAI-compatible embedding API
- `EMBEDDING_BACKEND=local`: local model mode, requiring extra dependencies

The recommended default is `api`:

```env
API_BASE=https://your-llm-api-base/v1
API_KEY=sk-your-api-key
MODEL=your-model-name
EMBEDDING_BACKEND=api
EMBEDDING_API_BASE=https://your-embedding-api-base/v1
EMBEDDING_API_KEY=sk-your-embedding-key
EMBEDDING_API_MODEL=BAAI/bge-m3
```

If you use the official OpenAI embedding API, `EMBEDDING_API_BASE` can be left empty.

If you only want to run the project first, you do not necessarily need to buy model service up front. A simple free example is:

- Main LLM: ModelScope `ZhipuAI/GLM-5`
- Embedding: SiliconFlow `BAAI/bge-large-zh-v1.5`

Registration:

- ModelScope: <https://modelscope.cn/home>
- SiliconFlow: <https://cloud.siliconflow.cn/>

Example configuration:

```env
API_BASE=https://api-inference.modelscope.cn/v1
API_KEY=your-modelscope-sdk-token
MODEL=ZhipuAI/GLM-5

EMBEDDING_BACKEND=api
EMBEDDING_API_BASE=https://api.siliconflow.cn/v1
EMBEDDING_API_KEY=sk-your-siliconflow-key
EMBEDDING_API_MODEL=BAAI/bge-large-zh-v1.5
```

Use the ModelScope SDK Token for `API_KEY`, and the SiliconFlow API Key for `EMBEDDING_API_KEY`. The main LLM and embedding model can come from different providers.

Default authentication values are:

```env
JWT_SECRET=change-me-in-production
DEFAULT_EMAIL=admin@techspar.local
DEFAULT_PASSWORD=admin123
DEFAULT_NAME=admin
ALLOW_REGISTRATION=false
```

If you want local embedding, continue filling in `LOCAL_EMBEDDING_*` in `.env.example`.

If you want to enable a dedicated Copilot model, realtime speech recognition, or web search, configure these optional values:

```env
COPILOT_API_BASE=
COPILOT_API_KEY=
COPILOT_MODEL=
DASHSCOPE_API_KEY=
TAVILY_API_KEY=
```

When `COPILOT_*` is empty, Copilot falls back to the main LLM. `DASHSCOPE_API_KEY` is used for three scenarios: **Copilot realtime speech recognition** (`qwen3-asr-flash-realtime`), **short voice input while answering** (synchronous base64 upload), and **long-audio transcription for recording review** (asynchronous filetrans). Without it, Copilot can only accept manually typed HR/interviewer questions. If left empty but `COPILOT_API_KEY` already points to DashScope, that key is reused automatically.

`DASHSCOPE_API_KEY` comes from Alibaba Cloud Bailian (DashScope): <https://bailian.console.aliyun.com/>. New users usually receive free quota, enough to try realtime speech recognition and recording transcription.

`TAVILY_API_KEY` can be obtained from Tavily: <https://tavily.com/>. The free plan provides `1,000 credits` per month, enough to try web search.

If you want Copilot to **automatically distinguish HR/interviewer and candidate voices** using Tencent Cloud VPR voiceprint recognition, configure:

```env
TENCENT_SECRET_ID=
TENCENT_SECRET_KEY=
TENCENT_VPR_APP_ID=
```

`TENCENT_SECRET_ID` and `TENCENT_SECRET_KEY` can be created in Tencent Cloud CAM: <https://console.cloud.tencent.com/cam/capi>. `TENCENT_VPR_APP_ID` requires enabling the VPR service in the Tencent Cloud voiceprint console: <https://console.cloud.tencent.com/vpr>. Without these values, Copilot still works, but you need to manually switch the "HR / You" role during realtime interviews.

If you want to enable **long-audio upload transcription for recording review**, configure Alibaba Cloud OSS. Short voice input uses the synchronous base64 path and does not need OSS:

```env
ALIYUN_OSS_ACCESS_KEY_ID=
ALIYUN_OSS_ACCESS_KEY_SECRET=
ALIYUN_OSS_BUCKET=
ALIYUN_OSS_ENDPOINT=oss-cn-shanghai.aliyuncs.com
```

`.env.example` contains the complete example and can be edited directly.

### 2. Start with Docker

```bash
docker compose up --build
```

Then visit:

```text
http://localhost
```

### 3. Start manually

Backend:

```bash
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
```

If you want local embedding, install the extra dependencies:

```bash
pip install -r requirements.local-embedding.txt
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Visit:

```text
http://localhost:5173
```

After login, open `Interview Copilot` from the sidebar, or visit:

```text
http://localhost:5173/copilot
```

---

## Tech Stack

| Component | Technology |
| --- | --- |
| Backend | FastAPI, LangChain, LangGraph, LlamaIndex |
| Frontend | React 19, React Router v7, Vite, Tailwind CSS v4 |
| Storage | SQLite, semantic embeddings |
| Auth | JWT, bcrypt |
| LLM | Any OpenAI-compatible API |

---

## Project Structure

To avoid turning the document into an outdated snapshot, this section only keeps the stable structure:

- `backend/main.py`: FastAPI entry and main APIs
- `backend/graphs/`: core flows for resume interview, focused drill, JD-based prep, recording review, Copilot preprocessing, and more
- `backend/copilot/`: realtime assistance, including strategy tree, direction prediction, answer advice, and speech stream processing
- `backend/storage/`: persistence for sessions, Copilot prep, and related data
- `frontend/src/pages/`: pages for training, profile, graph, question bank, Copilot, settings, review, and more
- `frontend/src/api/`, `frontend/src/contexts/`, `frontend/src/hooks/`: API wrappers, global state, and realtime interaction logic
- `data/users/{user_id}/`: each user's profile, resume, knowledge base, question bank, and settings
- `docker-compose.yml`, `requirements*.txt`, `.env.example`: deployment and runtime entry points

---

## Data Migration (Cross-Machine Sync)

When switching machines or reinstalling, use **Settings -> Data Migration** to export/import data, or use the scripts under `scripts/` for scripted, batch, or cross-user migration:

```bash
# Old machine: export, generating techspar-backup-<timestamp>.tar.gz
python3 scripts/export_data.py

# New machine: deploy the project first, then import
python3 scripts/import_data.py techspar-backup-<timestamp>.tar.gz
```

UI import assigns all archived data to the currently logged-in account, even if the original `user_id` is different. This is suitable for personal machine migration. CLI import preserves the original `user_id` by default, which is better for admin-level full-database migration.

Packed content: `data/interviews.db` + `data/users/<user_id>/` (profile, resume, knowledge base, question bank, and training preferences).  
Not packed: `.index_cache/` (rebuilt after import), `langgraph_checkpoints*` (runtime state), `.env` (API keys and other secrets must be synced manually).

Optional arguments:

- `--user-id <id>`: export only the specified user, useful in multi-user deployments
- `--db-strategy overwrite`: overwrite local sessions with archived versions when the same `session_id` exists; default is to keep local data
- `--overwrite-files`: overwrite existing files under `data/users/`; default is to keep local files

---

## License

CC BY-NC 4.0
