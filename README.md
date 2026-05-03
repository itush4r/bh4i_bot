# AI Assistant — Telegram Bot

A personal AI assistant delivered via Telegram. Connects to your email accounts (Gmail, Outlook, Yahoo, iCloud, or any IMAP provider), fetches the news you care about, controls your Android phone remotely, switches between AI personas on demand, and sends a daily briefing — all personalised to your profile and preferences.

Built with Next.js (App Router), MongoDB, and Google Gemini.

---

## Features

- **Flexible onboarding** — name is required, then choose to set up all preferences one by one, skip all with defaults, or pick specific ones to configure
- **Persistent AI chat with web search** — conversation history stored in MongoDB; Gemini automatically searches Google when it needs current info (weather, prices, live scores, recent events)
- **Switchable personas** — five built-ins (CEO Advisor, HR Partner, Technical Mentor, Writing Coach, Reflective Listener) plus guided creation, cloning, and editing of your own custom personas; daily briefings stay neutral
- **Multi-account email** — connect Gmail, Outlook, Yahoo, iCloud, or any IMAP provider; manage multiple accounts per user
- **Smart email analysis** — AI categorises emails by focus areas you choose (jobs, finance, newsletters, promotions, etc.)
- **Full email reading** — fetch emails and read full body content with `/readmail`
- **Personalised news** — choose your news categories and total article count
- **Configurable daily briefing** — choose what to receive (news, mails, both, or none) at 9:00 AM IST every day
- **File upload and intelligence** — send any PDF, DOCX, TXT, CSV, XLSX, or image; bot reads it, gives instant AI feedback, and saves it for context-aware chat
- **File context in chat** — mark files as active and the AI references them naturally in conversation
- **Downloadable updated files** — ask the bot to rewrite a section, then `/download` the result as a proper PDF or DOCX; LaTeX-quality PDF rendering kicks in automatically when the content benefits from it (resumes, math, structured docs), with `pdf-lib` as a fallback
- **Android phone control** — connect your phone via ADB bridge, then run natural language tasks ("Open WhatsApp and send hello to Mom") powered by Gemini Vision in a ReAct agent loop
- **App permission system** — control which apps the bot can access on your phone
- **Per-user preferences** — each user controls their own news, email, briefing, persona, and phone settings independently
- **Per-user daily token quota** — protects Gemini free tier across all users with soft limits and warnings
- **Quota request flow** — users can request more tokens; admin gets notified and can approve/deny via Telegram
- **Admin Telegram commands** — manage users, quotas, bans, phone access, and warnings directly from Telegram
- **Per-user rate limiting** — configurable requests/minute per user with request flow
- **Web admin dashboard** — password-protected dashboard at `/admin` to view and manage all users
- **Account deletion** — users can permanently delete all their data via `/deleteaccount`
- **Universal cancel/escape** — type `cancel`, `stop`, `exit`, or `quit` at any point during onboarding, email setup, persona creation, or account deletion to safely abort; every mid-flow prompt shows an escape hint
- **Command typo correction** — mistyped commands like `/mail`, `/email`, `/prefs`, `/delete` get a "did you mean?" suggestion instead of being treated as chat
- **AI always shows next action** — every explanation ends with the exact command to type next; casual messages get natural short replies without commands

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js (App Router) |
| Database | MongoDB Atlas (Mongoose) |
| AI | Google Gemini 2.5 Flash (Vercel AI SDK) |
| Vision AI | Gemini Flash (screenshot analysis for phone control) |
| Email — OAuth | Gmail API, Microsoft Graph API |
| Email — IMAP | imapflow + nodemailer |
| News | NewsAPI |
| Bot | Telegram Bot API |
| File — DOCX read | mammoth |
| File — PDF read | unpdf |
| File — Excel/CSV | exceljs |
| File — PDF generate | LaTeX (latexonline.cc) with pdf-lib fallback |
| File — DOCX generate | docx |
| File storage | MongoDB GridFS |
| Phone Bridge | Express + ADB (runs on Android via Termux or PC) |
| Tunnelling | ngrok (for bridge server) |
| Hosting | Vercel |

---

## Project Structure

