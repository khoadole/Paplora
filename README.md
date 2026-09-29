# Paplora

Turn a stack of papers into a comparison table where every extracted answer can be traced back to the passage it came from — and where "we could not find this" is a different answer from "we could not read this".

Everything runs locally in your browser. No account, no sign-in, no server round trip, unless you deliberately turn on automatic extraction.

---

## Running it

Requires **Node 18.18+** and npm.

```bash
npm install
cp .env.example .env.local    # optional; the app runs fine with it empty
npm run dev                   # http://localhost:3000, or the next free port — the terminal says which
```

The root URL **is** the workspace. There is no landing page, no sign-up and no onboarding questionnaire to get past.

```bash
npm run typecheck   # tsc --noEmit
npm test            # 64 tests, node:test + tsx, no network and no keys needed
npm run build       # production build
npm run samples     # regenerate the demo PDFs in public/samples/
```

---

## Three modes, three levels of trust

**1. Local workspace — always available.** Projects, PDF upload and parsing, columns, manual cells, review actions, search, export and backup all work with no credentials of any kind. Data lives in this browser's IndexedDB.

**2. Sample project — explicitly opened, never seeded.** "Explore sample project" builds a project from three short fictional demo documents (`public/samples/`). Every page of them is stamped *"Demo document — not a scientific publication"*, the numbers are invented, and nothing is attributed to any real paper, model or benchmark. The sample is a separate project marked `kind: "sample"` and labelled as such in the UI; it is never mixed into your own work, and Settings can remove it. Its fixture answers are checked against the real parsed text of those PDFs by the same verification code that live extraction uses — so even the demo cannot show a quote that isn't in its document.

**3. Live AI extraction — off until you configure it.** With a server-side key and a model, "Extract" reads your real PDFs. Without them, the app says so plainly and everything else still works.

---

## AI configuration

Set both in `.env` (or `.env.local`):

```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=<a model your account can call>
```

Model precedence: `OPENAI_MODEL`, then `OPENAI_LESSON_MODEL`, then **nothing**. There is deliberately no default: an unverified model name would misreport what produced your answers.

**Discovery needs the Responses API `web_search` tool.** OpenAI's published model page lists web search only for the GPT-6 models, but the configured `gpt-4o-mini` **does** run it on this account — verified by a live call that returned a `web_search_call` item with URL citations. If your model cannot search, discovery still works: it falls back to searching the OpenAlex index directly, and the interface says so.

The key is read on the server only. It never reaches the browser, is never written into a prompt, and is never logged.

**This sends data off the device.** The local workspace stores everything in your browser, but running research sends your question to OpenAI, and extraction sends the pages of the papers you selected. Uploading and reading PDFs, manual cells and export all still work with no key at all.

**Cost.** One discovery run is two model calls plus index lookups (a few cents on a small model). Extraction is roughly one call per cell. Each session records its own token usage.

## How discovery stays grounded

The model proposes; a scholarly index decides.

1. The request is restated as a topic and a list of constraints, shown to you as editable text.
2. The model searches the web and returns paper **titles** — not URLs, authors or years.
3. Every title is looked up in OpenAlex. **A paper that does not resolve never reaches the interface.** Authors, year, venue, DOI and the open-access PDF link all come from that record.
4. If the model finds few resolvable papers, the index itself is searched to top up.

This is not theoretical. Asked for JSON, the model returned URLs with no search citations attached, one of which was a plausible-looking arXiv id that does not exist. Resolving titles against an index is what makes a fabricated paper disappear instead of being displayed.

A search citation is evidence that a page exists. It is not evidence for any claim in the paper, and it does not mean the paper was read.

## What "read" means

Coverage is set by what was actually fetched, never by what a provider promises:

- **metadata** — only the record; nothing was read.
- **abstract** — only the abstract could be retrieved.
- **fulltext** — the PDF or the article page was fetched and parsed.

This matters for one specific honesty problem: with anything short of full text, "the paper does not report this" is unsupportable. Those cells read **Not in reviewed content**, not "Not reported". Only a full-text read can produce "Not reported".

PDFs are parsed in the browser by the same code path as an upload, so page numbering and stored bytes are identical, and the reader works offline afterwards. Article pages are split by heading, and evidence there points at a **section**, not a page. A PDF page index is not the printed page number, and the interface does not pretend otherwise.

## How an answer becomes trustworthy

The interesting part of this app is what it refuses to show.

