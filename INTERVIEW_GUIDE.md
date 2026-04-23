# Interview Preparation Guide — AI Assistant Telegram Bot

Everything you need to confidently explain this project in any interview — from a 30-second elevator pitch to deep technical questions.

---

## 1. The Elevator Pitch (30 seconds)

> "I built a personal AI assistant that lives inside Telegram. You chat with it like a friend, and it can read and analyse your emails across Gmail, Outlook, Yahoo, and iCloud, fetch personalised news, send emails, control your Android phone with plain English commands, and even read any file you upload — PDFs, spreadsheets, images. Everything is personalised: it knows your name, profession, interests, and how you like information delivered. It runs on Vercel's free tier using Next.js serverless functions, MongoDB Atlas, and Google Gemini for AI. The whole thing costs $0/month to run."

---

## 2. The 2-Minute Walkthrough

> "The bot has a webhook endpoint on Vercel. When someone messages the Telegram bot, Telegram forwards it to my API. The handler identifies the user in MongoDB, checks rate limits and token quota, then executes the command.
>
> For emails, I built a universal email client that handles Gmail and Outlook via OAuth, and Yahoo/iCloud/others via IMAP — all behind a single interface. Tokens are encrypted at rest using AES-256-GCM.
>
> For phone control, there's a separate bridge server that runs on the user's Android phone via Termux. It exposes ADB over HTTP, secured by a shared secret. When a user says 'open WhatsApp and message Mom', I run a ReAct agent loop — take a screenshot, ask Gemini Vision what to do next, execute the action, repeat — up to 20 steps.
>
> Chat responses use Gemini with Google Search grounding, so the model automatically searches Google when it needs current data — weather, prices, live scores — without me writing any intent detection.
>
> There's a per-user daily token quota system, rate limiting, an admin dashboard, and a daily cron that sends personalised briefings at 9 AM IST."

---

## 3. Architecture — What to Say

### "Walk me through the architecture"

```
Telegram --> Vercel serverless function --> MongoDB Atlas
                    |                           |
                    +-- Google Gemini API        |
                    +-- NewsAPI                  |
                    +-- Email providers          |
                    +-- Bridge server (phone)    |
                                                |
Vercel Cron (daily) --> /api/cron --> briefings + quota reset
```

**Key points to hit:**
- **Fully serverless** — no persistent server, no infrastructure to manage
- **Single webhook endpoint** — one function handles all commands via a command dispatcher pattern
- **MongoDB for everything** — user profiles, history, quota, rate limits, file metadata, GridFS for binary files
- **Two separate processes** — cloud (Vercel) and local (bridge server on phone/PC)
- **Stateless** — each request loads user from DB, processes, saves back. No in-memory state except email cache for `/readmail`

### "Why these technology choices?"

| Decision | Why |
|----------|-----|
| **Next.js on Vercel** | Serverless = zero ops. Free Hobby tier handles the traffic. App Router gives me API routes without Express. |
| **MongoDB Atlas** | Flexible schema (user profiles evolve fast). Free M0 tier. No migration headaches — I just add fields with defaults. |
| **Google Gemini** | Best free-tier AI — long context window, vision support, Google Search grounding built in. The Vercel AI SDK makes switching models trivial. |
| **Telegram** | Webhook-based (perfect for serverless). Rich formatting. File upload/download built in. Users don't need to install anything new. |
| **AES-256-GCM** | Authenticated encryption — provides both confidentiality and tamper detection. Node.js built-in `crypto`, zero new dependencies. |

### "Why not use Express? Why not use a traditional server?"

> "The entire bot runs on Vercel's free Hobby plan. Express would need a persistent server — that means paying for hosting, managing uptime, handling restarts. With Next.js API routes, each request spins up a function, handles it, and dies. I pay nothing, and Vercel handles scaling. The tradeoff is a 25-second function timeout — which I handle with `Promise.race` timeout wrappers."

---

## 4. Deep Dives — System by System

### 4.1 Email System

