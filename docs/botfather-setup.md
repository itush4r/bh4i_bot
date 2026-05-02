# BotFather Setup — Copy/Paste Pack

Three fields to set in @BotFather, plus the existing welcome message from Ticket 3.
They build on each other: **About** hooks → **Description** explains → **Welcome** delivers.

All commands in this doc were cross-checked against the production webhook handler at
`src/app/api/webhook/telegram/route.js`. Last verified: 2026-05-02.

---

## 1. About text (max 120 chars)

Shows on the bot's profile page (when someone taps the bot name).
Short, punchy, one-line value prop.

```
Your personal AI assistant on Telegram. Email, news, daily briefings, and document chat — all personalised to you.
```

**Char count: 117** ✅

### Alternative options if you want to test variants

```
AI assistant that reads your emails, summarises news, and chats with full context. Lives in Telegram, no app needed.
```
(116 chars)

```
Personal AI for busy people. Email triage, daily briefings, document Q&A — all in Telegram.
```
(91 chars — punchier)

---

## 2. Description (max 512 chars)

Shows on the empty chat screen above the big blue **START** button.
This is the user's first real impression. Tell them what they get if they tap START.

```
🤖 Hi! I'm your personal AI assistant.

I help you cut through the noise of email, news, and daily admin — all from Telegram.

📧 Read & send emails (Gmail, Outlook, Yahoo, iCloud, IMAP)
📰 Personalised news briefings
⏰ Daily 9 AM summary — emails + news, automatically
📁 Chat with PDFs, DOCX, spreadsheets, images
🎭 Custom AI personas — pick a tone that fits you
💬 Full context — I remember our conversations

🔒 Encrypted. Private. Yours alone.

Tap START to begin.
```

**Char count: 470** ✅ (UTF-16 code units, which is what Telegram counts)

### Tighter alternative if you want it shorter

```
🤖 Your personal AI assistant on Telegram.

📧 Email triage across Gmail, Outlook, IMAP
📰 Personalised news briefings
⏰ Daily 9 AM summary — automatic
🎭 Custom AI personas — pick your tone
📁 Read PDFs, DOCX, images, spreadsheets
💬 Full context, encrypted, private

Tap START to begin.
```
(~315 chars)

---

## 3. Botpic (logo)

Upload a square logo via `/setuserpic` in @BotFather.

**Specs:**
- Square, minimum 640×640 px
- PNG or JPG
- Simple, recognisable at thumbnail size (Telegram displays it as a 50×50 circle in chat lists)

**Quick options if you don't have one yet:**
- A single emoji on a coloured background — surprisingly effective. 🤖 on dark blue, 📧 on green, etc.
- Your initials on a clean background
- Free icon from Flaticon or Lucide, recoloured

Avoid: complex illustrations, text-heavy logos (unreadable at small sizes), generic AI clip-art.

---

## 4. Commands menu

In @BotFather: `/setcommands` → pick your bot → paste this list.

This adds a **menu button** in the chat that shows a dropdown of all commands. Massive UX upgrade — users discover features without reading docs.

**25 commands**, all verified to exist in the production webhook handler.

```
start - Begin or restart onboarding
help - See all commands
profile - View your saved profile
setprofile - Update your saved profile
preferences - View your preferences
setpref - Update preferences (timezone, language, tone)
personas - List available AI personas
persona - Switch, create, or edit your active persona
mails - Fetch your latest emails
readmail - Read a specific email in full
send - Send an email
accounts - List connected email accounts
connectmail - Connect Gmail, Outlook, Yahoo, iCloud, or IMAP
disconnectmail - Disconnect a connected email account
setdefault - Set your default email account
news - Get personalised news briefing
briefing - View daily briefing settings
setbriefing - Change daily briefing (both/news/mails/none)
files - List your saved files
download - Download an updated copy of a file
usage - Check your daily token usage
requestquota - Request more daily tokens
requestlimit - Request a higher per-minute rate limit
reset - Clear conversation history
deleteaccount - Permanently delete all your data
```

### What's intentionally NOT in this list

**Phone-control commands** (skipped per current product decision):
`/connectphone`, `/disconnectphone`, `/apps`, `/phoneaccess`, `/phone`
Add them back if/when phone control becomes a discoverable feature.

**File sub-commands** (documented inline in `/files` response, not surfaced in dropdown to avoid clutter):
`/activefile`, `/inactivefile`, `/removefile`, `/clearfiles`
The `/files` response itself tells users about these. If you ever surface one, `/clearfiles` is the most defensible (destructive action, users will hunt for it in the menu).

**Admin commands** (filtered server-side, must never appear in public menu):
`/setquota`, `/denyquota`, `/setlimit`, `/denylimit`, `/ban`, `/unban`, `/warn`, `/users`, `/userinfo`, `/resetquota`, `/stats`, `/adminhelp`, `/phoneusers`, `/disablephone`

---

## 5. Step-by-step in @BotFather

Open Telegram, message **@BotFather**, then:

1. `/mybots` → pick your bot
2. **Edit Bot** → **Edit About** → paste the About text
3. **Edit Bot** → **Edit Description** → paste the Description
4. **Edit Bot** → **Edit Botpic** → upload your logo
5. Back to the bot menu → `/setcommands` → pick your bot → paste the command list

Done. No code deploy needed — Telegram updates these instantly.

---

## How the full first-touch flow looks after this

1. User finds your bot (link, search, referral)
2. Opens chat → sees **Description** + big blue **START** button
3. Taps **START** → Telegram sends `/start`
4. Bot receives `/start` → sends the **Welcome message** (Ticket 3) → asks for name
5. Onboarding continues as today

The user has now seen three layers of context:
- **About** (when previewing the bot)
- **Description** (on the empty chat)
- **Welcome** (after tapping START)

By the time they're typing their name, they actually know what they signed up for.

---

## Why these three layers stack well

| Field | Where it shows | Length | Job |
|-------|---------------|--------|-----|
| About | Bot profile | 120 chars | Hook — get them curious |
| Description | Empty chat / START screen | 512 chars | Explain — convince them to tap START |
| Welcome (Ticket 3) | After /start | ~600 chars | Deliver — full feature tour + privacy reassurance |

Each one is a step deeper. About is the trailer, Description is the synopsis, Welcome is the first chapter.

---

## One small thing to be aware of

Telegram caches About/Description aggressively on the client side. If you update them and they don't change immediately for you, force-refresh by closing the chat fully and reopening, or test from a different device. Other users will see the new version on their next open.

---

## Maintenance: keeping this doc in sync with the code

The 25-command list above mirrors the handlers in `src/app/api/webhook/telegram/route.js`.
If you add a new user-facing command there, update this doc and re-run `/setcommands` in @BotFather.

Quick way to list all command handlers in code:

```bash
grep -nE 'text\s*===?\s*"/|text\.startsWith\("/' src/app/api/webhook/telegram/route.js
```

That output minus phone commands, minus file sub-commands, minus admin commands = what should be in this list.