```
src/
├── app/
│   ├── admin/
│   │   ├── layout.js                        # Basic auth protection for /admin
│   │   └── page.js                          # Web admin dashboard
│   ├── api/
│   │   ├── admin/
│   │   │   └── users/
│   │   │       ├── route.js                 # GET all users
│   │   │       └── [chatId]/route.js        # PATCH user (quota, status)
│   │   ├── auth/
│   │   │   ├── gmail/callback/route.js      # Gmail OAuth callback
│   │   │   └── outlook/callback/route.js    # Outlook OAuth callback
│   │   ├── cron/
│   │   │   └── route.js                     # Daily briefing + quota reset (Vercel cron, 9 AM IST)
│   │   ├── health/route.js                  # Health check
│   │   ├── test-db/route.js                 # DB connection test
│   │   └── webhook/telegram/route.js        # Telegram bot webhook handler
│   ├── connected/page.js                    # OAuth success page (browser)
│   ├── layout.js
│   └── page.js
├── jobs/
│   └── dailySummary.js                      # Per-user daily briefing pipeline
├── lib/
│   ├── adminCommands.js                     # Admin Telegram command handlers
│   ├── ai.js                                # Gemini AI wrapper (chat, summary, email analysis)
│   ├── db.js                                # MongoDB connection (cached)
│   ├── emailClient.js                       # Universal email fetch/send router
│   ├── emailProviders.js                    # IMAP/SMTP defaults per provider
│   ├── emailSetup.js                        # Multi-step email onboarding state machine
│   ├── logger.js                            # Summary logger
│   ├── basicAuth.js                         # Shared HTTP basic auth helper
│   ├── encryption.js                        # AES-256-GCM encrypt/decrypt for stored credentials
│   ├── fileExtractor.js                     # Extract text from PDF, DOCX, XLSX, CSV, TXT, images
│   ├── fileGenerator.js                     # Generate updated PDF, DOCX, TXT files
│   ├── fileHandler.js                       # File upload pipeline (download, extract, analyse, store)
│   ├── flowUtils.js                         # Escape/cancel detection + context-specific messages
│   ├── gridfs.js                            # MongoDB GridFS store/get/delete for file binaries
│   ├── news.js                              # NewsAPI wrapper
│   ├── persona.js                           # AI system prompt builder
│   ├── phoneAgent.js                        # ReAct agent loop for Android phone control
│   ├── quota.js                             # Token quota check & deduct logic
│   ├── rateLimit.js                         # Per-user rate limiting (MongoDB-backed)
│   └── telegram.js                          # Telegram message sender (auto-splits at 4096 chars)
└── models/
    └── User.js                              # Mongoose user schema

scripts/
└── migrateEncryption.js                     # One-time migration: encrypts existing plain-text credentials

bridge/                                       # Standalone ADB bridge server
├── src/
│   ├── index.js                             # Express server + auth middleware
│   ├── adb.js                               # ADB shell wrapper (promisified)
│   ├── apps.js                              # Installed app registry (package + label)
│   ├── executor.js                          # Action executor (tap, type, swipe, launch, etc.)
│   ├── screen.js                            # Screenshot capture → base64 PNG
│   └── tunnel.js                            # ngrok tunnel + auto-register with bot
├── .env.example
└── package.json
```

---

## Environment Variables

Create `.env.local` at the project root. **Never commit actual secret values to version control.**

```env
# MongoDB
MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?appName=<app>

# Telegram
TELEGRAM_BOT_TOKEN=<token-from-botfather>

# Google Gemini
GOOGLE_GENERATIVE_AI_API_KEY=<your-gemini-api-key>

# Vercel AI Gateway (optional)
AI_GATEWAY_API_KEY=<your-vercel-ai-gateway-key>

# NewsAPI (newsapi.org)
NEWS_API_KEY=<your-newsapi-key>

# Gmail OAuth
GMAIL_CLIENT_ID=<your-google-client-id>
GMAIL_CLIENT_SECRET=<your-google-client-secret>
GMAIL_REDIRECT_URI=https://<your-app>.vercel.app/api/auth/gmail/callback

# Outlook OAuth
OUTLOOK_CLIENT_ID=<your-azure-app-id>
OUTLOOK_CLIENT_SECRET=<your-azure-client-secret>
OUTLOOK_TENANT_ID=common
OUTLOOK_REDIRECT_URI=https://<your-app>.vercel.app/api/auth/outlook/callback

# Cron protection
CRON_SECRET=<random-hex-string>

# Encryption (AES-256-GCM) — generate with:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=<64-character-hex-string>

# Admin
ADMIN_CHAT_ID=<your-telegram-chat-id>
ADMIN_USERNAME=<web-dashboard-username>
ADMIN_SECRET=<web-dashboard-password>
```

For the bridge server, create `bridge/.env`:

```env
BRIDGE_SECRET=<shared-secret-for-bridge-auth>
PORT=7777
NGROK_AUTH_TOKEN=<optional-ngrok-token>
```