**"How does the multi-provider email system work?"**

> "I built a universal email client with a router pattern. `fetchEmails(account)` checks the provider field and dispatches to the right implementation — Gmail uses the REST API with OAuth, Outlook uses Microsoft Graph with OAuth, and Yahoo/iCloud/others use IMAP via the `imapflow` library. All three return the same shape: `{ subject, from, date, body }`."

**"How do you handle OAuth token refresh?"**

> "Gmail and Outlook refresh differently. For Gmail, Google's `google-auth-library` handles refresh automatically — when a token expires mid-call, it refreshes silently and fires a `tokens` event. I listen for that event and immediately encrypt and save the new token to MongoDB:
>
> ```js
> oauth2Client.on('tokens', async (tokens) => {
>   await User.updateOne(
>     { chatId },
>     { $set: { 'emailAccounts.$[acct].oauthAccessToken': encrypt(tokens.access_token) } },
>     { arrayFilters: [{ 'acct._id': account._id }] }
>   );
> });
> ```
>
> For Outlook, I check manually before every API call — if the token expires within 5 minutes, I POST to Microsoft's token endpoint with the refresh token, get a new access token, encrypt it, save it, then proceed. The key difference is Google auto-refreshes, Microsoft doesn't."

**"Why not just use IMAP for everything?"**

> "OAuth is more secure — users never give me their password. Gmail and Outlook both require OAuth for third-party access now. IMAP is only used for providers that don't offer OAuth — Yahoo, iCloud, Zoho. Even then, I use app-specific passwords, not the user's main password."

**"How do you handle email deduplication in daily briefings?"**

> "When a user has multiple accounts, the same email could appear in two inboxes. I fetch from all accounts in parallel using `Promise.allSettled` (so one failure doesn't block others), then deduplicate using a Set with composite keys: `sender.toLowerCase() + '::' + subject.toLowerCase()`. First occurrence wins."

---

### 4.2 AI Integration

**"How does the AI work?"**

> "I use Google Gemini via the Vercel AI SDK (`@ai-sdk/google`). I have three model instances:
>
> 1. `gemini-2.5-flash` — main model for email analysis, news summaries, file analysis
> 2. `gemini-2.5-flash-lite` — lighter fallback if Flash is rate-limited
> 3. `gemini-2.5-flash` with `useSearchGrounding: true` — for chat, automatically searches Google when needed
>
> The fallback chain is: Flash -> Flash-Lite -> plain text formatting. If both AI calls fail, news/email functions fall back to raw formatting without AI."

**"How does web search grounding work?"**

> "When I initialise the chat model, I pass `useSearchGrounding: true`. Gemini internally decides whether a question needs current data. If someone asks 'what's the weather in Mumbai?', Gemini issues a Google Search behind the scenes and grounds its response in the search results. I don't write any intent detection — the model handles it. This only applies to chat, not to news summaries or email analysis."

**"How is the AI personalised?"**

> "Every AI call includes a system prompt built from the user's profile — their name, profession, city, interests, and preferred response style. So a finance professional in Mumbai asking about news gets different emphasis than a student in Delhi. The system prompt also enforces rules: use Telegram markdown, never say 'As an AI', always end with the exact command to type next."

---

### 4.3 Phone Control (ReAct Agent)

**"This is the most unique feature — explain how it works"**

> "It's a ReAct (Reason + Act) agent loop. The architecture has two parts:
>
> 1. **Bridge server** — a small Express app running on the user's phone (via Termux) or a PC with the phone connected via USB. It exposes ADB commands over HTTP, authenticated by a shared secret header.
>
> 2. **Agent loop** — runs in the Vercel serverless function. For up to 20 steps:
>    - Capture a screenshot from the bridge
>    - Send it to Gemini Vision with the task and step history
>    - Gemini returns structured JSON (validated by Zod schema): `{ action, params, reasoning, isDone }`
>    - Check app permissions
>    - Execute the action via the bridge (tap, type, swipe, launch, back, home, scroll)
>    - Wait 1.5 seconds for the screen to settle
>    - Send progress updates to Telegram every 3 steps
>    - Repeat until `isDone: true` or max steps reached"