1. **Bounded requests.** A document is split into page windows (≤8 pages / ≤12k characters, ≤4 windows per cell). No document is silently truncated at a fixed character count, and each cell records which pages it actually saw.
2. **Schema-validated output.** The model must return strict JSON: an outcome, a value, a unit, conditions, and quotes.
3. **Deterministic verification.** Every quote is located in the page text we extracted, matching through ligatures, soft hyphens, smart quotes and line wrapping, but always returning offsets into the *original* characters. A quote that cannot be found is dropped. **An answer claiming a result with no surviving quote never becomes a value** — it is reported as rejected.
4. **Nothing is "grounded" by default.** A resolvable citation proves the text exists in the document. It does **not** prove the text supports the answer. Only a human marking the cell reviewed does that, and the UI says this in as many words.
5. **Honest states.** `not found` (we read the text; it isn't there) is distinct from `unreadable` (we could not read the relevant content at all), `ambiguous` (the paper reports conflicting values), `failed`, and `stale` (the column instruction changed after this answer was produced). There are no confidence percentages, because no one can calibrate them.

**Extraction scopes:** the whole project (header "Extract"), one paper (row ⋯ → "Extract this paper"), one column (column ⋯ → "Extract this column"), or a single cell (evidence panel → "Ask AI again"). Bulk runs skip cells you have answered yourself, so they never queue a proposal over your own work.

### Comparison without false rankings

One paper is one row. If a paper reports several operating points, the cell is marked `ambiguous` and you can split it into labelled configuration rows that reuse the same document — the label is passed to the extractor so each row is answered for its own configuration. Sorting a numeric column orders values and says in its tooltip that ordering is not a scientific ranking; missing and ambiguous values sort to the end rather than behaving like zero. Conditions (dataset, split, hardware) ride along with every number instead of being flattened away. **This is not a comparability engine** — it just refuses to hide the things that make numbers incomparable.

---

## PDFs: what works and what doesn't

- Parsing is `pdf.js` in the browser: text per page, plus a box per text item, which is what makes exact highlighting possible.
- Files are validated by their **bytes** (`%PDF-`), not their extension. Limits: 10 files per batch, 20 MB per file.
- Byte-identical uploads are detected by SHA-256 and reuse the existing document instead of processing it twice.
- **Scanned PDFs**: viewable, but no text can be extracted and the app says so. OCR is not implemented.
- **Encrypted PDFs**: reported as password protected.
- **Tables and multi-column layouts** extract as text in reading order, which is unreliable for numbers laid out in a grid — treat table-derived cells with extra suspicion.
- When a quote cannot be located exactly, the panel opens the right page and labels the evidence *page-level*. No bounding box is ever invented.

---

## Your data

Everything is in IndexedDB in **this browser on this device**: projects, columns, cells, evidence, parsed pages and the original PDF bytes. Clearing site data erases it. Private windows may refuse storage entirely — the app shows a plain error rather than pretending to save.

**Backups** (Settings → Download backup) are a ZIP with `manifest.json` and `pdfs/<versionId>.pdf`. Restore validates the manifest against a schema before writing anything, caps the size, ignores any entry that isn't a manifest or a `pdfs/*.pdf` file, and only ever parses JSON. Nothing in a backup is executed.

**Exports**: the comparison table as CSV; evidence as either one-quote-per-line CSV or JSON with full context (quotes, pages, document versions, conditions, coverage, who answered, review status). All CSV fields are RFC4180-quoted and neutralised against spreadsheet formula injection (`=`, `+`, `-`, `@`, tab, CR).

---

## Architecture, briefly

```
lib/types.ts          domain entities
lib/db.ts             IndexedDB schema
lib/repo.ts           Repository interface + IndexedDB implementation  ← the persistence seam
lib/pdf/parse.ts      pdf.js parsing: page text + item boxes
lib/extract/
  plan.ts             page windows, coverage accounting
  schema.ts           zod + JSON Schema for model output
  prompt.ts           prompts; document text fenced as untrusted data
  client.ts           the OpenAI adapter (server-only)
  match.ts            normalisation and quote location
  verify.ts           deterministic verification  ← the core of the product
lib/runner.ts         job orchestration: concurrency 2, retries, cancel, resume
lib/export/           CSV, evidence JSON, ZIP backup
lib/sample/           demo documents and their fixture answers
app/api/extract       one (row, column, window) per request
app/api/ai-status     truthful configuration status, never the key
```

**Ownership boundary for later.** Local project ids are not identity and there is no fake owner id. Adding Supabase means implementing `Repository` against Postgres, adding a real `owner_id` with row-level security, and swapping the instance exported at the bottom of `lib/repo.ts`. UI components never touch storage directly — they go through `lib/workspace.tsx`, which goes through the repository. Google sign-in would be configured in the Supabase dashboard; it needs no client secret in frontend code. Empty Supabase variables are ignored today and break nothing.

**Before deploying this publicly:** `/api/extract` has no authentication, no per-user quota and no abuse controls. It is a local-development endpoint that spends the operator's own key. Public deployment needs real auth, authorization and rate limiting first.

---

## Verification status

**64 tests pass** (`npm test`), covering: quote matching through ligatures and line wrapping; rejection of fabricated and too-short quotes; page fallback when the model miscounts; every verification outcome; bounded page windows and coverage reporting; model precedence and the no-silent-default rule; request shape, schema violations, truncated responses, provider error classification and cancellation in the live adapter; CSV quoting and formula injection; backup manifest validation and ZIP entry filtering; persistence across handles; shared-source deletion semantics in both directions; project isolation; stale marking that spares user edits; runner sequencing, retry, cancellation, resume, and the no-text-layer path; a full backup round trip (project, split row, reviewed answer, evidence quote and PDF bytes all survive); that every sample fixture quote really exists in its demo PDF; that an abstract-only read is never presented as a completed full-text review; that the same DOI arriving from two URLs produces one document and one row; that discovery results are not saved twice; that evidence from a web source resolves to its section; that titles match only when they really are the same paper; and that the source fetcher refuses loopback, link-local, private and credentialed URLs.

`npm run typecheck` and `npm run build` both pass. The built app was started and checked over HTTP: the workspace route, the AI-status endpoint, the PDF worker, the sample PDFs and the extract endpoint's unconfigured response all behave correctly.

**Browser verification** (headless Chromium via Playwright, a dev dependency):

```bash
npm run build && npm start &          # or next start -p 3127
node scripts/shots.mjs http://localhost:3127   # screenshots + layout assertions
node scripts/flow.mjs  http://localhost:3127   # 12 end-to-end workflow checks
```

`shots.mjs` builds the sample project and checks four viewports (1440×900, 1920×1080, 1024×768, 390×844): it fails if the page itself scrolls horizontally, if fewer than three comparison columns are visible at 1440, if closing the evidence panel does not return width, or on any console error. `flow.mjs` creates a project, uploads a real PDF, adds a column, edits and reviews a cell, filters, exports CSV, reloads to confirm persistence, and checks the AI-off state and the sidebar preference. Both pass.

**Not verified.** **No live model call was ever made** — the adapter is exercised entirely against mocked fetch, so nothing here says anything about real extraction accuracy. That measurement is the first thing to do with a working key. Screenshots were reviewed by eye at the four viewports above, but no human has used the interface.

**Known issue:** `npm audit` reports a PostCSS advisory inside Next 15's bundled dependencies. Fixing it requires Next 16, which requires Node 20.9+, which this environment does not have.

**Why these versions:** Node 18 is the runtime available here, so Next 15 (needs 18.18+) rather than 16 (needs 20.9+), pdfjs-dist 4.8.69 (the last release supporting Node 18), and Tailwind 3 — Tailwind 4's native binary requires Node ≥ 20 and npm therefore skips it, which breaks the build outright. On Node 20+ all three can move up.

---

## Interface

Three surfaces, each with its own address:

| Route | Surface |
|---|---|
| `/` | Workspace home: write a research question, create a project, or reopen a recent one |
| `/p/<id>?tab=papers` | The papers in a project, as a reading list |
| `/p/<id>?tab=compare&cell=<row>~<col>` | The comparison table; `cell` reopens one answer's evidence |
| `/p/<id>/paper/<sourceId>?page=N` | The full-height reader, with a way back to the tab and cell you came from |
| `/library` | Every document this browser holds, and which projects use it |

The home screen's input creates a **local project** from a question. Nothing is searched, no papers are discovered, and no answers are simulated.

The project workspace has a collapsible sidebar (220px, or 56px collapsed), the tab content, and an evidence panel that is **closed until you select a cell**. Closing it gives the width back to the table — verified at 1440px, where the table grows from 764px to 1208px.

The table uses `table-layout: fixed` with an explicit `<colgroup>`. That is the load-bearing decision: without it a single long answer stretches its column and pushes every other one off screen. Columns are resizable by dragging their right edge (or with the arrow keys when focused), and widths, hidden columns, sidebar state, density and theme all persist in the preferences record.

In the table, status is a small **icon** with an accessible name and tooltip rather than a wordy pill repeated down every column; the full wording appears in the evidence panel. The states are Reviewed, Unreviewed, Ambiguous, Not reported, Unreadable, Failed and Stale. "Not reported" (the document was read; the answer is not in it) and "Unreadable" (the document could not be processed) are deliberately different states.

Actions are ranked: **Add papers** is primary in an empty project and **Extract data** once papers are in; Add column and Export are secondary; rename, settings and delete live in an overflow menu. When extraction is unconfigured the workspace shows a small "AI not connected" chip that opens Settings — the environment-variable instructions live there, not in the middle of the work surface.

## Deliberately not built

No landing page, payments, sign-in wall, literature discovery, Zotero sync, DOI/arXiv ingestion, OCR, team collaboration, public sharing, or chat-with-everything assistant. No dead buttons for any of them either — if a control is visible, it works.
