# Samagama FAQ & AI Knowledge Platform

Welcome to the Samagama FAQ platform. This is a comprehensive, AI-driven knowledge base built using the MERN stack (MongoDB, Express, React, Node.js) with integrated Groq API for dynamic semantic search and AI automated response generation.

## Samagama Platform Features

Samagama is a comprehensive, AI-powered knowledge management and community Q&A platform built with a modern MERN stack (MongoDB, Express, React/Vite, Node.js). The platform is divided into three main pillars: the Knowledge Base, the Community Q&A Board, and the Admin Control Panel.

### Samagama — Feature Overview

**Stack:** MERN · Groq LLaMA-3.1 · MongoDB Atlas Vector Search · @xenova/transformers

---

### 🤖 AI / Yaksha Engine

* **8-Phase Pipeline** — Query condensation → embedding → semantic cache → category routing → hybrid search → confidence gate → Groq synthesis → cache write-back.
* **Confidence-Gated Escalation** — If top FAQ match scores below 0.40, Yaksha refuses to guess and auto-escalates the query to the Community Board.
* **Multi-Turn Memory** — Groq condenses follow-up questions (resolves "it", "they", etc.) into self-contained queries before running vector search.
* **Sentiment Tagging** — Every answer is tagged positive / neutral / frustrated / confused and shown as an empathy banner in the chat UI.
* **4-Stage LLM Parser** — Handles malformed JSON from Groq via: direct parse → regex block extraction → key extraction → brace-strip fallback. Users never see raw JSON.
* **Per-Message Feedback** — Thumbs-down on a Yaksha reply auto-opens the community post flow, closing the feedback loop in one click.
* **Full Groq Audit Log** — Every LLM call writes action name, model, prompt/response summaries, and exact token counts to GroqLog for cost tracking.

### 🔍 Search & Retrieval

* **Atlas Vector Search on 3 Collections** — HNSW indices on FAQs, categories, and the semantic cache, each tuned independently.
* **Category Tree Routing** — Query is first matched to one of 14 category subtrees via vector search, narrowing the FAQ search space before the main query runs.
* **Hybrid Scoring** — Final score = (vector × 0.7) + (keyword overlap × 0.3), with keywords weighted 0.7 on question and 0.3 on answer.
* **Root Fallback** — If vector search returns zero results for a category, it automatically retries against the full corpus.
* **Semantic Cache (0.95 threshold)** — Near-identical queries (same meaning, different phrasing) return a cached Groq response instantly without touching the LLM.
* **30-Day TTL Auto-Expiry** — MongoDB's `expireAfterSeconds` index purges stale cache entries automatically — no cron job needed.
* **5-Signal Hybrid Sort** — Community board "Hot" mode = (votes × 0.4) + (search freq × 0.2) + (recency × 0.15) + (admin priority × 0.15) + (engagement × 0.1).

### ✅ Validation & Moderation

* **3-Layer Question Validation** — Regex gate → Groq classification (VALID / ABUSIVE / GIBBERISH / OFF_TOPIC) → semantic duplicate check against FAQ corpus and existing community questions.
* **Auto Typo Correction** — `classifyQuery` returns a cleaned_query with spelling fixed and abbreviations expanded (e.g., "reg" → "registration").
* **2-Step Posting Filter** — A second Groq call routes new questions into publish / review / hide before they appear on the community board.
* **AI Answer Ethics Check** — Every submitted answer is checked by Groq for relevance and ethics before going live; failures are flagged for admin review.
* **AI Category Validation** — When users manually pick a category, Groq verifies the question actually matches it; mismatches are auto-corrected.
* **Batch Auto-Moderation** — One admin button runs Groq over the entire flagged answer queue, approving/rejecting each and awarding SP automatically.
* **Fail-Open Defaults** — On Groq API error: `classifyQuery` defaults to VALID, `checkAnswer` defaults to passes, `classifyForPosting` defaults to review.

### 🧠 Knowledge Base Automation

* **Global AI Cluster** — Admin triggers Groq to read community Q&A pairs and synthesise structured Master FAQ proposals (question, answer, confidence, tags, summary).
* **9-Field Cluster Schema** — Each proposal includes `clusterTitle`, `questionIds`, `masterQuestion`, `masterAnswer`, `confidenceScore`, `moderationStatus`, `flaggedOrRepeated`, `normalizedIntent`, `shortSummary`.
* **HNSW FAQ Clustering** — `clusterAllFAQs()` embeds every FAQ's question + answer, compares against 14 category centroid embeddings in memory, and re-assigns each FAQ to its closest category.
* **Dry-Run Mode** — Both single and bulk clustering jobs accept a `dryRun` flag — preview all changes before committing to the database.
* **Category Centroid Cache** — 14 category embeddings are computed once and cached in-process memory; a single function call invalidates them.
* **Promotion Pipeline** — Community answer → SHA-256 fingerprint check → 92% vector similarity check → embed → upsert into FAQ corpus → award SP to both answerer and asker.
* **Promotion Refresh** — Re-promoting an already-promoted answer updates the existing FAQ entry's text and embedding instead of creating a duplicate.
* **Admin FAQ CRUD with Dedup** — Manual FAQ creation runs the same SHA-256 + 92% vector checks, blocking near-duplicate entries from the admin panel too.