**"Why use Zod schema validation?"**

> "Gemini's output is non-deterministic. Without a schema, it might return free-form text instead of the structured action I need. Zod forces Gemini to produce exact fields — `action`, `params`, `reasoning`, `isDone`. If the output doesn't match the schema, `generateObject()` from the Vercel AI SDK throws an error. This makes the loop reliable — I always get valid, parseable actions."

**"How is the bridge secured?"**

> "Every endpoint except `/health` requires an `x-bridge-secret` header matching the shared secret. The bridge URL is only stored in the user's MongoDB document. The bridge runs behind ngrok, so the URL changes on restart. The user explicitly connects it with `/connectphone <url> <secret>` — I verify connectivity with a health check before saving."

---

### 4.4 Encryption

**"How do you protect stored credentials?"**

> "All OAuth tokens and IMAP passwords are encrypted at rest using AES-256-GCM. The encryption key is a 32-byte random hex string stored as an environment variable — never in the codebase.
>
> The format is `iv:authTag:ciphertext`, all hex-encoded. Each encryption uses a fresh random 12-byte IV, so the same plaintext produces different ciphertext every time. The GCM auth tag provides tamper detection — if anyone modifies the ciphertext in the database, decryption fails.
>
> Plaintext credentials never touch MongoDB. They only exist in memory during API calls."

**"What's the difference between AES-GCM and AES-CBC?"**

> "GCM is an authenticated encryption mode — it provides both confidentiality AND integrity. If someone tampers with the ciphertext, GCM detects it and refuses to decrypt. CBC only provides confidentiality — you'd need to add HMAC separately for integrity. GCM is also faster because it can be parallelised."

**"How did you handle migrating existing unencrypted data?"**

> "I wrote a one-time migration script (`scripts/migrateEncryption.js`). It finds all users with unencrypted credentials using an `isEncrypted()` check — which just looks for the `iv:authTag:ciphertext` colon format. For each unencrypted value, it encrypts and saves it. The script is safe to re-run because it skips already-encrypted values."

---

### 4.5 Quota and Rate Limiting

**"How does the token quota system work?"**

> "Every user has a daily token limit (default: 10). Each action costs a fixed number of tokens — chat costs 1, news costs 3, phone tasks cost 5. Before any expensive action, `checkQuota()` compares the cost against remaining tokens.
>
> The interesting part is the IST-aware date comparison for daily reset:
>
> ```js
> const istOffset = 5.5 * 60 * 60 * 1000;
> const nowIST = new Date(now.getTime() + istOffset);
> const resetIST = new Date(lastReset.getTime() + istOffset);
> if (nowIST.toDateString() !== resetIST.toDateString()) {
>   // New day in IST — reset quota
> }
> ```
>
> I compare date strings, not timestamps — this correctly handles the midnight boundary regardless of the server's timezone (Vercel servers are in various AWS regions)."

**"How does rate limiting work?"**

> "It's a sliding window algorithm stored in MongoDB. Each user has a `rateLimitHits` array of timestamps. On every request:
>
> 1. Filter the array to keep only timestamps from the last 60 seconds
> 2. If the count >= the user's limit (default 5/min), reject with a retry-after message
> 3. Otherwise, push the current timestamp and save
>
> Old timestamps are pruned automatically on every check — no separate cleanup job. Because the state is in MongoDB, it works correctly across Vercel's multiple serverless instances. There's no shared in-process state to worry about."

**"Why not use Redis for rate limiting?"**

> "Adding Redis would mean another hosted service, another cost, another point of failure. MongoDB is already there for everything else, and for the traffic levels this bot handles, the extra read-write per request is negligible. If I needed to scale to thousands of concurrent users, I'd move to Redis — but for this use case, MongoDB is simpler and free."

---

### 4.6 File System

