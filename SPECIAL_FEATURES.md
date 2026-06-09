# Samagama — Complete Feature Catalogue

> **Repository:** `vicharanashala/cs10` · **Stack:** MERN · Groq LLaMA-3.1 · MongoDB Atlas Vector Search · @xenova/transformers  
> **Source:** Full source analysis of `backend/` (controllers, models, services, routes, middleware, utils), `client/src/` (pages, components, hooks, context, api, services), `admin/src/` (pages, components, services).  
> **Last Updated:** June 2026

---

## Table of Contents

1. [AI / Yaksha Intelligence Engine](#1--ai--yaksha-intelligence-engine)
2. [Search & Retrieval](#2--search--retrieval)
3. [Question Validation & Moderation Pipeline](#3--question-validation--moderation-pipeline)
4. [Knowledge Base Automation & Clustering](#4--knowledge-base-automation--clustering)
5. [Community Board & Q&A](#5--community-board--qa)
6. [Question Submission UX](#6--question-submission-ux)
7. [Answer Lifecycle](#7--answer-lifecycle)
8. [Gamification & SP Economy](#8--gamification--sp-economy)
9. [Mind Map Visualization](#9--mind-map-visualization)
10. [Admin Dashboard & Analytics](#10--admin-dashboard--analytics)
11. [Security & Auth](#11--security--auth)
12. [Architecture & Infrastructure](#12--architecture--infrastructure)

---

## 1 · AI / Yaksha Intelligence Engine

- **8-Phase Yaksha Query Pipeline (`services/yaksha.js`)**
  Every user query passes through exactly eight ordered phases executed in `runYakshaPipeline()`: (1) multi-turn query condensation via Groq, (2) 384-dimensional vector embedding via `@xenova/transformers`, (3) semantic cache lookup, (4) category tree routing, (5) hybrid vector + keyword search, (6) confidence gating at 0.40 threshold, (7) Groq answer synthesis using top-3 FAQ snippets, and (8) cache write-back. No phase can be skipped except the cache check and write-back, which are skipped for multi-turn conversations to prevent history contamination.

- **Confidence-Gated Community Escalation**
  When the highest-scoring FAQ result from `hybridSearch()` scores below 0.40 (the confidence threshold defined in `yaksha.js` line 52), Yaksha returns `escalate: true` instead of attempting to answer. Rather than hallucinating a plausible but potentially wrong answer, the system surfaces a "Post to Community Board" button inline within the chat interface, converting AI uncertainty into a community engagement opportunity. This is a deliberate design choice rooted in the principle that silence is better than misinformation in an institutional setting.

- **Multi-Turn Conversational Memory with Query Condensation**
  The pipeline checks `history.length > 0` before invoking `condenseQuery()` (Groq, temp=0, max_tokens=150). When history exists, the LLM is prompted with the full formatted conversation history and the latest follow-up question, and asked to produce a single self-contained standalone question that resolves pronouns like "it", "they", and "that". For example, given history about NOC requirements and a follow-up "who can sign it?", the condensed query becomes "Who can sign the NOC for the internship?" — making vector search accurate on follow-ups.

- **Semantic Cache Skip for Multi-Turn Queries**
  The semantic cache check (`checkSemanticCache`) and cache write-back are both guarded by `!hasHistory` conditions in `yaksha.js` (lines 33 and 65). This is a deliberate optimization: caching multi-turn responses would produce incorrect cache hits when a similar first-turn query is later asked in a different conversational context. Only single-turn (fresh) queries are cached, ensuring cache integrity without manual invalidation.

- **Context-Aware Groq Answer Synthesis**
  `synthesizeAnswer()` in `groq.js` injects the entire conversation history as a sequence of `user`/`assistant` messages into the Groq API call, followed by the current question. This gives LLaMA-3.1-8b-instant full memory of prior exchanges, enabling contextually coherent answers across multi-turn sessions rather than treating each turn as an isolated query.

- **Sentiment Classification on Every Response**
  The `synthesizeAnswer` Groq prompt explicitly instructs the model to classify the user's emotional tone — at temperature 0 — into one of four states: `positive`, `neutral`, `frustrated`, or `confused`. The sentiment tag is returned alongside every answer, stored in `SemanticCache`, and surfaced in admin analytics as a trend aggregation, providing coordinators visibility into participant emotional states over time.

- **Empathy Banner for Frustrated/Confused Sentiment**
  In `FAQPage.jsx`, when a Yaksha response carries `sentiment === 'frustrated'` or `sentiment === 'confused'`, the chat bubble renders a distinct amber-bordered empathy banner above the answer text: "We understand this can be confusing — here is what we found." This micro-UX detail signals emotional awareness to the user without disrupting the answer flow or requiring any coordinator intervention.

- **4-Stage LLM Response Parser (`parseYakshaResponse`)**
  Because LLMs occasionally produce malformed JSON (e.g., unescaped newlines inside a JSON string, trailing commas, markdown code fences), `parseYakshaResponse()` in `groq.js` implements four recovery stages: (1) direct `JSON.parse()` of the full response; (2) regex extraction of the first `{...}` block and parsing; (3) targeted regex key extraction for `"answer"` and `"sentiment"` when the JSON block has syntax errors; (4) brace-stripping fallback that removes JSON scaffolding and returns the raw text. Users are never shown a raw JSON string.

- **AI-Formatted Markdown Rendering in Chat (`FAQPage.jsx`)**
  `renderFormattedAnswer()` in `FAQPage.jsx` is a custom React renderer that parses Groq's structured Markdown output line-by-line. It converts `### headings` into styled `<h4>` elements with a magic-wand icon, bullet (`-`/`*`) and numbered lists into properly nested `<ul>`/`<ol>`, and `**bold**` text into `<strong>` tags with accent colouring. This renders Yaksha's structured Markdown responses as rich HTML inside the chat bubble without importing any third-party markdown library.

- **Helpful / Not Helpful Feedback per Message**
  Each non-system Yaksha message in the chat renders a "Was this helpful?" row with thumbs-up and thumbs-down buttons. On thumbs-up, `submitFeedback(cacheId, true)` is called, recording positive signal. On thumbs-down, feedback is submitted AND the "Post to Community Board" flow is triggered automatically, capturing user dissatisfaction and immediately routing it into the community escalation pipeline — closing the feedback loop without an extra user action.

- **Lazy Groq Client Instantiation**
  `getGroqClient()` in `groq.js` uses a module-level `_groq` singleton: the Groq SDK client is only constructed on the first LLM call, ensuring `dotenv` has already loaded `GROQ_API_KEY` from `.env` before construction. A warning is logged if the key is missing, but the server does not crash on startup, allowing non-LLM endpoints to remain functional in environments without a Groq key configured.

- **Universal `executeGroqCall` Wrapper with Audit Logging**
  All 10 Groq functions route through a single `executeGroqCall(actionName, options, customClient)` wrapper. This wrapper calls the API, then non-blockingly fires a `GroqLog.create()` insert capturing the action name, model, a 200-character prompt summary, a 200-character response summary, and exact prompt/completion/total token counts. On API error, an error payload is written to `GroqLog` instead of silently failing. This makes every LLM call observable for cost auditing.

---

## 2 · Search & Retrieval

- **MongoDB Atlas Vector Search (`$vectorSearch`) on Three Collections**
  The platform runs Atlas HNSW vector search on three distinct collections: `faq_vector_index` on the `FAQ` collection for main FAQ retrieval, `category_vector_index` on the `FAQCategory` collection for category routing, and `cache_vector_index` on the `SemanticCache` collection for near-duplicate query detection. Each index is tuned with a different `numCandidates` value: 30 for FAQ search (broader recall), 10 for category routing (narrow, fast), and 10 for cache lookup (tight threshold).

- **Category Tree Routing Before FAQ Search**
  Before running the main FAQ vector search, `findBestCategory()` performs a `$vectorSearch` against the `FAQCategory` collection using the query embedding. It returns the `path` field (e.g., `root.noc`) of the best-matching category. This path is then used as a filter in the subsequent FAQ search, narrowing the search space from the full corpus to a single category subtree, reducing noise and improving precision for domain-specific queries.

- **Subtree Path Expansion for Category Filtering**
  Rather than naively filtering by exact `category_path`, `hybridSearch()` fetches all `FAQCategory` documents whose `path` starts with the matched path using `$regex: ^${categoryPath}(\\.|$)`. This expands the filter to include all sub-categories under the matched node (e.g., `root.noc` also includes `root.noc.upload`, `root.noc.format`), preventing the filter from being too narrow when FAQ entries exist in deeper nodes of the category tree.

- **Hybrid Vector + Keyword Scoring Formula**
  After Atlas returns vector similarity scores, `computeKeywordRank()` runs in JavaScript memory on each result. It tokenises the query into words longer than 2 characters, counts how many appear in the FAQ's `question` and `answer` fields, and produces a 0–1 ratio. The final score formula is: `(vectorScore × 0.7) + ((questionKeywordScore × 0.7 + answerKeywordScore × 0.3) × 0.3)`. This weights semantic meaning heavily while giving a meaningful boost to exact term matches.

- **Category-to-Root Fallback on Empty Results**
  If `hybridSearch()` returns zero results for a specific category path — which can happen if no FAQs have been assigned to that subtree yet — it recursively calls itself with `categoryPath = 'root'`, performing a full-corpus search instead. This ensures Yaksha always provides the best available answer rather than returning nothing simply because the category routing was too specific.

- **Semantic Cache with 0.95 Cosine Similarity Threshold**
  `checkSemanticCache()` runs a `$vectorSearch` against the `SemanticCache` collection and only returns a hit if the top result has `similarity >= 0.95`. This threshold is intentionally high: it ensures cache hits only occur for near-identical queries (same meaning, virtually the same phrasing), avoiding false positives where semantically related but differently-intended queries would receive a cached response meant for a different question.

- **30-Day TTL Auto-Expiry on SemanticCache**
  The `SemanticCache` Mongoose model (`models/SemanticCache.js`) declares a MongoDB `expireAfterSeconds: 2592000` index on the `created_at` field. MongoDB's TTL background job automatically purges cache documents older than 30 days without any application-level cron job, scheduled task, or cleanup code. This keeps the cache collection lean, prevents stale responses from being served, and avoids unbounded storage growth in production.

- **5-Signal Hybrid Sort Algorithm for Community Board**
  The "Hybrid" sort mode in `questionService.js` computes a MongoDB aggregation pipeline score: `(net_score × 0.40) + (search_frequency × 0.20) + (recency_score × 0.15) + (priority × 0.15) + (capped_engagement × 0.10)`. Recency is scored as `max(0, 10 − ageInDays)`, decaying by 1 point per day. Engagement time is capped at 300 seconds to prevent a single highly-engaged question from dominating the score. This multi-signal approach surfaces questions that are simultaneously popular, recent, and frequently searched.

- **Full-Text Regex Search on Community Board**
  The `list()` method in `questionService.js` accepts a `search` parameter and, when provided, constructs a `$or` MongoDB filter matching `rephrased_query` and `original_query` against a case-insensitive escaped regex. Results are filtered server-side and returned as a properly paginated response, so the client's debounced search reflects server state rather than relying on client-side filtering of a pre-loaded dataset.

- **View Count Auto-Increment on Question Detail**
  When `questionService.get(id)` is called to fetch a question's detail view, it immediately fires a `Question.findByIdAndUpdate(id, { $inc: { view_count: 1 } })` in addition to returning the question data. This provides an accurate, real-time `view_count` metric that feeds into the Hybrid sort algorithm's signal set and contributes to the admin analytics category distribution charts.

---

## 3 · Question Validation & Moderation Pipeline

- **Layer 1 — Regex Sanitization (Zero API Cost)**
  Before any network call is made, submitted queries pass through a JavaScript regex layer in the query controller. This layer strips and rejects: pure greetings (`hi`, `hello`, and elongated variants like `hiiiii`), keyboard mashing and gibberish (strings with high consonant density or repeated characters), emoji-only or whitespace-only input, and all-caps strings exceeding a length threshold. This zero-cost gate prevents trivially invalid input from consuming Groq API tokens.

- **Layer 1.5 — Groq Relevance Gate (`classifyQuery`)**
  Valid input from Layer 1 is sent to `classifyQuery()` in `groq.js` (temp=0, max_tokens=150). The LLM classifies the query as one of: `VALID` (genuine program-related question), `ABUSIVE` (profanity or harassment), `GIBBERISH` (incomprehensible but not caught by regex), or `OFF_TOPIC` (entirely unrelated to an internship program, e.g., "what is 2+2"). Crucially, `classifyQuery` also returns a `cleaned_query` field with typos corrected and abbreviations expanded (e.g., "reg" → "registration"), which is used for all downstream operations.

- **Fail-Open on Groq API Error in classifyQuery**
  If the Groq API call in `classifyQuery()` throws an error (e.g., network timeout, quota exceeded), the function catches the error, logs it, and returns `{ classification: 'VALID', cleaned_query: query }`. This fail-open design prevents a Groq outage from blocking all user queries. The tradeoff — some abusive input may pass during outages — is considered acceptable given that Layer 1 regex already handles the most obvious abuse cases.

- **Layer 2 — Semantic Duplicate Detection on Question Submission**
  When a user submits a community question, `questionService.submit()` runs a `$vectorSearch` on the `FAQ` collection at a 0.90 similarity threshold. If a near-identical FAQ exists, the submission is blocked with a message pointing to the existing FAQ. A secondary check does a case-insensitive prefix regex match on `rephrased_query` against existing `Question` documents, blocking obvious text-level duplicates. Both guards run before any AI classification, minimising redundant content on the community board.

- **2-Step Community Posting Filter (`classifyForPosting`)**
  After duplicate checking, `classifyForPosting()` (Groq, temp=0, max_tokens=150) routes the new question into one of three outcomes: `publish` (clear, on-topic, useful — status becomes `open` immediately), `review` (unclear or borderline — status set to `review`, visible only to admins), or `hide` (gibberish, abusive, or off-topic — status set to `hidden`, not shown anywhere). The default fallback on API error is `review`, ensuring borderline content is not auto-published during outages.

- **AI Answer Ethics & Relevance Check (`checkAnswer`)**
  Every community answer passes through `checkAnswer()` (Groq, temp=0, max_tokens=100) before going live. The prompt asks the LLM to evaluate: (1) Is the answer actually relevant to the question asked? (2) Is it free of profanity, harassment, or program misinformation? If `passes: false`, the answer's status is set to `flagged` and it enters the admin moderation queue. If `passes: true`, it goes directly to `live` status. On Groq API failure, the default is `{ passes: true }` (fail-open) to avoid blocking valid answers during outages.

- **AI Category Validation on Question Submission (`validateCategory`)**
  When a user manually selects a category for their question rather than relying on auto-categorisation, `validateCategory()` (Groq, temp=0, max_tokens=150) cross-checks whether the question is at least loosely relevant to the selected category. If the LLM returns `matches: false`, the mismatch is flagged, and the system falls back to auto-categorising via `categorizeQuestion()`. This prevents questions from being intentionally or accidentally miscategorised, keeping category-based search and analytics accurate.

- **Auto-Moderate All — Batch AI Moderation**
  Admins can trigger a single endpoint that fetches the entire flagged answer queue and loops through each entry, calling `evaluateAnswerReward()` for every answer. The function returns `action: 'approve' | 'reject'`, `answererXp`, `askerXp`, and a human-readable `reason`. Approved answers are set to `live` and SP is awarded automatically. Rejected answers are set to `hidden`. This allows a backlog of dozens of flagged answers to be processed in one admin action without requiring per-answer manual review.

- **Admin Pending Question Review Queue**
  Questions classified as `review` by `classifyForPosting()` enter a pending queue visible only to admins in `AdminModeration.jsx`. Admins can `approvePendingQuestion()` (sets status to `open`, awards `askerXp` SP with a ledger entry) or `rejectPendingQuestion()` (sets status to `hidden`). This two-stage gating ensures that genuinely borderline questions receive human review before being exposed to the community board, balancing automation with oversight.

---

## 4 · Knowledge Base Automation & Clustering

- **Global AI Cluster → Master FAQ Generation (`clusterQuestions`)**
  Admins trigger the `globalAiCluster` endpoint, which fetches community `Question` + approved `Answer` pairs from the database (capped at ~10 pairs to respect Groq's 6,000 TPM limit), serialises them to JSON, and sends them to `clusterQuestions()` (Groq, temp=0, max_tokens=4000). The LLM groups semantically related pairs into clusters and synthesises a `masterQuestion`, `masterAnswer`, `confidenceScore`, `moderationStatus` (`auto_approve | needs_review`), `normalizedIntent`, `flaggedOrRepeated` list, and `shortSummary` for each cluster. The output is stored as pending proposals visible in `AdminKnowledgeReview.jsx`.

- **Structured JSON Schema Enforcement for LLM Output**
  The `clusterQuestions` system prompt explicitly defines the required JSON schema — `{ proposals: [{ clusterTitle, questionIds, masterQuestion, masterAnswer, category, tags, normalizedIntent, confidenceScore, moderationStatus, flaggedOrRepeated, shortSummary }] }` — and instructs the LLM to output raw JSON without any markdown fencing. A regex fallback extracts the first `{...}` block if the model accidentally wraps its output in a markdown code block, ensuring robust parsing regardless of minor prompt non-compliance.

- **HNSW-Based Autonomous FAQ Clustering (`clusterAllFAQs`)**
  `clusterAllFAQs()` in `clusteringService.js` iterates over all (or filtered) FAQ documents using a MongoDB cursor, generates a 384-dimensional embedding for each `question + answer` concatenation, computes cosine similarity against all 14 pre-computed canonical category centroid embeddings in memory, and assigns each FAQ to the highest-scoring category. The comparison is done in JavaScript using the `cosineSimilarity()` function, which computes dot product and Euclidean norms, avoiding additional Atlas API calls for the scoring step.

- **Scope-Based Clustering Filters**
  `clusterAllFAQs()` accepts a `scope` parameter supporting three values: `'all'` (re-cluster the entire corpus), `'uncategorized'` (only FAQs with `category_path: 'root'`, `'root.general'`, or `null`), and `'root'` (only FAQs at the root level). This allows admins to run targeted clustering passes — e.g., only re-categorise newly seeded FAQs — without touching correctly categorised entries, reducing unnecessary database writes and processing time.

- **Dry-Run Preview Mode for Clustering**
  Both `clusterAllFAQs()` and `clusterSingleFAQ()` accept a `dryRun: true` flag. When enabled, the functions compute the best-matching category for every FAQ and return the full result set (including `changed: true/false`, old path, new path, similarity score) without writing any changes to MongoDB. Admins can inspect the preview in `AdminModeration.jsx` before committing the full clustering job, preventing accidental mass-reclassification of the live FAQ corpus.

- **Category Centroid Embedding Cache**
  `getCategoryEmbeddings()` in `clusteringService.js` computes 384-dimensional embeddings for all 14 categories (using each category's `description + keywords` string) and stores them in a module-level `Map` (`_categoryEmbeddingCache`). Subsequent calls return the cached map instantly, avoiding 14 redundant embedding API calls on every clustering pass. The cache is invalidated by calling `clearCategoryEmbeddingCache()`, which sets the map to `null`, forcing recomputation on the next call.

- **Community-to-Corpus Promotion Pipeline (`promoteAnswer`)**
  `adminService.promoteAnswer()` executes a five-step promotion flow: (1) generates a fresh combined embedding for `question + answer`; (2) computes an SHA-256 fingerprint of the normalised question text; (3) checks for an exact fingerprint match in the `FAQ` collection; (4) if no exact match, runs a `$vectorSearch` at 0.92 similarity to catch semantic near-duplicates; (5) only if both checks pass, upserts a new `FAQ` document with `source: 'community'` and awards SP to both the answerer and the asker via `SPLedger` entries.

- **Promotion Refresh for Already-Promoted Answers**
  If an answer has already been promoted (`promoted_to_corpus: true`) and is promoted again, `promoteAnswer()` detects the existing `FAQ` record via fingerprint match, updates the `answer` text and `embedding` to the latest version, and returns `action: 'refreshed'` instead of creating a duplicate. This allows admins to update an already-promoted FAQ's answer without needing to go into the `AdminFAQs.jsx` CRUD interface manually.

- **SHA-256 Question Fingerprinting for Exact Deduplication**
  Every FAQ question is normalised (lowercase, trimmed) and hashed using Node.js `crypto.createHash('sha256')` before storage. The fingerprint is stored in the `FAQ.fingerprint` field, which has a MongoDB unique index. This provides O(1) exact-match deduplication: if the same question is submitted again with any capitalisation or whitespace variation, the fingerprint will match and the promotion is blocked before the 92% vector similarity check runs, saving an Atlas API call.

- **Canonical Category Sync (`syncCanonicalCategories`)**
  `syncCanonicalCategories()` in `clusteringService.js` iterates over all 14 canonical category definitions, retrieves the cached embedding for each, and upserts the corresponding `FAQCategory` document in MongoDB — updating `label`, `description`, and `embedding` if the document already exists, or creating it if it does not. This is designed to be re-run whenever the canonical category definitions are updated in code, keeping the `FAQCategory` collection (which backs the `$vectorSearch` index) in sync with the source of truth.

- **FAQ Upsert with Semantic Dedup on Admin Manual Creation**
  `adminService.createFaq()` runs the same SHA-256 fingerprint check and 0.92 vector similarity check as `promoteAnswer()` before creating a new FAQ entry from the admin panel. If a semantically similar FAQ exists, it returns a 409 error with the matching question text and similarity percentage shown to the admin, preventing duplicate FAQ creation even through the manual CRUD interface in `AdminFAQs.jsx`.

---

## 5 · Community Board & Q&A

- **Tiered Display Order: Pinned → Spotlighted → Regular**
  Regardless of the selected sort mode (Newest, Top Voted, Most Viewed, or Hybrid), `questionService.list()` always applies a three-tier display order after fetching: pinned questions (`is_pinned: true`) appear first, followed by spotlighted questions (open, zero answers, older than 2 minutes), followed by all remaining questions sorted by the selected mode. This guarantees coordinator announcements are always at the top, urgent unanswered questions are always visible, and everything else is sorted by relevance.

- **Community Spotlight — Automatic Urgency Surfacing**
  The `isSpotlighted()` function in `questionService.js` marks a question as spotlighted when: `status === 'open'`, `answer_count === 0`, and the question was posted more than `SPOTLIGHT_THRESHOLD_MS = 2 * 60 * 1000` (2 minutes) ago. The threshold is intentionally low — any genuinely unanswered question is spotlighted almost immediately — creating a live "needs answers" section. The spotlighted count is also returned in the API response as `spotlightTotal`, separate from the paginated list, allowing the client to show a "X unanswered questions need help" badge.

- **4 Sort Modes with Full Pagination**
  The community board supports four distinct sort modes, each backed by a separate MongoDB query path: `newest` (`created_at: -1`), `most_voted` (`net_score: -1`), `most_viewed` (`view_count: -1`), and `hybrid` (5-signal aggregation pipeline). All modes are fully paginated with configurable `page` and `limit` parameters (limit capped at 100 to allow full spotlight fetches), and return `total`, `pages`, `spotlightTotal`, and the current `page` for client-side pagination controls.

- **Category Chip Filtering with 14 Canonical Categories**
  The community board client (`CommunityBoard.jsx`) renders a horizontal row of category chips loaded from the `GET /api/categories/all` endpoint. Each chip corresponds to one of the 14 canonical categories (`root.noc`, `root.certificate`, `root.vibe`, etc.). Selecting a chip sends `category_path` as a query parameter, which the `questionService.list()` filter applies directly as a MongoDB equality match on the `category_path` field, enabling instant category-scoped filtering with no client-side data manipulation.

- **Pinned Questions with Admin Control**
  Admins can toggle `is_pinned: true` on any question via the admin endpoints. Pinned questions receive distinct golden-border styling in the client and are always surfaced at the very top of the list regardless of sort mode or search filters. The `getFaqs()` admin query also sorts by `is_pinned: -1` first, making pinned items visible at the top of the admin FAQ management view as well.

- **Atomic Vote Counting with Race-Condition Prevention**
  `questionService.vote()` and the equivalent answer vote handler use MongoDB's `$inc` operator on `upvotes`, `downvotes`, and `net_score` fields in a single `findByIdAndUpdate` call. The `Vote` model has a compound unique index on `{ user_id, question_id, type }` that throws an error with code `11000` on duplicate insertion. The service catches this specific error code and returns a 409 response with "You have already voted on this question", preventing double-voting without requiring a separate pre-check query.

- **Self-Vote Protection**
  Before inserting a vote, `questionService.vote()` compares `question.posted_by.toString()` against `userId.toString()`. If they match, a 403 `AppError` is thrown immediately without touching the `Vote` collection. This enforces the community norm that users cannot vote on their own contributions, preventing SP gaming through self-upvoting.

- **Answerer Dashboard — Unanswered-First Dedicated View**
  `AnswererDashboard.jsx` provides a dedicated view for users who want to contribute answers. It fetches questions with `status: 'open'` and sorts them with `answer_count: 0` questions first (unanswered), followed by questions with partial answers. A sidebar shows per-category question counts, and category chips allow filtering to a specific topic. This reduces the friction for peer support by giving answerers a focused, actionable interface separate from the general community board browsing experience.

- **Hidden Answer Count Display on Question Detail**
  `questionService.get()` returns both the list of visible answers (`status: 'live'` or `flagged`) and a `hidden_count` from a separate `Answer.countDocuments()` call. The question detail page renders "X hidden answer(s)" below the visible answers, giving users transparency that content exists but has been moderated away, without revealing the content itself. This maintains trust in the moderation process.

- **Engagement Time Tracking**
  `questionService.addEngagementTime(id, timeSeconds)` increments the `engagement_time` field on a question by a given number of seconds. The client is expected to call this endpoint when a user spends time reading a question's detail view. This engagement signal feeds into the Hybrid sort algorithm (capped at 300 seconds weight), creating a nuanced "time-on-page" quality signal that distinguishes genuinely interesting questions from ones that are merely often-searched.

- **Search Frequency Hit Tracking**
  `questionService.addSearchHit(id)` increments `search_frequency` on a question document. This is called when a question appears in search results, providing a "how often is this found by users" signal distinct from view count. The `search_frequency` field is one of the five inputs to the Hybrid sort score, with a weight of 0.20, ensuring highly-searched questions are elevated on the community board.

---

## 6 · Question Submission UX

- **600ms Debounced Real-Time Validation**
  The question submission modal (`AskQuestionModal.jsx`) calls the `/api/query/validate` endpoint 600 milliseconds after the user stops typing, giving instant visual feedback without flooding the server with requests on every keystroke. The textarea border colour changes in real time based on the validation response: red for rejected, green for clean/valid, and amber for "similar match found", making the validation state immediately visible without the user needing to submit the form.

- **AI Query Preview — "Will Post As" Display**
  After `classifyQuery()` cleans and normalises the user's input (fixing typos, expanding abbreviations), the modal displays the `cleaned_query` as a preview: "Will post as: [cleaned version]". This transparency allows users to confirm the AI's interpretation of their question before committing to the post, preventing situations where an abbreviation is expanded incorrectly or a typo correction changes the meaning of the question.

- **Similar Match Surfacing with Inline Answer Preview**
  When Layer 2 validation finds a semantically similar FAQ or community question (similarity >= 0.70), the modal renders it inline as a dismissible card showing the matching question text and a collapsible answer preview. Users can read the existing answer and decide whether their question is already resolved, or dismiss the match and proceed to post. This reduces duplicate questions while respecting user autonomy — the match is a nudge, not a block.

- **Voice Input via Web Speech API**
  `FAQPage.jsx` includes a microphone button that invokes `window.SpeechRecognition || window.webkitSpeechRecognition`. When clicked, speech recognition starts with `lang: 'en-US'` and `interimResults: false`. On the `onresult` event, the transcript is appended to the current input field value (not replacing it, so the user can combine typed and dictated text). The button shows a distinct "Listening..." state and reverts on `onend` or `onerror`. A browser support check shows an alert if the API is unavailable.

- **Auto-Categorisation with Opt-Out**
  When a user leaves the category selector at `'general'` (the default), the backend's `questionService.submit()` automatically calls `categorizeQuestion()` (Groq) to assign the best-fit category path. Users can also manually select any of the 14 canonical categories from a dropdown in the submission modal. If they manually select a category, `validateCategory()` is called to confirm the selection is appropriate; if not, the system overrides with the auto-classified result. Manual selection is respected when valid.

- **Question Rephrase Pipeline (`rephraseQuery`)**
  On the prepare step before submission, `rephraseQuery()` (Groq, temp=0, max_tokens=220) receives the raw user query and returns a `rephrased` version that is grammatically correct, phrased as a clear question, and accompanied by the best matching `category_path` and `category_label` from the live database category list. The rephrased question is what gets stored as `rephrased_query` and displayed on the community board — the raw original is preserved in `original_query` for admin reference.

- **Character Count and Submission Guard**
  The query input in `FAQPage.jsx` enforces a minimum of 8 characters and a maximum of 500 characters (after stripping HTML tags and collapsing whitespace). A real-time counter shows `"Type N more characters..."` below the minimum, and `"Ready to send"` once valid. The submit button is disabled (`disabled` attribute) when `isValidInput` is false or while a request is in flight, preventing double submission or empty queries from reaching the API.

---

## 7 · Answer Lifecycle

- **Answer Status State Machine**
  Every community answer follows a defined state machine: submitted → AI-checked → `live` (if passes) or `flagged` (if fails ethics check). From `flagged`, an admin can `approveAnswer()` (→ `live`) or `rejectAnswer()` (→ `hidden`). From `live`, an answer can be `promoteAnswer()`d into the FAQ corpus. Questions similarly flow: `review` → (admin approves) → `open` → (gets answers) → `answered`, or → `hidden` (rejected), or → `closed` (admin closes). These state transitions are enforced server-side in the respective service functions.

- **Answer Edit History with Full Audit Trail**
  The `Answer` Mongoose model stores an `edit_history` array of embedded sub-documents, each containing `edited_by` (user ID), `previous_content`, `reason`, and `edited_at` timestamp. When an answer is edited, the previous content is pushed to this array before the new content replaces it. Admins can retrieve the full edit history via `adminService.getAnswerHistory(answerId)`, which is exposed in `AdminModeration.jsx`, providing full accountability for every content change.

- **Answer Sort Order on Question Detail**
  Answers on the question detail page are sorted by `{ net_score: -1, created_at: -1, status: 1 }`. This ordering prioritises the highest-voted answer first (best answer first), breaks ties by recency, and ensures `live` status answers appear above `flagged` ones (since 'live' < 'flagged' alphabetically). This gives users the best available answer at the top without requiring any client-side sorting.

- **Promoted Answer Badge on User Profile**
  `UserProfile.jsx` fetches the user's submitted answers and checks the `promoted_to_corpus` field. Answers where this is `true` display a "Promoted to FAQ ⚡" badge next to the answer preview, visually distinguishing high-value contributions that have been elevated to the official knowledge base. This badge also serves as a gamification signal, encouraging users to write comprehensive, high-quality answers that are likely to be promoted.

---

## 8 · Gamification & SP Economy

- **Samagama Points (SP) System with XP Tracking**
  Users accumulate `xp` (experience points, used interchangeably with SP in the codebase) for every positive action: posting approved questions, submitting answers at various quality tiers, receiving upvotes, getting answers approved, and having answers promoted to the FAQ corpus. The `xp` field on the `User` model is the single source of truth for SP balance. SP is always non-negative — every update uses `Math.max(0, user.xp + delta)` to prevent the balance from dropping below zero, even when penalties are applied.

- **Immutable SP Transaction Ledger (`SPLedger`)**
  Every SP change — whether from an admin action, an answer approval, a question promotion, or a manual adjustment — creates an `SPLedger` document storing: `user_id`, `admin_id` (who authorised), `amount` (positive or negative delta), `reason` (human-readable string), `old_balance`, `new_balance`, and `created_at`. This ledger is append-only from the application's perspective (no ledger records are updated or deleted), providing a complete, timestamped audit trail of every SP movement for every user.

- **Cross-Actor Rewarding on Answer Approval**
  When an admin approves a flagged answer via `adminService.approveAnswer()`, SP is awarded to two users: the `answered_by` user (the answerer) receives `answererXp` SP, and the `posted_by` user on the associated question (the asker) receives `askerXp` SP — but only if the asker and answerer are different users. Both awards are recorded in separate `SPLedger` entries with reason strings "Answer approved by admin" and "Question answered — asker SP reward" respectively. This incentivises both quality question-asking and quality answering.

- **Admin-Adjustable SP Sliders (0–100 SP Range)**
  In `AdminModeration.jsx` and `AdminUsers.jsx`, admins can use range slider inputs to fine-tune the SP amount awarded before approving an answer or promoting it to the corpus. The default values are `answererXp: 15` and `askerXp: 10` for approval, and `answererXp: 25` and `askerXp: 15` for promotion. Admins can override these per-action within 0–100 SP, allowing discretionary rewards for exceptional contributions without changing the defaults for routine moderation.

- **AI-Evaluated Answer Quality Rewards (`evaluateAnswerReward`)**
  The Auto-Moderate All feature calls `evaluateAnswerReward()` (Groq, temp=0.1, max_tokens=200) for each answer. The LLM applies a 4-tier rubric: "extremely detailed and helpful" → 15 SP + approve; "solid and correct" → 10 SP + approve; "barely acceptable, low effort" → 5 SP + approve; "irrelevant, spam, or harmful" → 0 SP + reject. It also separately evaluates the question quality and returns `askerXp` of 15 SP for a well-phrased question or 5 SP for a poor one. Safety bounds clamp all values to the 0–15 SP range regardless of LLM output.

- **Leaderboard with Animated Podium and 3 Sort Modes**
  `Leaderboard.jsx` renders the top 3 users as an animated podium with CSS-animated gold/silver/bronze styling, distinct heights for 1st/2nd/3rd place, and badge icons. The rest of the leaderboard is a ranked table. Three sort tabs — SP Earned, Answers, and Questions — reorder the list client-side. A sidebar panel titled "How to Earn SP" lists all reward actions with their SP amounts, educating users on the economy. Rank-change indicators (↑/↓ deltas) are displayed if historical ranking data is available.

- **Badge System — 6 Auto-Earned Badges**
  `UserProfile.jsx` computes badge eligibility client-side from the user's `xp` and `answers_count` fields: "FAQ Helper" (first approved answer), "Top Contributor" (5+ approved answers), "Fast Responder" (answer within 10 minutes of question posting), "Community Hero" (10+ answers), "Question Master" (5+ questions posted), and "Veteran" (100+ XP). Badges are displayed as coloured icon chips on the user profile. Since the computation is client-side, no additional API call is required — the user data returned from `/api/auth/me` already contains the necessary fields.

- **Paginated SP Ledger with Multi-Axis Filtering**
  `adminService.getSpLedger()` supports simultaneous filtering by `userId`, `adminId`, `fromDate`, and `toDate`. All filters are combined in a single MongoDB `find()` query using a dynamically built filter object. Results are paginated with configurable `page` and `limit` (capped at 100 per page) and return `total`, `pages`, and the paginated `data` array. Each ledger entry is populated with the user's `name` and `email` and the admin's `name` and `email`, making the exported view immediately human-readable without requiring separate lookups.

---

## 9 · Mind Map Visualization

- **AI-Generated Hierarchical Mind Map Tree (`generateMindMap`)**
  `generateMindMap()` in `groq.js` (temp=0.2, max_tokens=1200) sends up to 15 FAQ items from a selected section (capped to avoid token overflow) to LLaMA-3.1-8b-instant. The prompt instructs the LLM to group questions into 3–6 meaningful branch topics, place the actual FAQ questions as leaf nodes under each branch, and output a strict JSON schema: `{ root, children: [{ id, label, children: [...] }] }`. A hard fallback converts the raw FAQ list into a flat radial tree if the LLM output cannot be parsed.

- **Pan and Zoom SVG Canvas (`MindMap.jsx`)**
  The `MindMap.jsx` component manages a `viewBox` state and handles `onWheel` events (zoomed with a 0.001 scale factor, clamped to 0.35×–3× zoom levels) and `onMouseMove`/`onMouseDown`/`onMouseUp` events for drag-panning. Zoom is centred on the cursor position using the standard SVG viewBox recalculation formula. The SVG element itself uses `cursor: grab` (changing to `cursor: grabbing` while dragging) and `user-select: none` to prevent text selection during drag.

- **Staggered Fade-In Animation for Nodes and Edges**
  Every node `<circle>` and `<text>` element in the rendered SVG has an inline `animation` style of `mmFadeIn 0.4s ease forwards` with a per-node `animationDelay` computed as `nodeIndex * 0.05s`. The CSS `@keyframes mmFadeIn` animates from `opacity: 0, transform: scale(0.6)` to `opacity: 1, transform: scale(1)`. This creates a staggered "bloom" effect where nodes appear sequentially outward from the root, making the mind map feel alive rather than static.

- **Cubic Bézier Edge Curves**
  Edges between nodes in the SVG are rendered as `<path>` elements using cubic Bézier curves: `M x0 y0 C cx1 cy1 cx2 cy2 x1 y1`. The control points are computed as the midpoints of the source and target coordinates, with the x-coordinates swapped, producing smooth S-shaped curves. Branch edges use a thicker stroke (2.5px) with the accent primary colour, while leaf edges use a thinner stroke (1.5px) with a muted colour, visually distinguishing hierarchy levels.

- **Clickable Leaf Nodes with FAQ Highlight Integration**
  Leaf nodes (FAQ question labels) in the mind map have an `onClick` handler that calls the `onNodeClick(label)` prop passed from the parent component (`FAQBrowse.jsx`). The parent uses this label to filter the FAQ accordion view, highlighting or scrolling to the corresponding FAQ entry. This creates a bidirectional link between the visual mind map and the text-based FAQ browser, allowing users to navigate the knowledge base both visually and textually.

- **Loading Skeleton for Mind Map Generation**
  While `generateMindMap()` is awaiting the Groq API response, `FAQBrowse.jsx` renders a pulsing placeholder SVG with generic grey circles and lines at the expected node positions. This skeleton follows the same radial layout as the real mind map, giving users a preview of the expected structure during the (typically 2–4 second) generation delay and preventing the layout from jumping when the real content loads.

---

## 10 · Admin Dashboard & Analytics

- **Real-Time KPI Dashboard (`adminService.getDashboard`)**
  The admin dashboard aggregates 9 metrics in a single function call: `FAQ.countDocuments()`, `FAQCategory.countDocuments()`, `User.countDocuments()`, `Question.countDocuments({ status: { $in: ['open', 'answered'] } })`, `Answer.countDocuments({ status: 'flagged' })`, `Answer.countDocuments({ status: 'live', net_score: { $gte: 3 }, promoted_to_corpus: { $ne: true } })` (genuine FAQ proposal candidates), `Question.countDocuments` (spotlighted count), `SemanticCache.countDocuments()` (total AI queries), and the 10 most recent cache entries for a "recent queries" feed. All counts are computed at request time, not cached.

- **Date-Filterable Time-Series Analytics (7d / 30d / 90d)**
  `adminService.getAnalytics(period)` computes a merged time-series by building a `dateMap` with one entry per day in the selected period (initialised to zero), then filling it with results from two parallel MongoDB aggregation pipelines: `SemanticCache` grouping by `$dateToString` (query volume per day) and `Question` grouping by `$dateToString` (community questions posted per day). The merged array guarantees every day in the range appears in the chart data, even if no activity occurred, preventing gaps in the time-series visualisation.

- **Groq Token Usage Audit with Daily Breakdown**
  `getAnalytics()` runs two Groq-specific aggregations: a total summary (`totalTokens`, `totalPromptTokens`, `totalCompletionTokens`, `totalCalls`) and a per-day breakdown (`tokens`, `calls`) for the selected period. Both are sourced from the `GroqLog` collection, which stores the exact token usage of every API call. `AdminAnalytics.jsx` renders the daily token series as a bar chart and displays the lifetime totals as KPI cards, giving admins precise cost visibility.

- **User Role Distribution Aggregation**
  `getAnalytics()` includes a `User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }])` pipeline that counts users by role (`asker`, `answerer`, `both`, `admin`). This is rendered as a pie or bar chart in `AdminAnalytics.jsx`, giving coordinators demographic insight into the platform's active user base composition — e.g., whether most users are askers or answerers.

- **Answer and Question Status Breakdown Charts**
  Two separate aggregation pipelines — `Answer.aggregate` and `Question.aggregate` grouped by `status` — produce counts for every status value. Answer statuses (`live`, `flagged`, `hidden`) and question statuses (`open`, `answered`, `review`, `hidden`, `closed`) are displayed as separate distribution charts in `AdminAnalytics.jsx`. These give moderation teams an overview of the pipeline health: e.g., a large `flagged` count indicates a backlog, while a large `review` count indicates the posting filter is being conservative.

- **Promoted Answer Counter and Average Answer Score**
  `getAnalytics()` computes `promotedCount = Answer.countDocuments({ promoted_to_corpus: true })` and `avgAnswerScore = Answer.aggregate` with `$avg: '$net_score'` filtered to `status: 'live'`. These two metrics measure the platform's knowledge extraction effectiveness: the promoted count shows how much community knowledge has been formalised, and the average answer score provides a proxy for community content quality over time.

- **Groq Log CRUD Viewer**
  `adminService.getGroqLogs()` returns up to 200 recent `GroqLog` documents sorted by `created_at: -1`. Each log entry contains the action name, model, a truncated prompt summary, a truncated response summary, and full token breakdown. This allows admins to audit any specific LLM call — e.g., investigate a failed cluster operation — by reading the exact prompt context and response that was generated, without needing database access or server logs.

- **Query Logs with Sentiment-Based Action Inference**
  `adminService.getQueryLogs()` fetches the 100 most recent `SemanticCache` entries and maps each to a formatted log entry. The `actionTaken` field is inferred from sentiment: `negative` sentiment → `clarify`, all others → `answer`. The `confidence` field is inferred from sentiment: `positive` → 0.95, `neutral` → 0.80, `frustrated/confused` → 0.40. While these are approximations (not the actual confidence scores), they provide a useful heuristic view of recent query outcomes for admin oversight.

---

## 11 · Security & Auth

- **JWT-Based Stateless Authentication**
  `authService.js` issues a JWT (`jsonwebtoken`) signed with `process.env.JWT_SECRET` and expiring in 24 hours on successful login. The token is returned to the client and must be included as a `Bearer` token in the `Authorization` header on all protected requests. `middleware/auth.js` verifies the token on every protected route, extracts the `userId`, and attaches it to `req.user`. No server-side session state is maintained, making the auth system horizontally scalable.

- **Role-Based Access Control with Separate Admin Middleware**
  All routes under `/api/admin/*` are protected by two sequential middlewares: `authMiddleware` (verifies the JWT and extracts `userId`) and `adminMiddleware` (queries the database for the user and checks `user.role === 'admin'`, throwing a 403 if not). Regular user routes use only `authMiddleware`. This separation means a valid user JWT cannot access admin endpoints — the role check is a server-side database query, not just a JWT claim, preventing privilege escalation via token forgery.

- **Password Security with bcryptjs**
  Passwords are hashed using `bcryptjs` before storage in the `User.password_hash` field. All `User.find()` and `User.findById()` calls use `.select('-password_hash')` to exclude the hash from API responses. The `adminService.login()` uses `bcrypt.compare()` to verify the provided password against the stored hash. The raw password is never stored, logged, or returned in any API response.

- **Rate Limiting on AI-Intensive Endpoints**
  `express-rate-limit` v7.4 is applied to the AI endpoint routes (`/api/query`, `/api/admin/cluster`) to prevent abuse. The rate limiter enforces a per-IP request quota (configurable via environment variables), returning a 429 response when the limit is exceeded. This protects against both accidental request floods from misbehaving clients and deliberate abuse that would exhaust Groq API quota or inflate costs.

- **Input Length and Type Validation via Mongoose Schema**
  All Mongoose models define explicit field-level constraints: `enum` validators for `role`, `status`, and `source` fields ensure only valid values are stored; `min`/`max` length constraints prevent excessively long strings; `required: true` enforces mandatory fields. Mongoose throws a `ValidationError` on any document that violates these constraints, which the global `errorHandler.js` middleware catches and returns as a 400 JSON response, blocking malformed data from reaching the database.

- **`catchAsync` Global Error Wrapper**
  All route handler functions are wrapped in a `catchAsync(fn)` utility from `utils/appError.js`. This wrapper returns an async function that calls `fn(req, res, next)` inside a `try/catch`, passing any unhandled rejection to `next(error)`. The global `errorHandler.js` middleware then formats the error as `{ error: "message" }` JSON with an appropriate HTTP status code. This eliminates the need for try/catch blocks in individual controllers and ensures consistent, machine-parseable error responses across all 40+ endpoints.

---

## 12 · Architecture & Infrastructure

- **Three-App Monorepo Structure**
  The project is structured as three fully independent Vite/Node.js applications sharing no build tooling: `backend/` (Node.js ESM, Express 4.21, served on its own port), `client/` (React 19 + Vite 8, public-facing), and `admin/` (React 19 + Vite 8, admin-facing). The two frontend apps communicate with the shared backend via REST. This isolation means admin panel bugs cannot affect the public client, and the admin app can be deployed on a separate internal-only domain for additional security.

- **Zero-Cost Local-First Embedding with Fallback**
  `embeddingService.js` first checks if `process.env.EMBEDDING_API_URL` is set. If set, it makes an HTTP `fetch()` to the external API with a 5-second `AbortController` timeout. If the environment variable is absent or the request fails/times out, it falls back to loading `Xenova/all-MiniLM-L6-v2` locally via `@xenova/transformers`. The local model produces identical 384-dimensional normalised float vectors, so switching between modes requires no code changes — only the environment variable.

- **Lazy Local Model Loading with Process-Level Cache**
  The local `@xenova/transformers` extractor is stored in a module-level `_extractor` variable in `embeddingService.js`. On the first call to `getEmbedding()`, if `_extractor` is null, the model is loaded asynchronously (taking 2–5 seconds for the ~23 MB download and initialisation). All subsequent calls return from the in-memory `_extractor` instance instantly. This lazy-loading pattern avoids a mandatory startup delay for deployments that have `EMBEDDING_API_URL` configured and never need the local model.

- **Custom Structured Logger (`utils/logger.js`)**
  The backend uses a custom logger with five named methods: `logger.info`, `logger.warn`, `logger.error`, `logger.debug`, and `logger.success`. Each method prefixes the output with a coloured label (e.g., `[ERROR]`, `[SUCCESS]`), a timestamp, a module name (e.g., `'Yaksha.cache'`), and the message. This structured format makes log parsing and grep-based debugging significantly easier than unstructured `console.log` calls, and provides clear severity levels without importing a third-party logging library.

- **AppError Class for Consistent HTTP Error Responses**
  `utils/appError.js` exports an `AppError` class that extends `Error` with a `statusCode` field. Service functions throw `new AppError('message', statusCode)` for known error conditions (e.g., `new AppError('Answer not found.', 404)`). The global `errorHandler.js` middleware detects `AppError` instances by their `isOperational` flag and returns `{ error: message }` with the specified status code, versus unknown errors which return a generic 500 response. This two-tier error handling prevents internal stack traces from leaking to API consumers.

- **Question Status State Machine Enforcement**
  Status transitions are enforced at the service layer: `approvePendingQuestion()` throws if `question.status !== 'review'`; `approveAnswer()` throws if `answer.status !== 'flagged'`; `rejectAnswer()` throws if `answer.status !== 'flagged'`. These guards prevent invalid state transitions (e.g., trying to approve an already-live answer) from silently succeeding and corrupting the status machine. Every transition that changes status also creates an SP ledger entry or logs a change, maintaining a full audit trail.

- **DNS/Network Setup Utility (`dns-setup.js`)**
  The backend root includes `dns-setup.js`, which configures Node.js DNS resolution order to prefer IPv4 (`dns.setDefaultResultOrder('ipv4first')`). This is commonly needed on Windows and some Linux environments where MongoDB Atlas connection strings resolve to IPv6 addresses first, causing connection failures in environments without IPv6 routing. Loading this module at server start ensures consistent network connectivity across development and deployment environments without requiring OS-level DNS configuration changes.

- **Separate Admin and Client Vite Configurations**
  `client/vite.config.js` and `admin/vite.config.js` are independently configured with separate API proxy targets (both proxying `/api` to the backend, but independently configurable), output directories (`client/dist` and `admin/dist`), and HMR ports. The admin app additionally enables Tailwind CSS v4 via its PostCSS pipeline, while the client uses Vanilla CSS without any PostCSS processing. This independence allows the two frontends to have different build and styling toolchains without conflict.

---

*Derived from full source analysis of `GitHub/backend/` (controllers, models, services, routes, middleware, utils), `GitHub/client/src/` (pages, components, hooks, context, api, services), and `GitHub/admin/src/` (pages, components, services). Total codebase: ~120,000 characters across 50+ source files.*
