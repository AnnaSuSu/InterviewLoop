<div align="center">

<img src="images/logo.png" alt="TechSpar" width="520" />


**Connect focused drills, resume interviews, JD-based prep, realtime Copilot, and recording review into one continuously improving technical interview loop.**

[Online Demo](https://techspar.top/) · [Quick Start](#quick-start) · [Chinese](README.md)


[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)
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

Try it directly: **[https://techspar.top/](https://techspar.top/)**

**Register your own account** on the login page to start — each account's data is isolated. On first login a two-step wizard asks for **your own** LLM and Embedding API keys (the demo shares no keys, and never uses anyone else's).

> No keys? You can run it for free: ModelScope `ZhipuAI/GLM-5` for the main LLM, SiliconFlow `BAAI/bge-large-zh-v1.5` for embedding — both offer free quota.
>
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

The AI reads your resume and uses a built-in state machine to drive a full flow: self-introduction -> technical questions -> project deep dive -> candidate Q&A.

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

`.env` holds **no API keys** — only bootstrap settings (admin account, `JWT_SECRET`, whether registration is open, etc.):

```env
JWT_SECRET=change-me-in-production
DEFAULT_EMAIL=admin@techspar.local
DEFAULT_PASSWORD=admin123
DEFAULT_NAME=admin
ALLOW_REGISTRATION=false
```

Every model and service key is **per-user**, entered in **Settings** after login. A two-step first-login wizard walks you through **LLM + Embedding** (Embedding is required — it vectorizes resume / knowledge base / memory):

- **LLM**: any OpenAI-compatible endpoint (API Base + Key + Model).
- **Embedding**: `api` mode via a compatible endpoint, or `local` mode with a local HuggingFace model (needs `pip install -r requirements.local-embedding.txt`).

No keys? You can run it for free (both providers offer free quota, and they can differ):

- Main LLM: ModelScope `ZhipuAI/GLM-5`, base `https://api-inference.modelscope.cn/v1`, key = ModelScope SDK Token (<https://modelscope.cn/home>)
- Embedding: SiliconFlow `BAAI/bge-large-zh-v1.5`, base `https://api.siliconflow.cn/v1`, key = SiliconFlow API Key (<https://cloud.siliconflow.cn/>)

**Optional services** are also per-user, filled under **Settings → Optional Services / Voiceprint** as needed (left blank = that feature stays off):

- **DashScope** (Alibaba Cloud Bailian, <https://bailian.console.aliyun.com/>, free quota): voice input while answering / recording-review transcription / Copilot realtime speech recognition.
- **Tavily** (<https://tavily.com/>, `1,000 credits`/month free): Copilot web search for company intel.
- **Alibaba Cloud OSS**: long-audio upload for recording review (short voice goes through the sync path, no OSS needed).
- **Tencent Cloud VPR voiceprint** (<https://console.cloud.tencent.com/vpr>): Copilot auto-distinguishes HR vs. candidate voices; otherwise switch the role manually.

Copilot no longer has a separate model — it uses your main LLM.

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
| Backend | FastAPI |
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
- `data/users/{user_id}/`: each user's profile, resume, knowledge base, question bank, settings, and their API keys (provider.json / voiceprint.json)
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
Not packed: `.index_cache/` (rebuilt after import), `.env` (now only `JWT_SECRET`/admin account/bootstrap flags, synced manually; model keys live under `data/users/` and travel with the archive).

Optional arguments:

- `--user-id <id>`: export only the specified user, useful in multi-user deployments
- `--db-strategy overwrite`: overwrite local sessions with archived versions when the same `session_id` exists; default is to keep local data
- `--overwrite-files`: overwrite existing files under `data/users/`; default is to keep local files

---

## License

CC BY-NC 4.0

Exception: the resume editor & template rendering code under `frontend/src/resume/` is ported from [Magic Resume](https://github.com/JOYCEQL/magic-resume) and keeps its original license (Apache 2.0 with additional commercial restrictions) — see `LICENSE` and `README.md` in that directory. Credits to [@JOYCEQL](https://github.com/JOYCEQL).