**"How does file upload and processing work?"**

> "When a user sends a file in Telegram:
>
> 1. Download the file via Telegram's `getFile` API
> 2. Extract text based on type — `pdf-parse` for PDFs, `mammoth` for DOCX, `xlsx` for spreadsheets, base64 encoding for images
> 3. Store the original binary in MongoDB GridFS (it chunks large files into 255KB pieces)
> 4. Send the extracted text to Gemini for analysis — Flash for text files, Gemini Vision for images
> 5. Save metadata + extracted text in the user's `files[]` array (capped at 10 files)
>
> Files marked as 'active' are injected into every chat message's system prompt, so the AI can reference them naturally without the user quoting from them."

**"Why GridFS instead of S3?"**

> "Same database, zero extra services. GridFS stores binary data inside MongoDB by splitting files into 255KB chunks. I'm already connected to MongoDB Atlas — no extra credentials, no CORS configuration, no presigned URLs. For a bot where files are typically PDFs and images under 20MB, GridFS is perfect."

---

### 4.7 Onboarding and UX

**"How does onboarding work?"**

> "It's a state machine stored in MongoDB. The user's `onboardingStep` field tracks which step they're on. Step 0 is the name (required). Step 1 is a gateway — the user chooses to 'proceed' through all 7 preference steps, 'skip all' to use defaults, or pick specific ones by number like '1, 3, 7'. This means a new user can be set up in 3 seconds or can fully customise everything."

**"How do you handle mid-flow cancellation?"**

> "I have a universal escape system. Before any command handler runs, I check if the user typed 'cancel', 'stop', 'exit', or 'quit'. If they're mid-onboarding, it resets their step to 0 (keeping their name). If they're mid-email-setup, it clears all temporary fields. If they're mid-account-deletion, it clears the `pendingDelete` flag. Each flow gets a context-specific message — defined in `flowUtils.js`. Every mid-flow prompt includes a reminder: 'Type cancel anytime to stop.'"

**"How does command typo correction work?"**

> "If a message starts with `/` and doesn't match any known command, I check a typo map before showing 'unknown command'. Common mistakes like `/mail` -> `/mails`, `/prefs` -> `/preferences`, `/delete` -> `/deleteaccount` get a 'Did you mean?' suggestion. I also handle prefix typos like `/read 3` -> `/readmail 3`, carrying the arguments through."

---

### 4.8 Serverless Challenges

**"What challenges did you face with serverless?"**

> "Three main ones:
>
> 1. **25-second timeout** — Vercel Hobby functions die after 25 seconds. Email fetches, news APIs, and AI calls can be slow. I wrapped every long operation in a `Promise.race` timeout — if it doesn't finish in time, the user gets a friendly 'taking too long, try again' instead of a silent failure.
>
> 2. **No persistent state** — each request is a fresh function instance. Rate limiting had to be stored in MongoDB, not in memory. The only in-memory state is the email cache for `/readmail`, which is lost between function invocations — but that's acceptable because users always run `/mails` first.
>
> 3. **Single cron job** — Vercel Hobby allows one cron. I merged the daily briefing and quota reset into a single endpoint (`/api/cron`). Both run at 9 AM IST."

**"How do you keep the user informed during long operations?"**

> "I show a typing indicator immediately, then refresh it every 4 seconds with `setInterval`. For operations that might time out, I send an instant acknowledgement message ('Fetching emails...') before starting the async work. If the operation fails, the user always gets an error message — never a silent failure. The `clearInterval` is in a `finally` block or in both the success and error paths."

---

## 5. Design Pattern Questions

### "What design patterns do you use?"

