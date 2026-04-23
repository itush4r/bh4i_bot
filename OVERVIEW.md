# Project Overview — AI Assistant Telegram Bot

A detailed explanation of what this project does, how every system works, and how all the pieces fit together.

---

## What Is This?

This is a **personal AI assistant that lives inside Telegram**. You chat with it like a contact, and it can:

- Read and analyse your emails across multiple accounts and providers
- Fetch and summarise news tailored to your interests
- Send emails on your behalf
- Read, analyse, and rewrite any file you send it (PDF, DOCX, spreadsheet, image)
- Control your Android phone remotely using natural language
- Deliver a personalised morning briefing every day at 9:00 AM IST — automatically
- Answer questions about current events, weather, prices, and live data using real-time web search

The bot is not a generic chatbot. Every response is shaped by a profile the user builds during onboarding: their name, profession, city, interests, and preferred response style. The AI uses this profile to write as if it were a personal assistant who knows the user, not a generic assistant.

---

## Technology Choices

| Concern | Choice | Why |
|---------|--------|-----|
| Runtime | Next.js App Router on Vercel | Serverless, no infrastructure to manage, free tier covers hobby use |
| Database | MongoDB Atlas (Mongoose) | Flexible schema, free M0 tier, geographically distributed |
| AI model | Google Gemini 2.5 Flash | Best free-tier context window and vision support |
| Bot platform | Telegram Bot API | Webhook-based, works well with serverless |
| Email (OAuth) | Gmail API, Microsoft Graph | Official APIs, auto token refresh, no password handling |
| Email (IMAP) | imapflow + nodemailer | Works with Yahoo, iCloud, Zoho, and any standard IMAP server |
| Phone control | ADB + Express bridge | ADB is the standard Android automation tool; bridge exposes it over HTTP |
| Tunnelling | ngrok | Makes the bridge server reachable from Vercel's serverless functions |
| Encryption | Node.js built-in `crypto` | AES-256-GCM with zero new dependencies |
| File text extraction | mammoth, pdf-parse, xlsx | Best-in-class per format; mammoth preserves DOCX structure, pdf-parse handles multi-page PDFs |
| File generation | pdf-lib, docx | Pure JS, no native binary dependencies — essential for Vercel serverless |
| File storage | MongoDB GridFS | Stores binary file data inside the same MongoDB Atlas connection already in use |
| Web search | Gemini Google Search grounding | Gemini decides when to search — no intent detection code needed |

---

## Architecture Overview

The system has two separate processes:

```
┌─────────────────────────────────────────────────────┐
│                     VERCEL (cloud)                  │
│                                                     │
│  Telegram ──webhook──▶ /api/webhook/telegram        │
│                              │                      │
│                    ┌─────────┴──────────┐           │
│                    │  Command handlers  │           │
│                    └──┬──────┬──────────┘           │
│                       │      │                      │
│                  MongoDB   Gemini API               │
│                  Atlas     (AI/Vision)               │
│                       │                             │
│  Vercel Cron ──────▶ /api/cron                      │
│  (daily 9 AM IST)        │                          │
│                    Daily briefings                  │
│                    + quota reset                    │
└─────────────────────────────────────────────────────┘
                          │
                   /phone command
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│              BRIDGE SERVER (user's device)          │
│                                                     │
│  Express HTTP server  ◀──── ADB ◀──── Android phone │
│  (exposed via ngrok)                                │
└─────────────────────────────────────────────────────┘
```

### Request flow for a typical command

1. User sends a message to the Telegram bot
2. Telegram forwards it to the webhook at `/api/webhook/telegram` (POST)
3. The handler looks up the user in MongoDB
4. It checks the rate limit and quota before doing anything expensive
5. It executes the command — which may call Gemini, fetch emails, query a news API, or call the bridge server
6. The response is sent back via the Telegram API
7. MongoDB is updated (quota deducted, history saved, etc.)

The entire handler is a single serverless function that runs on Vercel. There is no persistent server process.

---

## User Data Model

Every user is a single document in MongoDB. The schema captures everything about a user in one place.

