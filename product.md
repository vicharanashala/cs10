# Samagama — Product Document

**Version:** 1.0 · **Institution:** Vicharanashala, IIT Ropar · **Program:** VINS / VISE 2026

---

## What is Samagama?

Samagama is an AI-powered FAQ and community support platform built for the Vicharanashala Summer Internship program at IIT Ropar. It replaces static FAQ PDFs and scattered WhatsApp queries with a single, intelligent hub where participants get instant answers — and contribute their own knowledge back to the community.

The platform has three components working together:

| Component | Who uses it | What it does |
|---|---|---|
| **Client App** (`/client`) | All participants | Ask Yaksha AI, browse FAQs, post community questions, vote, earn SP |
| **Admin Panel** (`/admin`) | Program coordinators | Moderate content, approve answers, manage the FAQ corpus, view analytics |
| **Backend API** (`/backend`) | Both apps | Handles all AI, search, auth, and database logic |

---

## The Problem It Solves

Every cohort of an internship program generates hundreds of repeated questions:
- *"When does the NOC need to be submitted?"*
- *"Can my HoD sign the NOC or does it have to be the principal?"*
- *"What happens if I miss the kickoff session?"*

Coordinators spend hours answering the same questions across WhatsApp, email, and Slack. New participants cannot find answers from previous batches. Important clarifications get buried in chat history.

**Samagama** solves this by:
1. Answering known questions instantly with AI (no coordinator needed)
2. Routing unknown questions to a peer community board
3. Automatically converting the best community answers into permanent FAQ entries

---

## The Three Pillars

### 1 · Yaksha AI — Instant Answers

Yaksha is Samagama's conversational AI assistant, accessible from the home page. It is not a generic chatbot — it is grounded entirely in the program's verified FAQ corpus.

**How it works:**
1. User types a question (or speaks it — voice input is supported)
2. Yaksha validates the query (blocks gibberish, abusive text, off-topic questions)
3. Automatically fixes typos and expands abbreviations (e.g., "reg" → "registration")
4. Searches the FAQ corpus using both semantic meaning and keyword overlap
5. If a confident match is found (≥ 40% similarity), Groq synthesises a structured, Markdown-formatted answer
6. If no confident match exists, Yaksha says so honestly and offers to post the question to the community board

**Key behaviours:**
- **Multi-turn memory** — follow-up questions like "Who needs to sign it?" are resolved in context; Yaksha remembers what "it" refers to
- **Sentiment awareness** — detects when a user sounds frustrated or confused and shows an empathy message above the answer
- **Cache hits** — identical or near-identical queries return instantly from cache (0.95 cosine threshold), without calling Groq again
- **Source badge** — each answer shows whether it came from the AI or the cache
- **Helpful / Not Helpful** — thumbs-down on an answer auto-opens the community post form

---

### 2 · FAQ Knowledge Base — The Corpus

The FAQ corpus is the backbone of the platform. All Yaksha answers are sourced from it.

**Structure:**
- 14 canonical categories organised as a hierarchy (`root.noc`, `root.certificate`, `root.timeline`, etc.)
- Every FAQ entry stores its question, answer, category path, source (`manual / community / ai_master`), and a 384-dimensional vector embedding
- Tags, keywords, and a priority score allow pinned and high-priority FAQs to surface first

**The FAQ Browse page** (`/faq/browse`) lets users:
- Browse all FAQs accordion-style by category
- Search in real time across all entries
- Toggle an interactive **Mind Map** — an AI-generated visual tree of topics and questions for any section, with pan/zoom and clickable leaf nodes that highlight the corresponding FAQ

**How FAQs are created:**

| Source | How it enters the corpus |
|---|---|
| `manual` | Admin creates it directly in the Admin Panel |
| `community` | Admin promotes a high-quality community answer |
| `ai_master` | Admin approves a Groq-synthesised "Master FAQ" from clustered community Q&As |

All three paths run deduplication: SHA-256 fingerprint check + 92% vector similarity check before any new entry is written.

---

### 3 · Community Board — Peer Q&A

When Yaksha cannot confidently answer a question, or when a participant wants human input, they post to the Community Board.

**Posting a question:**
- Multi-step modal: type → AI validates and rephrases → similar matches surface inline → submit
- AI auto-assigns the best category; users can override (and AI validates the override)
- Questions go through a 2-step moderation filter: `publish` (live immediately), `review` (admin queue), or `hide` (blocked)
- Voice dictation supported on all browsers that implement the Web Speech API

**On the board:**
- 4 sort modes: Newest, Most Voted, Most Viewed, Hybrid (5-signal composite score)
- 14 category chip filters
- **Community Spotlight** — questions with zero answers older than 2 minutes are automatically highlighted as urgent
- **Pinned questions** appear at the top regardless of sort mode
- Real-time search across the board

**Answering:**
- Any registered user with the Answerer role can respond
- Every submitted answer is checked by Groq before it goes live (relevance + ethics)
- Answers that fail the check are flagged for admin review, not silently blocked
- Voting: upvote/downvote on both questions and answers; users cannot vote on their own posts

**Answerer Dashboard** — a dedicated view listing all unanswered open questions, sorted unanswered-first, with per-category counts in the sidebar.

---

## Gamification — Samagama Points (SP)

SP incentivises quality participation. Every positive action earns points:

| Action | SP Earned |
|---|---|
| Post a question (approved) | +5–15 |
| Submit an answer | +10 |
| Answer gets admin-approved | +25 (answerer) + SP to asker |
| Answer promoted to FAQ corpus | +50 (answerer) + SP to asker |
| Receive an upvote | +2 |
| Best answer selected | +15 |