| Pattern | Where | Why |
|---------|-------|-----|
| **Router / Strategy** | `emailClient.js` — dispatches to Gmail, Outlook, or IMAP implementation | One interface, multiple providers. Adding a new provider is one function + one `case` |
| **State Machine** | Onboarding steps, email setup steps | Multi-step flows with MongoDB-backed state that survives server restarts |
| **ReAct Agent** | `phoneAgent.js` — perceive, reason, act, repeat | Standard AI agent pattern for multi-step tasks requiring visual understanding |
| **Fallback Chain** | `ai.js` — Flash -> Flash-Lite -> plain text | Graceful degradation when the primary AI is unavailable |
| **Sliding Window** | `rateLimit.js` — timestamps in last 60s | Fair rate limiting that naturally expires old entries |
| **Middleware** | Bridge server — secret header check | Separation of auth logic from business logic |
| **Builder** | `persona.js` — constructs system prompts from user profile | Assembles complex prompts from user-specific data |
| **Observer** | Gmail OAuth `tokens` event listener | React to token refresh without polling |

---

## 6. Tradeoffs and "What Would You Change?"

### "What tradeoffs did you make?"

| Tradeoff | Decision | Why |
|----------|----------|-----|
| Fixed 9 AM briefing | Only one cron allowed on Vercel free tier | Per-user times would require polling or paid plan |
| In-memory email cache | `Map` for `/readmail`, lost on cold start | Acceptable because `/mails` always runs first; avoids database cost |
| MongoDB for rate limits | Not as fast as Redis | One fewer service to manage, sufficient for this scale |
| Serverless phone agent | 25s timeout limits complex phone tasks | Keeps hosting free; tasks rarely need 20 full steps |
| Single webhook handler | 1500+ line route.js | Keeps routing simple — no framework overhead, easy to follow top to bottom |

### "What would you improve with more time?"

1. **Message queue** for long operations (phone tasks, file processing) — decouple from the webhook response
2. **Per-user timezone** for briefing delivery instead of fixed IST
3. **WebSocket bridge** instead of HTTP polling for phone control — lower latency
4. **Redis** for rate limiting if scaling beyond ~100 concurrent users
5. **Split route.js** into per-command modules with a command registry pattern
6. **Stripe integration** for paid tiers — the quota system already supports it
7. **Calendar integration** — Google Calendar / Outlook Calendar for the morning briefing
8. **Voice messages** — Telegram supports voice; could use Whisper or Gemini audio

---

## 7. Scenario-Based Questions

### "A user says emails are slow. How do you debug?"

> "First, I check which provider they're using. Gmail uses REST API (usually fast), Outlook uses Graph API (sometimes slow), IMAP connects directly (depends on provider's server). I'd check the health endpoint (`/api/health`) to confirm database and encryption are working. Then I'd look at the timeout wrapper — if it's hitting the 20-second limit, the mail server is genuinely slow. I'd also check if their OAuth token is expired (failed refresh) by looking at error logs. If the issue is the AI analysis step, not the email fetch, I'd see if Gemini is rate-limited — that's why the fallback to Flash-Lite exists."

### "How would you add a new email provider?"

> "1. Add a new case in `emailClient.js`'s `fetchEmails()` router
> 2. Write a `fetchEmailsNewProvider()` function that returns the same shape
> 3. If it's OAuth, add an auth callback route under `/api/auth/newprovider/callback/`
> 4. If it's IMAP, add defaults in `emailProviders.js`
> 5. Update the `emailSetup.js` state machine to handle the new provider name
> 6. No changes needed to the AI analysis, briefing pipeline, or quota system — they're provider-agnostic"

### "The bot goes viral and gets 10,000 users. What breaks first?"

> "In order of likelihood:
> 1. **Gemini free tier rate limits** — the AI calls would get throttled. Fix: upgrade to paid Gemini API or add request queuing.
> 2. **MongoDB connections** — serverless functions each open a connection. Fix: connection pooling (already using cached connections), or move to MongoDB Serverless tier.
> 3. **Vercel function concurrency** — too many simultaneous webhooks. Fix: upgrade to Vercel Pro, or add a message queue.
> 4. **Daily cron timeout** — sending 10,000 briefings in one function invocation. Fix: batch processing with pagination, or use a background job service.
> 5. **Rate limiting accuracy** — MongoDB reads/writes for every request add latency. Fix: move rate limiting to Redis."

