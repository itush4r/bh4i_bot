# Response Time Optimization Plan

## Current Request Flow (Chat Message)

```
User sends message
  → Telegram delivers webhook to Vercel
  → dbConnect()                          ~50-300ms  (cold) / ~0ms (warm)
  → getOrCreateUser()                    ~50-150ms  (MongoDB query)
  → checkRateLimit()                     ~50-150ms  (MongoDB query + update)
  → checkQuota()                         ~50-150ms  (MongoDB query + update)
  → generateChatResponse()               ~1500-8000ms (Gemini API — BIGGEST bottleneck)
  → User.updateOne() (save history)      ~50-150ms
  → deductQuota()                        ~50-150ms
  → sendTelegramMessage()                ~100-300ms
                                         ─────────────
                              Total:     ~2000-9000ms
```

## Optimizations (ordered by impact)

---

### 1. Use `gemini-2.5-flash-lite` for chat (saves ~1-4 seconds)

**Why:** `gemini-2.5-flash` with `useSearchGrounding: true` is the slowest call in the entire flow. Most user messages ("hi", "what's the weather", "thanks") don't need web search. flash-lite is 2-3x faster for simple responses.

**File:** `src/lib/ai.js`

```js
// BEFORE
const flashModelWithSearch = google("gemini-2.5-flash", { useSearchGrounding: true });

// AFTER — use flash-lite for chat, only use search model when needed
const chatModel      = google("gemini-2.5-flash-lite");
const searchModel    = google("gemini-2.5-flash", { useSearchGrounding: true });
```

**Then in `generateChatResponse`:** use `chatModel` by default. The model is fast enough for conversational replies. Search grounding adds 2-5s latency per request for a feature that's rarely needed.

---

### 2. Parallelize DB writes after AI response (saves ~100-300ms)

**Why:** After getting the AI response, history save, quota deduction, and Telegram send are all independent — run them together.

**File:** `src/app/api/webhook/telegram/route.js` — Chat fallback section

```js
// BEFORE (sequential)
await User.updateOne(...);   // save history
await deductQuota(user, "chat");
await sendTelegramMessage(response, chatId);

// AFTER (parallel)
await Promise.all([
  User.updateOne(
    { chatId: String(chatId) },
    { $push: { history: { $each: [
        { role: "user", content: text },
        { role: "assistant", content: response },
      ], $slice: -20 } } }
  ),
  deductQuota(user, "chat"),
  sendTelegramMessage(response + (chatQuota.warning || ""), chatId),
]);
```

---

### 3. Parallelize rate limit + quota check (saves ~50-150ms)

**Why:** Rate limit check and quota check are independent reads — no reason to await one before the other.

**File:** `src/app/api/webhook/telegram/route.js`

```js
// BEFORE (sequential)
const rateCheck = await checkRateLimit(user);
if (!rateCheck.allowed) { ... }
// ... later
const chatQuota = await checkQuota(user, "chat");

// AFTER — check both upfront right after getting user
const [rateCheck, chatQuota] = await Promise.all([
  checkRateLimit(user),
  checkQuota(user, "chat"),
]);
if (!rateCheck.allowed) { await sendTelegramMessage(rateCheck.message, chatId); return ...; }
if (!chatQuota.allowed) { await sendTelegramMessage(chatQuota.message, chatId); return ...; }
```

**Note:** This only works cleanly for the chat fallback path. Commands have their own specific quota checks later — those are fine as-is.

---

### 4. Reduce history from 20 to 10 messages (saves ~500-1500ms)

**Why:** Every history message is sent to Gemini. 20 messages = large prompt = slower response. 10 messages (5 exchanges) is plenty for context.

**File:** `src/app/api/webhook/telegram/route.js`

```js
// BEFORE
const history = user.history.slice(-20).map(({ role, content }) => ({ role, content }));

// AFTER
const history = user.history.slice(-10).map(({ role, content }) => ({ role, content }));
```

Also update the `$slice` when saving:
```js
$slice: -10  // was -20
```

---

### 5. Lower `maxTokens` for chat (saves ~200-500ms)

**Why:** `maxTokens: 500` allows long responses. Most chat replies are under 150 tokens. Lower = faster generation stop.

**File:** `src/lib/ai.js`

```js
// BEFORE
maxTokens: 500,

// AFTER
maxTokens: 300,
```

The bot's system prompt already says "be concise/direct" — 300 tokens is still ~220 words, plenty for a chat reply.

---

### 6. Add MongoDB index on `chatId` (saves ~20-50ms per query)

**Why:** Every request does `User.findOne({ chatId })`. Without an index this is a collection scan.

**File:** `src/models/User.js` — already has `unique: true` on chatId, which creates an index. This is fine. No change needed.

---

### 7. Skip file context loading when no active files (saves ~10-30ms)

**File:** `src/app/api/webhook/telegram/route.js`

```js
// BEFORE — always builds file context string
const activeFiles = (user.files || [])
  .filter((f) => f.isActive)
  .slice(0, 5)
  .map((f) => `File: ${f.name}\nSummary: ...`)
  .join("\n\n---\n\n");

// AFTER — skip if no files
const activeFilesList = (user.files || []).filter((f) => f.isActive).slice(0, 5);
const activeFiles = activeFilesList.length > 0
  ? activeFilesList.map((f) => `File: ${f.name}\nSummary: ${f.summary || ""}\nContent:\n${(f.extractedText || "").slice(0, 5000)}`).join("\n\n---\n\n")
  : "";
```

Minor, but avoids unnecessary string ops.

---

## Estimated Impact

| Optimization | Time Saved |
|---|---|
| 1. flash-lite for chat | 1000-4000ms |
| 2. Parallel DB writes | 100-300ms |
| 3. Parallel rate+quota check | 50-150ms |
| 4. History 20 → 10 | 500-1500ms |
| 5. maxTokens 500 → 300 | 200-500ms |
| 6. Skip empty file context | 10-30ms |
| **Total** | **~1800-6500ms faster** |

## Expected Result

| Metric | Before | After |
|---|---|---|
| Average chat response | 3-6 seconds | 1-2 seconds |
| Worst case (cold start) | 8-10 seconds | 3-5 seconds |
| Vercel timeout risk | High | Low |

---

## How to Apply

Run these changes in order of impact. Optimization #1 (switch to flash-lite) alone will cut response time roughly in half for most messages.