All variables must also be added to **Vercel → Settings → Environment Variables** for production.

---

## Setup Guide

### 1. MongoDB Atlas
1. Create a free M0 cluster at [mongodb.com/atlas](https://mongodb.com/atlas)
2. Create a database user and copy the connection string into `MONGODB_URI`
3. **Network Access** → Add IP → allow `0.0.0.0/0` (required for Vercel's dynamic IPs)

### 2. Telegram Bot
1. Message [@BotFather](https://t.me/BotFather) → `/newbot`
2. Copy the token into `TELEGRAM_BOT_TOKEN`
3. After deploying, register the webhook:
   ```
   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-app>.vercel.app/api/webhook/telegram
   ```

### 3. Gmail OAuth
1. Go to [console.cloud.google.com](https://console.cloud.google.com) → New Project
2. **APIs & Services** → Enable **Gmail API**
3. **OAuth consent screen** → External → fill in app name and support email
4. **Credentials** → Create OAuth 2.0 Client ID → Web application
5. Authorized redirect URIs → add your `GMAIL_REDIRECT_URI`
6. Copy Client ID and Secret into env vars

### 4. Outlook OAuth
1. Go to [portal.azure.com](https://portal.azure.com) → Azure Active Directory → App registrations → New
2. **Authentication** → Add redirect URI under **Web** (not SPA):
   `https://<your-app>.vercel.app/api/auth/outlook/callback`
3. **API permissions** → Add: `Mail.Read`, `Mail.Send`, `offline_access`
4. **Certificates & secrets** → New client secret → copy value
5. Copy Application ID and secret into env vars

### 5. Install & Deploy
```bash
npm install
git push   # Vercel auto-deploys on push
```

### 6. Bridge Server (Android Phone Control)

**Option A: Termux on Android (no PC required)**
```bash
pkg install nodejs android-tools
cd bridge && npm install
cp .env.example .env   # edit with your secret
npm start
```

**Option B: PC with phone connected via USB**
```bash
# Ensure ADB is installed and phone is connected
adb devices   # should show your device
cd bridge && npm install
cp .env.example .env   # edit with your secret
npm start
```

Then in Telegram:
```
/connectphone https://<your-ngrok-url> <your-bridge-secret>
```

---

## Bot Commands

### Onboarding
| Command | Description |
|---------|-------------|
| `/start` | Begin onboarding — asks your name (required), then lets you proceed through all preferences, skip all with defaults, or pick specific ones to configure |

### General
| Command | Description |
|---------|-------------|
| `/help` | Show all available commands |
| `/profile` | View your saved profile |
| `/setprofile <field> \| <value>` | Update a profile field (`name`, `profession`, `city`, `interests`, `style`) |
| `/reset` | Clear conversation history |
| `/deleteaccount` | Permanently delete your account and all data (requires confirmation) |

### Quota, Rate Limit & Usage
| Command | Description |
|---------|-------------|
| `/usage` | Check your daily token usage and rate limit |
| `/requestquota <reason>` | Request more daily tokens (admin gets notified) |
| `/requestlimit <reason>` | Request higher rate limit (admin gets notified) |

### Personas
| Command | Description |
|---------|-------------|
| `/personas` | List built-in personas plus your custom ones |
| `/persona use <id>` | Switch the bot to a persona (e.g. `ceo`, `hr`, `mentor`, `coach`, `listener`) |
| `/persona clear` | Return to default profile-based behaviour |
| `/persona create <id> \| <name> \| <role>` | Guided creation of a custom persona |
| `/persona clone <built-in-id> <new-id>` | Clone a built-in persona to edit |
| `/persona show <id>` | View a persona's full configuration |
| `/persona edit <id> <field> \| <value>` | Update one field on a custom persona |
| `/persona delete <id>` | Delete a custom persona |

Built-in personas: `ceo` (CEO Advisor), `hr` (HR Partner), `mentor` (Technical Mentor), `coach` (Writing Coach), `listener` (Reflective Listener). Daily briefings ignore the active persona so news doesn't get rewritten in-character.

### News
| Command | Description |
|---------|-------------|
| `/news` | Fetch your personalised news briefing (3 tokens) |

### Email
| Command | Description |
|---------|-------------|
| `/connectmail` | Connect an email account |
| `/accounts` | List all connected accounts (star marks default) |
| `/setdefault email@address` | Change the default account |
| `/disconnectmail` | Disconnect (auto if one account; shows list if multiple) |
| `/disconnectmail email@address` | Disconnect a specific account |
| `/mails` | Fetch and analyse emails from your default account (3 tokens) |
| `/mails email@address` | Fetch from a specific account (3 tokens) |
| `/readmail <number>` | Read the full body of email #N from your last `/mails` fetch (free) |
| `/send <to> \| <subject> \| <body>` | Send an email from your default account (1 token) |

### Preferences
| Command | Description |
|---------|-------------|
| `/preferences` | View all current preferences |
| `/setpref newscount \| 15` | Total news articles to fetch (1-50, default: 10) |
| `/setpref newscategories \| technology, sports` | News categories to follow |
| `/setpref emailcount \| 30` | Emails to fetch per `/mails` (1-100, default: 10) |
| `/setpref emailfocus \| jobs, newsletters` | Email categories the AI focuses on |

**Valid news categories:** `technology`, `business`, `sports`, `health`, `science`, `entertainment`, `general`

**Valid email focus areas:** `jobs`, `finance`, `newsletters`, `promotions`, `social`, `updates`, `all`

### Files
| Command | Description | Tokens |
|---------|-------------|--------|
| [send any file] | Upload PDF, DOCX, TXT, CSV, XLSX, or image — auto read + AI suggestions | 3 |
| `/files` | List all saved files with summaries and active status | 0 |
| `/activefile <name>` | Include a file in your chat context | 0 |
| `/inactivefile <name>` | Remove a file from chat context | 0 |
| `/download <name>` | Generate and receive an updated file in its original format | 2 |
| `/removefile <name>` | Delete a file permanently (MongoDB + GridFS) | 0 |
| `/clearfiles` | Delete all saved files | 0 |

**Supported file types:** PDF, DOCX/DOC, TXT, MD, CSV, XLSX, JPG, PNG, WEBP

**File context:** Files marked as active are automatically included in every chat — the AI references them when relevant and proactively suggests improvements.

### Daily Briefing (9:00 AM IST)
| Command | Description |
|---------|-------------|
| `/briefing` | View your current daily briefing settings |
| `/setbriefing both` | Receive news + mails |
| `/setbriefing news` | News only |
| `/setbriefing mails` | Mails only |
| `/setbriefing none` | Disable daily briefing |

**Briefing types:** `both` (news + mails), `news` (news only), `mails` (mails only), `none` (off)

All briefings are sent at **9:00 AM IST** daily.

### Phone Control
| Command | Description |
|---------|-------------|
| `/connectphone <url> <secret>` | Link your phone's bridge server |
| `/disconnectphone` | Unlink your phone bridge |
| `/apps` | Show installed apps and manage allow/block permissions |
| `/phoneaccess all` | Allow all apps (default) |
| `/phoneaccess only <package>` | Restrict to specific apps (repeatable) |
| `/phone <task>` | Execute a natural language task on your phone (5 tokens) |

**How phone control works:**
1. Run the bridge server on your phone (Termux) or PC (ADB over USB)
2. Connect via `/connectphone` — the bot verifies the connection and syncs your app list
3. Send `/phone Open WhatsApp and send hello to Mom`
4. The bot takes a screenshot, asks Gemini Vision what to do, executes the action, and repeats — up to 20 steps
5. You get live progress updates in Telegram as each step runs

### Admin Commands (Telegram)

Only work when sent by `ADMIN_CHAT_ID`. Non-admin users get an error message.

| Command | Description |
|---------|-------------|
| `/adminhelp` | Show all admin commands |
| `/users` | List last 20 active users |
| `/userinfo <chatId>` | Full profile of any user |
| `/stats` | Overall bot statistics |
| `/setquota <chatId> <amount>` | Set a user's daily token limit |
| `/resetquota <chatId>` | Reset a user's usage to 0 today |
| `/denyquota <chatId>` | Deny a pending quota request |
| `/ban <chatId> <reason>` | Ban a user |
| `/unban <chatId>` | Unban a user |
| `/warn <chatId> <message>` | Send a warning to a user |
| `/setlimit <chatId> <amount>` | Set a user's rate limit (requests/min) |
| `/denylimit <chatId>` | Deny a rate limit request |
| `/phoneusers` | List all users with phone access enabled |
| `/disablephone <chatId>` | Remotely disable phone access for a user |

---

## Supported Email Providers

| Provider | Auth | Notes |
|----------|------|-------|
| Gmail | OAuth 2.0 | Requires Google Cloud Console setup |
| Outlook / Hotmail | OAuth 2.0 | Requires Azure App Registration |
| Yahoo Mail | App Password (IMAP) | Generate at yahoo.com/account/security |
| Apple iCloud | App Password (IMAP) | Generate at appleid.apple.com |
| Zoho, Fastmail, other | App Password (IMAP) | Provide your own IMAP server address |

Multiple accounts per user are supported across different providers simultaneously.

---

## Cron Jobs

One cron is configured in `vercel.json` (Hobby plan compatible) and protected by `CRON_SECRET`:

```json
{
  "crons": [
    { "path": "/api/cron", "schedule": "30 3 * * *" }
  ]
}
```

### Daily Cron (`/api/cron`)

Runs once daily at **3:30 UTC (9:00 AM IST)**. Performs two tasks in sequence:

**1. Daily briefings** — for each onboarded user:
- Checks `briefing.type` — skips if `none`
- Fetches only what the user wants (news, mails, or both)
- Deduplicates emails across multiple accounts
- Generates a personalised AI summary
- Sends it to their Telegram chat
- Deducts 3 tokens from quota

One user's failure does not affect other users' briefings.

**2. Quota reset** — resets `quotaUsed` to 0 and clears pending quota request flags for all users.

---

## Token Quota System

Protects the Gemini free tier across all users.

### Token Costs
| Action | Tokens | Gemini model used |
|--------|--------|-------------------|
| Chat message | 1 | Flash-Lite |
| `/news` | 3 | Flash |
| `/mails` | 3 | Flash |
| `/readmail` | 0 | None (reads from cache) |
| `/send` | 1 | None |
| File upload | 3 | Flash (text/vision analysis) |
| `/download` | 2 | None (generates file from saved text) |
| `/phone` task | 5 | Flash (vision) |
| Daily cron briefing | 3 | Flash |

### Default Quotas
| User type | Daily limit |
|-----------|------------|
| Admin | Unlimited (bypassed) |
| Normal user | 10 tokens/day |
| Trusted user | 30 tokens/day (set via `/setquota`) |
| Throttled user | 2 tokens/day (set via `/setquota`) |
| Banned | Blocked entirely |

Users get a warning when they have 3 or fewer tokens remaining, and a block message with `/requestquota` prompt when exhausted.

---

## Rate Limiting

Each user has a per-minute request limit (default: 5 requests/min). Admin is exempt.

- Users who exceed their limit get a cooldown message with retry time
- Users can request a higher limit via `/requestlimit`
- Admin can approve via `/setlimit` or deny via `/denylimit`
- Rate limit is stored per-user in MongoDB (persists across serverless invocations)

---

## Web Admin Dashboard

Visit `https://<your-app>.vercel.app/admin` — protected by HTTP basic auth using `ADMIN_USERNAME` and `ADMIN_SECRET` env vars.

Features:
- Stats bar (total, active, banned, email connected, pending quota requests)
- Search users by name, chatId, or email
- Inline editing of daily quota limit and user status (active/warned/banned)

---

## Local Development

```bash
npm install
npm run dev
```

Use [ngrok](https://ngrok.com) to expose your local server and update the Telegram webhook URL for local testing. Remember to point it back to Vercel when done.

---

## Credential Encryption

All sensitive credentials stored in MongoDB are encrypted at rest using AES-256-GCM:

| Field | Provider |
|-------|----------|
| `oauthAccessToken` | Gmail, Outlook |
| `oauthRefreshToken` | Gmail, Outlook |
| `imapPassword` | Yahoo, iCloud, other IMAP |

Encryption is transparent — tokens are decrypted in memory only when making API calls, and re-encrypted before being written back on refresh.

**Generate your key (required before first deploy):**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Add the output as `ENCRYPTION_KEY` in `.env.local` and Vercel environment variables.

**Health check** — visit `/api/health` to verify both database connectivity and encryption are operational.

### Migrating an existing installation

If you already have users with plain-text credentials in MongoDB, run the one-time migration script after setting `ENCRYPTION_KEY`:

```bash
ENCRYPTION_KEY=<your-key> MONGODB_URI=<your-uri> node scripts/migrateEncryption.js
```

The script skips any values that are already encrypted, so it is safe to re-run.

---

## Security Notes

- Never commit `.env.local` or `bridge/.env` to version control
- All bridge endpoints (except `/health`) are protected by `x-bridge-secret` header
- OAuth tokens and IMAP passwords are encrypted in MongoDB using AES-256-GCM
- Admin commands are gated by `ADMIN_CHAT_ID` — non-admins cannot access them
- The web dashboard is protected by HTTP basic auth
- Cron endpoints require `CRON_SECRET` bearer token
- Phone agent respects per-user `allowedApps` permissions