```
User document
├── Identity
│   ├── chatId          — Telegram chat ID (unique, used as primary key)
│   ├── name            — from onboarding
│   ├── profession
│   ├── city
│   ├── interests
│   └── responseStyle   — e.g. "concise and professional"
│
├── Onboarding state
│   ├── onboardingComplete
│   └── onboardingStep
│
├── Conversation history
│   └── history[]       — [{role, content, timestamp}] last N messages
│
├── Preferences
│   ├── newsCategories  — ["technology", "business", ...]
│   ├── newsCount       — total articles per fetch
│   ├── emailCount      — emails per /mails fetch
│   └── emailFocus      — ["jobs", "finance", ...] — which categories AI prioritises
│
├── Email accounts[]    — one sub-document per connected account
│   ├── provider        — "gmail" | "outlook" | "yahoo" | "icloud" | "other"
│   ├── emailAddress
│   ├── isDefault
│   ├── oauthAccessToken  (encrypted)
│   ├── oauthRefreshToken (encrypted)
│   ├── oauthTokenExpiry
│   ├── imapPassword      (encrypted)
│   ├── imapHost / imapPort
│   └── smtpHost / smtpPort
│
├── Daily briefing
│   ├── briefing.type   — "both" | "news" | "mails" | "none"
│   └── briefing.lastSentAt
│
├── Quota
│   ├── quotaLimit      — tokens allowed per day (default 10)
│   ├── quotaUsed       — tokens used today
│   ├── quotaResetDate
│   ├── quotaRequested  — pending request flag
│   └── quotaRequestNote
│
├── Rate limit
│   ├── rateLimit       — requests per minute allowed (default 5)
│   ├── rateLimitHits[] — timestamps of recent requests (sliding window)
│   ├── rateLimitRequested
│   └── rateLimitRequestNote
│
├── Pending flows
│   └── pendingDelete   — true while waiting for /deleteaccount CONFIRM
│
├── Admin controls
│   ├── status          — "active" | "warned" | "banned"
│   ├── warningMessage
│   └── isAdmin
│
├── Phone access
│   ├── phoneAccess.enabled
│   ├── phoneAccess.bridgeUrl
│   ├── phoneAccess.bridgeSecret
│   ├── phoneAccess.allowedApps[]  — packages permitted, or ["*"] for all
│   ├── phoneAccess.installedApps[] — synced from bridge
│   └── phoneAccess.lastSeen
│
└── Stats
    ├── totalMessagesEver
    ├── joinedAt
    └── lastActiveAt
```

All three credential types (OAuth access tokens, OAuth refresh tokens, IMAP passwords) are stored as AES-256-GCM ciphertext. The plaintext never touches MongoDB.

---

## Onboarding System

When a new user sends `/start`, they enter a multi-step onboarding flow managed as a state machine in the webhook handler.

**Step 0 — Name (required)**
The bot asks for the user's name. This is the only mandatory step. Until the name is given, no other commands work.

**Gateway step**
After the name, the bot presents three choices:
- "proceed" — walk through all 7 preference steps one by one
- "skip" — accept all defaults and skip directly to the main bot
- A number string like "1 3 5" — run only those specific steps

**Preference steps (all optional)**
1. Profession
2. City
3. Interests
4. Response style (e.g. "short and direct", "detailed and formal")
5. News categories
6. News article count
7. Email fetch count + focus areas

This design means a new user can be up and running in seconds (just send a name + "skip"), or can fully configure every preference in one session. All unset fields default to sensible values.

Users can type `cancel`, `stop`, `exit`, or `quit` at any point during onboarding to pause — their name is saved and they can resume later with `/start`. Every onboarding prompt (steps 2-8) includes an escape hint reminding the user they can cancel.

---

## Email System

### Supported providers

| Provider | Authentication | Notes |
|----------|---------------|-------|
| Gmail | OAuth 2.0 via Google | Requires Google Cloud Console app |
| Outlook / Hotmail | OAuth 2.0 via Azure | Requires Azure App Registration |
| Yahoo | App password (IMAP) | Not main password — a special single-app password |
| iCloud | App password (IMAP) | Generated at appleid.apple.com |
| Any other | App password (IMAP) | User provides IMAP server address manually |

### Connecting an account

For OAuth providers (Gmail, Outlook), the flow is:
1. User sends `/connectmail`
2. Bot generates an OAuth URL and sends it as a clickable link
3. User opens it in a browser, approves access, and Google/Microsoft redirects back to `/api/auth/gmail/callback` (or `/outlook/callback`)
4. The callback exchanges the auth code for tokens, fetches the user's email address from the provider's API, and saves the encrypted tokens to MongoDB
5. The bot sends a Telegram confirmation message

For IMAP providers (Yahoo, iCloud, other):
1. Bot asks for email address, then app password (not the main account password)
2. For "other" providers, also asks for the IMAP server hostname
3. The bot verifies the credentials by attempting an actual IMAP connection (`verifyImapConnection`)
4. On success, credentials are encrypted and saved; on failure, the user is told to try again

Users can type `cancel` at any step during email setup to abort — all temporary state is cleared and no account is saved. Every prompt includes an escape hint.