### 💬 Community Board & Q&A

* **Tiered Display Order** — Every list response is sorted: Pinned → Spotlighted → Regular, regardless of selected sort mode.
* **Community Spotlight** — Questions that are open, have zero answers, and are **older than 24 hours** are auto-flagged as spotlighted and shown in a dedicated urgent section.
* **4 Sort Modes** — Newest, Most Voted, Most Viewed, and Hybrid (5-signal composite). All fully paginated server-side.
* **14 Category Chips** — Filter questions by any canonical category, loaded live from the database.
* **Pinned Questions & FAQs** — **Admins can pin important community questions and FAQs.** Pinned items always appear at the top with distinct golden-border styling.
* **Atomic Voting** — `$inc` on vote fields + compound unique index on the Vote model prevents double voting without a pre-check query.
* **Self-Vote Protection** — Voting on your own question returns a 403 before any database write.
* **Hidden Answer Count** — Question detail shows "X hidden answers" for transparency, without revealing the hidden content.
* **Engagement & Search Frequency Tracking** — Time-on-page and search appearances are tracked per question and feed into the Hybrid sort score.
* **Answerer Dashboard** — Dedicated view listing unanswered questions first, filterable by category, with per-category counts in the sidebar.

### 📝 Question Submission UX

* **600ms Debounced Validation** — Textarea border turns red / green / amber in real-time as the user types.
* **"Will Post As" Preview** — The AI-cleaned version of the query is shown before submission so users can confirm the interpretation.
* **Similar Match Card** — A matching FAQ or community question is surfaced inline (with expandable answer) before the user submits, reducing duplicates.
* **Voice Input** — Microphone button uses the Web Speech API to dictate and append to the query field.
* **Auto-Categorisation** — Leaving category as "general" triggers Groq auto-classification; manual selection is validated and overridden if wrong.
* **Question Rephrase** — Raw query is sent to `rephraseQuery()` (Groq); the corrected, formal version is what gets stored and displayed.
* **Character Guard** — Minimum 8 characters, maximum 500; submit button is disabled until both conditions are met.

### 📋 Answer Lifecycle

* **Answer Status State Machine** — submitted → live or flagged (AI check) → admin approves → live or hidden; promoted answers gain `promoted_to_corpus: true`.
* **Full Edit History** — Every edit stores `previous_content`, `reason`, `edited_by`, and `edited_at` as embedded sub-documents, viewable by admins.
* **Best Answer Sorted First** — Answers on question detail are sorted net_score DESC → recency DESC → status ASC, so the highest-voted answer is always first.
* **"Promoted to FAQ ⚡" Badge** — Answers promoted to the corpus display a badge on the user's profile page.

### 🏆 Gamification & SP Economy

* **SP (Samagama Points)** — Earned for posting questions, submitting answers (0/5/10/15 SP tiers), upvotes, approval, and corpus promotion. **Answering spotlighted questions awards additional SP.** Balance never goes below zero.
* **Immutable SP Ledger** — Every SP change logs user, admin, amount, reason, old_balance, new_balance, and timestamp. Append-only.
* **Cross-Actor Rewarding** — Approving an answer awards SP to both the answerer and the original asker via separate ledger entries.
* **Admin SP Sliders** — Admins fine-tune reward amounts (0–100 SP) per action before approving or promoting.
* **AI Quality Scoring** — `evaluateAnswerReward()` uses Groq to assign 0/5/10/15 SP tiers based on answer quality; also scores the asker's question quality.
* **Animated Podium Leaderboard** — Top 3 users shown as gold/silver/bronze podium with 3 sort modes (SP / Answers / Questions) and rank-change indicators.
* **6 Auto-Earned Badges** — FAQ Helper, Top Contributor, Fast Responder, Community Hero, Question Master, Veteran — computed from xp and answers_count.
* **Paginated SP Ledger** — Admins filter transaction history by user, admin, or date range with full pagination.

### 🗺️ Mind Map Visualization

* **AI-Generated Tree** — Groq reads up to 15 FAQs from a section and outputs a hierarchical `{ root, children }` JSON tree (root → branch topics → leaf questions).
* **Pan & Zoom SVG** — Scroll-wheel zoom (0.35×–3×) and drag-to-pan on the SVG canvas.
* **Staggered Animations** — Nodes fade and scale in sequentially using per-node CSS animation delays.
* **Cubic Bézier Edges** — Smooth S-shaped curves connect nodes, with branch edges thicker than leaf edges.
* **Clickable Leaves** — Clicking a leaf node filters/highlights the corresponding FAQ in the text-based browse view.
* **Loading Skeleton** — A pulsing placeholder SVG appears during the 2–4s Groq generation delay.