### "How do you prevent abuse?"

> "Multiple layers:
> 1. **Token quota** — every user gets 10 tokens/day, each action has a cost. Can't spam.
> 2. **Rate limiting** — max 5 requests/minute per user, stored in MongoDB.
> 3. **Ban system** — admin can ban users. Banned users see a message and can't do anything.
> 4. **Phone app permissions** — users can restrict which apps the bot accesses.
> 5. **Bridge authentication** — shared secret prevents unauthorised ADB access.
> 6. **Encryption** — even if the database is compromised, credentials are AES-256-GCM encrypted."

---

## 8. Code Snippets to Know Cold

### Timeout wrapper (serverless pattern)
```js
const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("__timeout__")), ms)
    ),
  ]);

// Usage
try {
  const emails = await withTimeout(fetchEmails(account, chatId, 10), 20000);
} catch (err) {
  if (err.message === "__timeout__") {
    await sendTelegramMessage("Taking too long. Try again.", chatId);
  }
}
```

### Encryption format
```js
// Encrypt: plaintext -> "iv:authTag:ciphertext"
const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", KEY, iv);
const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
return [iv.toString("hex"), cipher.getAuthTag().toString("hex"), encrypted.toString("hex")].join(":");
```

### IST-aware date check
```js
const istOffset = 5.5 * 60 * 60 * 1000;
const nowIST = new Date(now.getTime() + istOffset);
const resetIST = new Date(lastReset.getTime() + istOffset);
if (nowIST.toDateString() !== resetIST.toDateString()) {
  // New day in IST — reset quota
}
```

### Sliding window rate limit
```js
const WINDOW_MS = 60_000;
const windowStart = new Date(now.getTime() - WINDOW_MS);
const recentHits = user.rateLimitHits.filter(t => new Date(t) > windowStart);
if (recentHits.length >= user.rateLimit) {
  const retryAfter = Math.ceil((new Date(recentHits[0]).getTime() + WINDOW_MS - now.getTime()) / 1000);
  return { allowed: false, retryAfter };
}
```

### Gmail token refresh listener
```js
oauth2Client.on("tokens", async (tokens) => {
  await User.updateOne(
    { chatId },
    { $set: { "emailAccounts.$[acct].oauthAccessToken": encrypt(tokens.access_token) } },
    { arrayFilters: [{ "acct._id": account._id }] }
  );
});
```

### Promise.allSettled for resilient parallel operations
```js
// One user's failure doesn't block others
const results = await Promise.allSettled(
  users.map(user => sendBriefing(user))
);
const succeeded = results.filter(r => r.status === "fulfilled").length;
const failed = results.filter(r => r.status === "rejected").length;
```

---

## 9. Numbers to Remember

| Metric | Value |
|--------|-------|
| Default daily quota | 10 tokens/user |
| Default rate limit | 5 requests/min/user |
| Chat token cost | 1 |
| News/mails token cost | 3 |
| Phone task token cost | 5 |
| File upload cost | 3 |
| File download cost | 2 |
| Max phone agent steps | 20 |
| Telegram message limit | 4,096 characters (auto-split) |
| Vercel function timeout | 25 seconds (Hobby) |
| Email fetch timeout | 20 seconds |
| News fetch timeout | 15 seconds |
| History kept | Last 20 messages |
| Max stored files | 10 per user |
| Max extracted text | 50,000 characters |
| GridFS chunk size | 255 KB |
| AES key size | 256 bits (32 bytes, 64 hex chars) |
| AES IV size | 96 bits (12 bytes) |
| Cron schedule | 3:30 UTC = 9:00 AM IST |
| Briefing time | 9:00 AM IST daily |

---

## 10. Vocabulary — Say It Right