### Multiple accounts

Users can connect as many accounts as they want, across different providers. One account is marked as the default. `/mails` uses the default unless a specific address is passed: `/mails work@company.com`.

### Fetching emails

`fetchEmails(account, chatId, count)` is a router that dispatches to the right provider implementation:

**Gmail:** Uses the Gmail REST API (`messages.list` + `messages.get` with `format: "full"`). Extracts the `text/plain` part from the MIME tree for a clean body. Handles token auto-refresh via the `tokens` event on the OAuth2 client — when Google issues a new access token, it is immediately encrypted and saved back to MongoDB.

**Outlook:** Uses Microsoft Graph API. Before every call, checks whether the access token expires within 5 minutes; if so, uses the refresh token to get a new one, encrypts and saves it, then proceeds. Strips HTML from the body preview.

**IMAP:** Uses `imapflow` to connect directly to the provider's IMAP server. Fetches recent messages including up to 5000 bytes of raw source, then extracts the body from after the CRLF header separator.

All three return the same shape: `{ subject, from, sender, date, preview, body }`.

### AI email analysis

After fetching, emails are passed to `analyzeEmails()` in `ai.js`. This builds a structured prompt that:
- Lists every email with sender, subject, and preview
- Tells Gemini to categorise them into sections (jobs, finance, newsletters, promotions, social, updates, others) — or just the sections the user cares about
- Contains strict rules: only use the emails in the list, never invent content, never use placeholder names

The result is a formatted categorised summary sent to the user's Telegram chat.

### Reading a full email

`/mails` stores the fetched emails in an in-memory `Map` keyed by `chatId`. `/readmail 3` looks up email #3 from that cache and returns the full body. This means re-reading emails is free (no Gemini call, no network fetch).

---

## News System