### 📊 Admin Analytics

* **9-Metric KPI Dashboard** — FAQ count, user count, community question count, flagged answers, FAQ proposal candidates, spotlighted count, total AI queries — all computed live.
* **7d / 30d / 90d Time Series** — Daily query volume and community questions merged into a single chart with zero-filled gaps for days with no activity.
* **Groq Token Tracking** — Lifetime totals and daily breakdown of prompt / completion / total tokens from GroqLog.
* **User Role Distribution** — Aggregated count of askers, answerers, both, and admins.
* **Answer & Question Status Charts** — Distribution across all status values (live, flagged, hidden, open, answered, review, closed).
* **Promoted Answer Counter** — Total answers promoted to corpus + average live answer net score.
* **Groq Log Viewer** — Last 200 LLM calls with action, model, prompt/response summaries, and token breakdowns.

### 🔒 Security & Auth

* **JWT Auth (24h expiry)** — Bearer token verified on every protected route; no server-side session state.
* **Role-Based Access** — `/api/admin/*` routes require a DB-confirmed `role === 'admin'` check, not just a JWT claim.
* **bcryptjs Password Hashing** — Passwords are hashed before storage; `-password_hash` excluded from all API responses.
* **Rate Limiting** — `express-rate-limit` on AI-heavy endpoints (`/api/query`, `/api/admin/cluster`) to prevent abuse and quota exhaustion.
* **catchAsync Error Wrapper** — All controllers wrapped in a single error handler; AppError instances return `{ error: "message" }` JSON; unknown errors return a generic 500.

### ⚙️ Architecture

* **Three-App Monorepo** — `backend/` (Node.js ESM), `client/` (React + Vanilla CSS), `admin/` (React + Tailwind CSS v4) — fully independent Vite apps.
* **Local-First Embeddings** — Uses `@xenova/transformers` (all-MiniLM-L6-v2, 384-dim) locally for zero API cost; falls back to external API with a 5s AbortController timeout.
* **Lazy Model Loading** — Local embedding model is loaded on first use and cached in process memory for all subsequent requests.
* **Custom Structured Logger** — `logger.info/warn/error/debug/success` with colour-coded labels, timestamps, and module names — no third-party logging library.
* **AppError Class** — Service-layer errors thrown as `new AppError('message', statusCode)` and formatted consistently by global `errorHandler.js`.
* **74 features across 12 categories** — derived from full source analysis of `backend/`, `client/src/`, and `admin/src/`.

---

## Project Structure

This repository is organized into three main services:

* **/client** - The main user-facing frontend application (React, Vite). Features a dynamic Community Board, semantic search, and user SP tracking.
* **/admin** - The administrative dashboard (React, Vite). Used for moderating community questions, reviewing AI suggestions, and viewing system analytics.
* **/backend** - The API server (Node.js, Express, MongoDB). Handles authentication, semantic clustering using HNSW, database interactions, and Groq LLM integrations.
* **/Seed** - Contains testing scripts and seed data for the MongoDB database.

---

## Prerequisites

Make sure you have the following installed:

* Node.js (v18 or higher recommended)
* MongoDB (Local or Atlas cluster)
* A Groq API Key

## Environment Setup

You need to configure your environment variables before running the project.

1. Navigate to the `/backend` directory.
2. Rename the provided `.env.example` file to `.env`.
3. Fill in your actual credentials (MongoDB URI, JWT secret, and Groq API key).

```env
# Server Configuration
PORT=5000

# Database Configuration
MONGODB_URI=mongodb://localhost:27017/samagama

# Security
JWT_SECRET=your_super_secret_jwt_key

# AI / Inference Integration
GROQ_API_KEY=gsk_your_actual_key_here

```

> **Note:** Never commit your `.env` file to version control.

## Installation & Running Locally

You will need to run three separate processes for the complete platform to function locally.

**1. Start the Backend API**

```bash
cd backend
npm install
npm run dev

```

*The backend will run on `http://localhost:5000*`

**2. Start the Client Application**
Open a new terminal window:

```bash
cd client
npm install
npm run dev

```

*The client app will run on `http://localhost:3000*`

**3. Start the Admin Dashboard**
Open a third terminal window:

```bash
cd admin
npm install
npm run dev

```

*The admin panel will run on `http://localhost:3001*`

---

## Features (Summary)

* **Semantic Search:** Utilizes Xenova/all-MiniLM-L6-v2 local embeddings combined with MongoDB Vector Search to instantly find the most relevant FAQs.
* **AI Master Generator:** Leverages the Groq API to automatically cluster un-answered community questions and draft comprehensive "Master FAQs".
* **Dynamic Analytics:** Real-time aggregation of question status, volume trends, and active categories via the Admin panel using Recharts.
* **Gamification (SP Ledger):** Users earn Samagama Points (SP) for asking and answering questions, validated through the Admin moderation queue.

## License
MIT License.