| Term | What it means in this project |
|------|-------------------------------|
| **Webhook** | Telegram sends HTTP POST to my endpoint when a user messages the bot |
| **ReAct loop** | Reason + Act — the agent perceives (screenshot), decides (Gemini), acts (ADB), repeats |
| **Grounding** | Gemini's ability to search Google during generation for current data |
| **GCM** | Galois/Counter Mode — AES encryption mode that provides both confidentiality and authentication |
| **Auth tag** | 16-byte value produced by GCM that detects tampering with ciphertext |
| **IV** | Initialization Vector — random bytes ensuring same plaintext encrypts differently each time |
| **GridFS** | MongoDB's specification for storing large files by chunking them into sub-documents |
| **App password** | A single-purpose password generated by email providers (Yahoo, iCloud) for third-party access |
| **Sliding window** | Rate limiting technique: only count requests within the last N seconds |
| **State machine** | Onboarding/email-setup flows where the user's step number determines what happens next |
| **Cold start** | First invocation of a serverless function — slightly slower because the runtime must initialise |
| **Token quota** | A daily budget of "tokens" each user can spend on AI-powered features |
| **Bridge** | The local HTTP server that translates agent commands into ADB actions on the phone |
| **Provider router** | Pattern where `fetchEmails()` dispatches to different implementations based on account type |

---

## 11. Questions YOU Should Ask (If They Open the Floor)

- "Would you like me to walk through the data flow for a specific command like `/mails` or `/phone`?"
- "I can explain the encryption scheme in more detail — are security practices important for this role?"
- "The phone control feature uses an AI agent loop — I'm happy to whiteboard how it works"
- "I made specific tradeoffs for serverless — would you like me to compare with a traditional server architecture?"

These show depth without being arrogant. They signal you know the project well enough to go deeper.

---

## 12. Red Flags to Avoid in Your Answers

| Don't say | Say instead |
|-----------|------------|
| "I used AI to build it" | "I architected the system and implemented each feature" |
| "It just calls the API" | "I built a provider abstraction layer with fallback strategies" |
| "It's just a chatbot" | "It's a multi-system personal assistant with email, news, phone control, and file intelligence" |
| "I didn't think about security" | "Credentials are AES-256-GCM encrypted at rest, bridge endpoints require auth headers, admin commands are gated by chat ID" |
| "It works on my machine" | "It runs on Vercel serverless with MongoDB Atlas — fully deployed, costs $0/month" |
| "I would add Redis later" | "I made a deliberate choice to use MongoDB for rate limiting at this scale — Redis would be the next step at 100+ concurrent users" |

---

## 13. Project Stats for Your Resume

**One-liner for resume:**
> Personal AI Assistant — Telegram bot with multi-provider email integration, AI-powered news briefings, Android phone control via ReAct agent loop, and file intelligence. Built with Next.js, MongoDB, Gemini AI. Serverless on Vercel ($0/month).

**Key metrics:**
- 30+ Telegram commands
- 5 email providers (Gmail, Outlook, Yahoo, iCloud, IMAP)
- 7 file types supported (PDF, DOCX, TXT, CSV, XLSX, JPG, PNG)
- 8 Android device actions (tap, type, swipe, launch, back, home, scroll, keyevent)
- AES-256-GCM encryption for all stored credentials
- Per-user daily quota + sliding window rate limiting
- Web admin dashboard with user management
- Daily automated briefings via Vercel Cron
- 20+ source files across 2 codebases (web app + bridge server)

**Bullet points for resume:**
- Designed and built a serverless Telegram AI assistant integrating Google Gemini, multi-provider email (OAuth + IMAP), and real-time web search grounding
- Implemented AES-256-GCM encryption for credential storage, sliding-window rate limiting, and per-user daily token quotas
- Built a ReAct agent loop for Android phone control using Gemini Vision + ADB bridge, supporting 7 device actions with app-level permission controls
- Created a file intelligence pipeline supporting 7 formats (PDF, DOCX, XLSX, CSV, TXT, images) with AI analysis, GridFS storage, and document regeneration
- Architected for zero-cost operation on Vercel Hobby + MongoDB Atlas free tier with graceful timeout handling for serverless constraints