**Rules:**
- SP never drops below zero
- Every transaction is logged in an immutable `SPLedger` (who, when, how much, why)
- Admins can fine-tune SP amounts before approving/promoting via sliders (0–100 range)

**Leaderboard** — animated gold/silver/bronze podium for top 3, with rank tables and 3 sort modes (SP / Answers / Questions). Shows rank-change indicators and a "Your Standing" widget for logged-in users.

**6 Auto-Earned Badges:**

| Badge | Requirement |
|---|---|
| FAQ Helper | 5+ answers |
| Fast Responder | 10+ answers |
| Community Hero | 500+ SP |
| Top Contributor | 100+ SP |
| Question Master | 10+ questions asked |
| Veteran | 1000+ SP |

---

## Admin Panel — Coordinator Tools

### Dashboard
Live KPI cards: total FAQs, categories, users, community questions, spotlighted (unanswered urgent) count, pending moderation count, total AI queries.

### Moderation
Three queues in one tabbed view:
- **Flagged Answers** — review, approve (award SP), or reject. One-click "Auto-Moderate All" runs Groq over the entire queue autonomously.
- **Pending Questions** — questions held in `review` status; approve → open with SP award, or reject → hide.
- **Knowledge Review** — AI-generated Master FAQ proposals from the clustering engine; approve to inject into the corpus.

### Analytics
- Time-series charts for query volume and community questions (7d / 30d / 90d)
- Groq token usage: daily breakdown and lifetime totals (for cost monitoring)
- Category distribution, answer/question status breakdowns, user role distribution
- Top 8 SP earners, promoted answer count, average answer net score

### FAQ Management
Full CRUD: create, edit, or delete FAQ entries. Creation runs the same deduplication pipeline as promotion — admins cannot accidentally create near-duplicate entries.

### User & SP Management
User directory sorted by XP. Admins can manually adjust any user's SP balance with a reason string; every adjustment is written to the SPLedger.

### SP Ledger
Full paginated transaction log, filterable by user, admin, and date range.

### Global AI Cluster
Admin triggers Groq to read recent community Q&A pairs, cluster them by topic, and generate Master FAQ proposals with confidence scores and a moderation recommendation (`auto_approve / needs_review`).

---

## User Roles

| Role | What they can do |
|---|---|
| **Asker** | Ask Yaksha, browse FAQs, post community questions, vote |
| **Answerer** | Everything above + submit answers, access Answerer Dashboard |
| **Both** | All of the above |
| **Admin** | Full access including admin panel, moderation, FAQ CRUD, user management |

---

## SP Economy at a Glance

```
Participant asks question
  └── Yaksha answers → no SP awarded (informational)
  └── Yaksha escalates → participant posts to Community Board
        └── Answerer responds → AI checks answer
              └── Passes → Live answer → Upvotes accumulate
                    └── Admin approves → +25 SP (answerer) + SP (asker)
                          └── Admin promotes to FAQ → +50 SP (answerer) + SP (asker)
                                └── Future participants get instant Yaksha answers ✓
```

---

## Known Limitations

| Issue | Impact |
|---|---|
| Groq rate limit (6,000 TPM) | AI clustering processes ~10 Q&A pairs per batch; large backlogs queue slowly |
| Fail-open moderation | During Groq outages, `checkAnswer` defaults to "passes" — answers skip the ethics filter |
| Cold-start embedding latency | First request after server restart takes 2–5s while the local model loads |
| Mocked confidence in analytics | `avgConfidence` is hardcoded at 0.85; not computed from real Yaksha data |
| Styling inconsistency | Client uses Vanilla CSS; Admin uses Tailwind CSS v4 — two separate design systems |

---

## Tech Stack Summary

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite 8 |
| Backend | Node.js (ESM) + Express 4.21 |
| Database | MongoDB Atlas + Mongoose 8.8 |
| AI / LLM | Groq — LLaMA-3.1-8b-instant |
| Embeddings | @xenova/transformers (local, 384-dim) or configurable external API |
| Auth | JWT (24h) + bcryptjs |
| Search | MongoDB Atlas Vector Search (HNSW) |

---

## Pages & Routes

### Client (`/client`)

| Route | Page | Purpose |
|---|---|---|
| `/` | Home | Landing page with quick-ask input |
| `/faq` | FAQPage | Yaksha AI chat interface |
| `/faq/browse` | FAQBrowse | FAQ accordion browser + Mind Map |
| `/faq/community` | CommunityBoard | Community Q&A board |
| `/faq/community/:id` | QuestionDetail | Single question + answers |
| `/dashboard/answerer` | AnswererDashboard | Unanswered questions for answerers |
| `/leaderboard` | Leaderboard | SP rankings and badges |
| `/profile` | UserProfile | Contribution stats and badges |
| `/login` | Login | Authentication |
| `/register` | Register | Registration with role selection |

### Admin (`/admin`)

| Route | Page | Purpose |
|---|---|---|
| `/` | AdminDashboard | KPI overview |
| `/analytics` | AdminAnalytics | Charts and token usage |
| `/engagement` | AdminEngagement | User participation metrics |
| `/moderation` | AdminModeration | Flagged answers, pending questions, cluster review |
| `/knowledge-review` | AdminKnowledgeReview | Master FAQ proposals |
| `/faqs` | AdminFAQs | FAQ CRUD |
| `/users` | AdminUsers | User and SP management |
| `/spotlighted` | SpotlightedQuestions | Unanswered urgent questions |
| `/login` | AdminLogin | Admin authentication |

---

*Built by the Samagama team · IIT Ropar · 2026*