News is fetched from [NewsAPI.org](https://newsapi.org). The user configures which categories they want (technology, business, sports, health, science, entertainment, general) and how many total articles.

`getTopNews(categories, count)` distributes the article count evenly across categories, fetches them in parallel, and returns a flat deduplicated list.

The result is passed to `generateSummary()`, which builds a prompt asking Gemini to write concise bullet points — only from the articles provided, no invented content.

If Gemini is unreachable, a plain-text fallback (`formatNewsWithoutAI`) formats the raw article titles and sources without AI.

---

## Daily Briefing System

A Vercel Cron Job runs once daily at **3:30 UTC (9:00 AM IST)**. It calls `/api/cron`, which:

1. Runs `runDailySummary()` — sends personalised briefings to all eligible users
2. Resets `quotaUsed` to 0 for all users

### Per-user briefing logic

`runDailySummary()` finds all users where `onboardingComplete: true` and `briefing.type != "none"`. For each user:

1. Checks `briefing.type` — determines whether to fetch news, emails, or both
2. Fetches emails across all connected accounts, then deduplicates by sender+subject (same email from two accounts counts once)
3. Fetches news from the user's preferred categories
4. Skips the user entirely if both fetches return empty
5. Calls `generateSummary` (news) and `analyzeEmails` (email) separately, labels the sections
6. Sends the combined briefing as a single Telegram message
7. Records `briefing.lastSentAt` and deducts 3 tokens from quota

All users run in parallel (`Promise.allSettled`), so one user's failure does not delay or block others.

### Why only 9 AM IST (fixed)

Vercel's Hobby plan allows exactly one cron job, and that job can only run once per day. Per-user configurable times would require either multiple cron jobs (not available) or a polling approach (wastes serverless invocations). The fixed 9 AM IST time is a deliberate tradeoff to stay within the free plan.

---

## Web Search (Gemini Google Grounding)

Chat responses use a Gemini model with Google Search grounding enabled (`useSearchGrounding: true`). When a user asks something that requires current information, Gemini automatically issues a search query and incorporates the results — no intent detection, no routing logic.

```
User: "What's the weather in Mumbai?"
  → Gemini detects it needs current data
  → Issues a Google Search internally
  → Returns an answer grounded in real results
```

Questions that trigger automatic search:
- Weather, current temperature, forecasts
- Live sports scores and recent match results
- Current exchange rates and stock prices
- Recent news events ("What happened in tech this week?")
- Product prices, availability, release dates

Questions that don't search (answered from training data):
- General knowledge, history, concepts
- Code help, writing, analysis
- Anything already in the conversation or active files

The search model is only used for chat responses. News briefings and email analysis use the standard model (no search, prompt-only).

---

## File System

### What users can do with files

1. Send any supported file in Telegram chat
2. Bot reads it, extracts text, sends AI feedback — instantly
3. Files are stored (text in MongoDB, binary in GridFS)
4. Mark files as "active" to include them in every chat message's context
5. Ask the bot to rewrite a section via chat ("rewrite my summary section to be more concise")
6. `/download <name>` to receive the updated file back in its original format

### Supported types and extraction method

| Type | Extension(s) | How text is extracted |
|------|--------------|-----------------------|
| PDF | .pdf | `pdf-parse` — handles multi-page, text-based PDFs |
| Word | .docx, .doc | `mammoth` — extracts raw text preserving structure |
| Plain text | .txt, .md | Buffer decoded as UTF-8 |
| Spreadsheet | .csv | `xlsx` — converted to CSV string |
| Excel | .xlsx, .xls | `xlsx` — all sheets converted to CSV, labelled by sheet name |
| Image | .jpg, .png, .webp | Passed as base64 directly to Gemini Vision |

Scanned PDFs (image-only, no text layer) and password-protected files return a friendly error — no crash.

### Upload pipeline (`fileHandler.js`)

```
User sends file in Telegram
      │
      ▼
Telegram sends webhook with message.document or message.photo
      │
      ▼
route.js detects fileObj (before text check)
      │
      ├── Quota check (3 tokens)
      │
      ├── GET /getFile → Telegram API → download URL
      │
      ├── Fetch file as Buffer
      │
      ├── extractTextFromFile(buffer, fileType)
      │       ├── PDF → pdf-parse
      │       ├── DOCX → mammoth
      │       ├── TXT → buffer.toString()
      │       ├── CSV/XLSX → xlsx
      │       └── image → "[IMAGE_FILE:<base64>]"
      │
      ├── storeFileGridFS(buffer, fileName, chatId)  → GridFS ObjectId
      │
      ├── analyseFile(text, fileName, fileType, user) → Gemini Flash
      │       ├── Images: Gemini Vision multi-modal call
      │       └── Text: prompt with STRICT RULES, 400-word max
      │
      ├── User.updateOne $push files[] ($slice: -10)
      │
      ├── deductQuota(user, "file")
      │
      └── sendTelegramMessage(summary + feedback)
```

### File storage

**Text** is stored in `user.files[].extractedText` (capped at 50,000 characters). This is what gets injected into chat context and used to generate updated files.

**Binary** (the original uploaded bytes) is stored in MongoDB GridFS under the `userfiles` bucket. GridFS splits large files into 255KB chunks automatically. The ObjectId is saved in `user.files[].gridfsId`.

### File context in chat

When a user sends a chat message, up to 5 active files (marked `isActive: true`) are injected into the system prompt:

```
## Files the user has shared:
File: resume.pdf
Summary: 2-page CV for a software engineer with 5 years experience
Content:
John Smith
Software Engineer...
```

Gemini reads this as part of the system context and references the files naturally when relevant — without the user having to quote from them.

### Downloading an updated file (`/download`)

`/download resume.pdf` triggers:
1. Fetch original bytes from GridFS
2. `generateUpdatedFile(originalBuffer, extractedText, fileName, fileType)`
   - **PDF**: loads original with `pdf-lib`, appends a new "Updated Content" page
   - **DOCX**: generates a fresh `.docx` with `docx` package
   - **TXT/CSV**: returns text as UTF-8 buffer
3. `sendTelegramFile(buffer, fileName, chatId)` — uses Telegram's `sendDocument` endpoint with multipart form upload
4. Deducts 2 tokens

---

## Android Phone Control

This is the most complex feature. It lets the user control their Android phone through Telegram using plain English.

### Two-part architecture

**Bridge server** — a small Express app that runs on the user's device (phone via Termux, or a PC with the phone connected via USB). It:
- Receives HTTP requests authenticated by a shared secret (`x-bridge-secret` header)
- Executes ADB commands (`adb shell`, `adb exec-out`)
- Returns screenshots as base64 PNG, app lists, and action results

**Phone agent** (`phoneAgent.js`) — runs in the Vercel serverless function. It:
- Communicates with the bridge server over HTTPS (via ngrok tunnel)
- Runs a ReAct (Reason + Act) loop powered by Gemini Vision

### ReAct agent loop

When the user sends `/phone Open WhatsApp and send hello to Mom`:

```
Loop (max 20 steps):
  1. Take screenshot  ──▶ bridge /screenshot
  2. Ask Gemini Vision:
       "Here is the current screen. The task is: Open WhatsApp and send hello to Mom.
        Previous steps: [...]
        What should I do next?"
  3. Gemini returns structured JSON:
       { action: "launch", params: { package: "com.whatsapp" },
         reasoning: "WhatsApp is not open, launching it",
         isDone: false }
  4. Check permissions — is this app in allowedApps?
  5. Execute action  ──▶ bridge /execute
  6. Wait 1.5s for screen to settle
  7. Send progress update to Telegram every 3 steps
  8. If isDone=true → report result and exit
```

Gemini's output is validated with a Zod schema — it must produce a structured object with specific fields, not free text. This makes the loop reliable.

### Available actions the agent can take

| Action | What it does |
|--------|-------------|
| `tap { x, y }` | Touch at exact pixel coordinates |
| `type { text }` | Type text into the focused field |
| `swipe { x1, y1, x2, y2, duration }` | Swipe gesture |
| `launch { package }` | Open an app by Android package name |
| `back {}` | Press the back button |
| `home {}` | Press the home button |
| `scroll { direction }` | Scroll up, down, left, or right |

### App permissions

The user controls which apps the agent can interact with:
- `allowedApps: ["*"]` — agent can use any app (default)
- `allowedApps: ["com.whatsapp", "com.android.chrome"]` — only those apps

If the agent tries to `launch` a blocked app, the task stops immediately with a permission error. The user can manage this with `/apps` and `/phoneaccess`.

### Safety limits

- Maximum 20 steps per task — prevents runaway loops
- 1.5 second pause between steps — gives the screen time to load
- Bridge disconnection during a task causes an immediate abort
- All bridge calls require the secret header — the server rejects anything without it

---

## AI Personalisation

Every AI response is shaped by the user's profile via `persona.js`.

### Chat responses

The system prompt sent to Gemini for chat looks like:

```
You are [Name]'s personal AI assistant on Telegram.

About [Name]:
- Profession: Software Engineer
- Based in: Mumbai (IST, UTC+5:30)
- Interests: cricket, startups, finance
- Preferred response style: concise and direct

Rules:
- Match their preferred style: concise and direct
- Use Telegram markdown
- Never say "As an AI..."
- Be direct, skip the preamble
- Current date: 4 April 2026 IST
```

### Briefing context

A lighter version is injected into news and email prompts:

```
Personalise this briefing for [Name],
a Software Engineer based in Mumbai
who cares about: cricket, startups, finance.
```

This causes Gemini to highlight tech startup news over celebrity news, for example, even when fetching from "general" category.

### Fallback model

All AI calls go through `generateTextWithFallback()`:
1. Try Gemini 2.5 Flash (most capable, higher rate limit)
2. If that fails, retry with Gemini 2.5 Flash Lite (smaller, less likely to be rate-limited)

If both fail, news/email functions fall back to plain-text formatting (no AI summary — just raw titles and subjects).

---

## Token Quota System

Protects the Gemini free tier from being exhausted by any single user or by abuse.

### How it works

Every user has a `quotaLimit` (default: 10 tokens/day) and a `quotaUsed` counter. Before any AI-involving action:

1. `checkQuota(user, action)` is called
2. If the user is banned → block with message
3. If the current calendar day (IST) differs from `quotaResetDate` → reset `quotaUsed` to 0
4. Calculate cost vs. remaining
5. If insufficient → block and suggest `/requestquota`
6. If within 3 tokens of exhaustion → allow but append a warning to the response

After a successful action, `deductQuota(user, action)` increments `quotaUsed`.

The admin (identified by `ADMIN_CHAT_ID`) bypasses all quota and rate limit checks entirely.

### Token costs

| Action | Cost | Reason |
|--------|------|--------|
| Chat message | 1 | Uses Flash-Lite |
| `/news` | 3 | Flash, moderate prompt |
| `/mails` | 3 | Flash, longer output |
| `/readmail` | 0 | No AI — reads from cache |
| `/send` | 1 | No AI — just SMTP |
| File upload | 3 | Flash (text analysis) or Flash Vision (images) |
| `/download` | 2 | No AI — generates file from saved text |
| `/phone` task | 5 | Flash Vision, multi-step |
| Daily cron briefing | 3 | Flash, runs automatically |

### Quota request flow

When a user hits their limit, they can send `/requestquota I need more for work emails`. This sets `quotaRequested: true` and `quotaRequestNote` in their document and sends an alert to the admin's Telegram. The admin can then run `/setquota <chatId> 30` to raise their limit, or `/denyquota <chatId>` to reject the request.

---

## Rate Limiting

Separate from the token quota. Prevents users from spamming the bot faster than the system can handle.

Each user has a `rateLimit` (default: 5 requests/minute). The implementation uses a sliding window:

1. All request timestamps from the last 60 seconds are loaded from `rateLimitHits`
2. If the count is at or above the limit → block, tell the user how many seconds to wait
3. Otherwise → append the current timestamp and save

Because `rateLimitHits` is stored in MongoDB, it works correctly across Vercel's multiple serverless instances. There is no shared in-process state.

The rate limit request flow mirrors the quota request flow: users can request a higher limit, admin can approve or deny.

---

## Credential Encryption

All credentials stored in MongoDB are encrypted using **AES-256-GCM** — a modern authenticated encryption scheme that provides both confidentiality and tamper detection.

### Encryption details

- **Algorithm:** AES-256-GCM
- **Key:** 32 random bytes (256 bits), stored as a 64-character hex string in `ENCRYPTION_KEY` env var
- **IV:** 12 random bytes (96 bits), generated fresh for every encryption operation
- **Auth tag:** 16 bytes, produced by GCM mode — detects any tampering with the ciphertext
- **Storage format:** `<iv_hex>:<authtag_hex>:<ciphertext_hex>` (colon-delimited, all hex)
- **Dependencies:** Node.js built-in `crypto` module — zero new packages

### What is encrypted

| Field | Where |
|-------|-------|
| `oauthAccessToken` | Gmail, Outlook — written at OAuth callback, re-written on refresh |
| `oauthRefreshToken` | Gmail, Outlook — written at OAuth callback, re-written on refresh |
| `imapPassword` | Yahoo, iCloud, other — written at IMAP setup step 3 |

### How encrypt/decrypt flows through the code

**On save (OAuth callbacks):**
```
tokens.access_token  ──encrypt()──▶  stored in MongoDB
tokens.refresh_token ──encrypt()──▶  stored in MongoDB
```

**On read (emailClient.js):**
```
account.oauthAccessToken  ──decrypt()──▶  passed to oauth2Client.setCredentials()
account.oauthRefreshToken ──decrypt()──▶  passed to oauth2Client.setCredentials()
account.imapPassword      ──decrypt()──▶  passed to ImapFlow / nodemailer
```

**On token refresh (automatic):**
When Google or Microsoft issues a new access token, `emailClient.js` immediately `encrypt()`s it before writing it back to MongoDB.

### Legacy handling

`decrypt()` handles pre-encryption data gracefully: if the value does not contain exactly two colons (the encrypted format), it is returned as-is. This means the migration script is the only time a plaintext value will ever pass through decrypt — afterwards everything is ciphertext.

---

## Admin System

The admin is identified solely by `ADMIN_CHAT_ID` (a Telegram chat ID in the environment variables). The admin gets:

### Telegram commands

All admin commands are handled in `adminCommands.js`. They only work when the sender's `chatId` matches `ADMIN_CHAT_ID`.

- **User management:** `/users`, `/userinfo <chatId>`, `/stats`
- **Quota:** `/setquota`, `/resetquota`, `/denyquota`
- **Moderation:** `/ban`, `/unban`, `/warn`
- **Rate limit:** `/setlimit`, `/denylimit`
- **Phone:** `/phoneusers`, `/disablephone`

### Web dashboard

`/admin` is a password-protected Next.js page (HTTP basic auth via `ADMIN_USERNAME` and `ADMIN_SECRET`). Auth is enforced in `src/app/admin/layout.js` (a Next.js Server Component that reads the `Authorization` header) and in the API routes via `requireBasicAuth()`.

The dashboard shows:
- Summary stats (total users, active, banned, email-connected, pending quota requests)
- A searchable table of all users
- Inline editing of each user's quota limit and status

---

## Health Check

`GET /api/health` runs two checks and returns their results:

```json
{
  "database": "ok",
  "encryption": "ok"
}
```

- **database** — attempts `dbConnect()` and reports success or failure
- **encryption** — runs a full encrypt → decrypt round trip on a known string and verifies the output matches

Returns HTTP 200 if both pass, HTTP 500 if either fails. Useful as a deployment sanity check and as a Vercel uptime monitor target.

---

## Cron Infrastructure

`vercel.json` configures one cron job (the maximum on Vercel Hobby):

```json
{ "path": "/api/cron", "schedule": "30 3 * * *" }
```

3:30 UTC = 9:00 AM IST. The endpoint is protected by a `CRON_SECRET` bearer token checked in the handler before any work begins. Vercel passes this automatically via the `Authorization` header.

The handler does two things in sequence:
1. Calls `runDailySummary()` — see the Daily Briefing section above
2. Calls `User.updateMany({}, { $set: { quotaUsed: 0, quotaResetDate: new Date(), quotaRequested: false } })` — resets all users' token usage for the new day

Two independent jobs merged into one endpoint to comply with the one-cron limit.

---

## Data Flow Diagrams

### /mails command

```
User: /mails
    │
    ▼
Webhook handler
    │
    ├── Rate limit check  (MongoDB)
    ├── Quota check       (MongoDB, costs 3)
    │
    ├── Load user.emailAccounts (default account)
    │        │
    │        ├── Gmail?   ──▶ Gmail API (OAuth, decrypt tokens)
    │        ├── Outlook? ──▶ Graph API (OAuth, decrypt tokens, maybe refresh)
    │        └── IMAP?    ──▶ imapflow (decrypt password)
    │
    ├── Store in emailCache[chatId]  (in-memory Map)
    │
    ├── analyzeEmails()  ──▶ Gemini Flash
    │
    ├── Deduct 3 tokens
    │
    └── sendTelegramMessage(result)
```

### /phone task

```
User: /phone Open WhatsApp and send hello to Mom
    │
    ▼
Webhook handler
    │
    ├── Rate limit check
    ├── Quota check (costs 5)
    ├── checkBridgeHealth(bridgeUrl)
    │
    └── runPhoneTask()
            │
            Loop (max 20 steps):
            │
            ├── GET /screenshot ──▶ bridge ──▶ ADB screencap
            │
            ├── askGemini(screenshot, task, history)
            │       └── Gemini Vision ──▶ {action, params, reasoning, isDone}
            │
            ├── Permission check (allowedApps)
            │
            ├── POST /execute ──▶ bridge ──▶ ADB shell command
            │
            ├── Progress update to Telegram (every 3 steps)
            │
            └── Wait 1500ms
```

### Daily briefing (cron)

```
Vercel Cron (3:30 UTC)
    │
    ▼
GET /api/cron
    │
    ├── Auth: CRON_SECRET check
    │
    ├── runDailySummary()
    │       │
    │       ├── Find users: onboardingComplete=true, briefing.type≠"none"
    │       │
    │       └── For each user (parallel):
    │               │
    │               ├── briefing.type="news"  → getTopNews()
    │               ├── briefing.type="mails" → fetchEmails() (all accounts, deduplicated)
    │               ├── briefing.type="both"  → both
    │               │
    │               ├── generateSummary() / analyzeEmails()  ──▶ Gemini
    │               │
    │               ├── sendTelegramMessage(briefing)
    │               ├── Update briefing.lastSentAt
    │               └── Deduct 3 tokens
    │
    └── User.updateMany({ $set: { quotaUsed: 0 } })
```

---

## Conversation History

Every message the user sends and every assistant reply is appended to `user.history` in MongoDB. The last N messages are passed as the `messages` array to Gemini for each chat response — this gives the AI short-term memory of the conversation.

History is reset to empty with `/reset`. Because history is per-user in MongoDB, it persists across multiple serverless function invocations (Vercel spins up a new function instance for each request, so in-memory state does not persist).

---

## What Happens on First Message

1. Webhook receives the message, looks up `chatId` in MongoDB
2. No user found → `User.create({ chatId })` creates a new document with all defaults
3. Bot replies with a welcome message and asks for the user's name
4. All subsequent messages go through the onboarding state machine until `onboardingComplete: true`
5. After that, the user can use all commands

---

## What Happens When an Email Token Expires

**Gmail:**
The `google-auth-library` handles refresh automatically. When the access token has expired and an API call is made, the library uses the refresh token to get a new access token silently. It fires a `tokens` event with the new token. The event listener in `fetchEmailsGmail` catches this and writes `encrypt(tokens.access_token)` back to MongoDB.

**Outlook:**
`refreshOutlookToken()` is called before every Outlook API call. It compares `oauthTokenExpiry` against the current time plus a 5-minute buffer. If the token is stale or about to expire, it posts to Microsoft's token endpoint with `decrypt(account.oauthRefreshToken)`, gets a fresh access token, and saves `encrypt(newToken)` before returning the plaintext token for immediate use.

---

## UX Safeguards

### Universal cancel/escape

Any multi-step flow (onboarding, email setup, account deletion) can be cancelled by typing `cancel`, `stop`, `exit`, `quit`, or `/cancel`. The escape check runs immediately after the user is loaded from MongoDB, before any command handler — so it works regardless of which step the user is on.

Each flow has a context-specific cancellation message (defined in `flowUtils.js`):
- **Onboarding** — resets `onboardingStep` to 0, clears the picked-steps map, keeps the user's name
- **Email setup** — clears all `emailSetup*` temporary fields, no account saved
- **Account deletion** — clears `pendingDelete`, reassures the user their data is safe

Every mid-flow prompt includes a hint: _Type `cancel` anytime to stop._

### Command typo correction

If a user types an unrecognised slash-command, the bot checks a typo map before falling through to the "unknown command" message. Common corrections:

| What user typed | Suggestion |
|----------------|------------|
| `/mail`, `/email`, `/emails` | `/mails` |
| `/prefs` | `/preferences` |
| `/brief` | `/briefing` |
| `/delete` | `/deleteaccount` |
| `/connect` | `/connectmail` |
| `/disconnect` | `/disconnectmail` |
| `/file` | `/files` |
| `/read 3` | `/readmail 3` |
| `/pref newscount \| 15` | `/setpref newscount \| 15` |
| `/profile name \| Alice` | `/setprofile name \| Alice` |

Prefix-based typos (like `/read 3`) carry the arguments through to the suggestion. Completely unknown `/commands` get an "Unknown command, type /help" response instead of being treated as chat.

### AI response rules

The system prompt (`persona.js`) enforces two rules:
1. **Always end with a next action** — every explanation must show the exact command to type next, in backticks. No vague "you can use the command" without showing it.
2. **Casual messages get casual replies** — greetings, acknowledgements, and short messages get a brief natural response without command suggestions.

---

## File-by-File Reference

| File | Purpose |
|------|---------|
| `src/app/api/webhook/telegram/route.js` | Main command dispatcher — all bot logic starts here |
| `src/app/api/auth/gmail/callback/route.js` | Gmail OAuth exchange — receives code, saves encrypted tokens |
| `src/app/api/auth/outlook/callback/route.js` | Outlook OAuth exchange |
| `src/app/api/cron/route.js` | Daily briefings + quota reset |
| `src/app/api/health/route.js` | DB + encryption health check |
| `src/app/admin/layout.js` | Basic auth protection for /admin pages |
| `src/app/admin/page.js` | Web admin dashboard UI |
| `src/app/api/admin/users/route.js` | GET all users (admin API) |
| `src/app/api/admin/users/[chatId]/route.js` | PATCH user quota/status (admin API) |
| `src/jobs/dailySummary.js` | Per-user briefing pipeline |
| `src/lib/ai.js` | Gemini wrappers: chat, news summary, email analysis |
| `src/lib/adminCommands.js` | Admin-only Telegram command handlers |
| `src/lib/basicAuth.js` | Shared HTTP basic auth helper for admin routes |
| `src/lib/db.js` | MongoDB connection (cached across invocations) |
| `src/lib/emailClient.js` | Universal fetch/send router for all email providers |
| `src/lib/emailProviders.js` | IMAP/SMTP host/port defaults per provider |
| `src/lib/emailSetup.js` | Multi-step IMAP onboarding state machine |
| `src/lib/encryption.js` | AES-256-GCM encrypt / decrypt / isEncrypted |
| `src/lib/fileExtractor.js` | Extract readable text from PDF, DOCX, TXT, CSV, XLSX, image |
| `src/lib/fileGenerator.js` | Generate updated PDF, DOCX, or plain text buffers |
| `src/lib/fileHandler.js` | Full upload pipeline: download → extract → analyse → store |
| `src/lib/gridfs.js` | MongoDB GridFS store / get / delete for original file binaries |
| `src/lib/logger.js` | Summary logger (records briefing outcomes) |
| `src/lib/news.js` | NewsAPI wrapper |
| `src/lib/flowUtils.js` | Escape/cancel detection + context-specific cancel messages |
| `src/lib/persona.js` | AI system prompt and briefing context builders |
| `src/lib/phoneAgent.js` | ReAct agent loop for Android phone control |
| `src/lib/quota.js` | Token quota check and deduction |
| `src/lib/rateLimit.js` | Per-user sliding window rate limiter |
| `src/lib/telegram.js` | Telegram message sender (auto-splits at 4096 chars) |
| `src/models/User.js` | Mongoose schema for the user document |
| `scripts/migrateEncryption.js` | One-time script to encrypt existing plain-text credentials |
| `bridge/src/index.js` | Express bridge server with auth middleware |
| `bridge/src/adb.js` | ADB shell/raw command wrappers |
| `bridge/src/apps.js` | Installed app list from device |
| `bridge/src/executor.js` | Action executor (tap, type, swipe, etc.) |
| `bridge/src/screen.js` | Screenshot capture → base64 PNG |
| `bridge/src/tunnel.js` | ngrok tunnel + auto-register with bot |
