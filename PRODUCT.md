# AI Assistant — Telegram Bot

> Your personal AI assistant that lives in Telegram. Reads your emails, delivers daily news, controls your Android phone, and chats with full context — all personalised to you.

---

## What Does It Do?

Most people check 3–5 apps every morning just to start their day — email, news, messages, calendar. This bot collapses all of that into a single Telegram conversation.

You send it a message. It responds like a personal assistant who knows your name, your job, your city, and exactly how you like information delivered.

**In a typical day you might:**

- Wake up to a 9 AM briefing with your emails categorised and your news summarised — automatically, every day
- Ask it to read a specific email in full
- Tell it to send an email on your behalf
- Ask "what's happening in tech today?" and get a sharp 10-point summary
- Say "open WhatsApp and send hello to Mom" — and watch your phone do it

---

## Features

### 🤖 Personalised AI Chat
Every response is shaped by your profile — name, profession, city, interests, and preferred response style. The AI writes like a personal assistant who knows you, not a generic chatbot. Conversation history is stored in MongoDB so context persists across sessions.

### 🎭 Switchable Personas
Need a CEO's framing on a strategy question? An HR partner's read on a tricky people problem? A reflective listener instead of an advice-giver? Switch the bot's persona on the fly. Five built-ins ship out of the box (CEO Advisor, HR Partner, Technical Mentor, Writing Coach, Reflective Listener), and you can build your own — `/persona create my-coach | Sales Coach | VP Sales` walks you through it. Daily briefings stay neutral so news doesn't get rewritten "as a CEO."

### 📧 Multi-Account Email
Connect Gmail, Outlook, Yahoo, iCloud, or any IMAP provider. Manage multiple accounts simultaneously. The AI categorises your inbox — jobs, finance, newsletters, promotions — and surfaces only what you care about. Read any email in full with `/readmail`. Send emails directly from Telegram.

### 📰 Personalised News
Choose your categories (technology, business, sports, health, science, entertainment, general) and how many articles you want. Every briefing is rewritten by Gemini to highlight what matters to you specifically — not just raw headlines.

### ⏰ Automatic Daily Briefing
Every morning at 9:00 AM IST, the bot sends you a combined email + news summary — without you doing anything. Choose what you receive: news only, emails only, both, or turn it off entirely.

### 📱 Android Phone Control
The most unique feature. Connect your Android phone via a lightweight bridge server (runs in Termux on the phone itself — no PC needed). Then control it in plain English:

```
/phone Open Spotify and play my liked songs
/phone Check my WhatsApp messages from today
/phone Take a screenshot and describe what's on screen
```

The bot takes a screenshot, asks Gemini Vision what to do, executes the action, and repeats — up to 20 steps. You get live progress updates as it works.

### 🔒 Private by Design
- Every user's data is fully isolated — no one can see anyone else's data
- OAuth tokens and IMAP passwords are encrypted at rest using AES-256-GCM
- Plaintext credentials never touch the database
- Users can permanently delete all their data with `/deleteaccount`

### 💬 UX That Doesn't Leave You Hanging
- **Cancel anytime** — type `cancel`, `stop`, or `exit` during any multi-step flow (onboarding, email setup, account deletion). Every prompt reminds you.
- **Typo correction** — type `/mail` instead of `/mails`? The bot suggests the right command instead of treating it as chat.
- **Always shows what to type next** — every explanation ends with the exact command in backticks. No "you can configure this" without showing how.
- **Typing indicators** — the bot shows "typing..." for every operation, refreshed every 4 seconds for long tasks like email fetches.
- **Timeout protection** — long-running operations fail gracefully with a retry message instead of silently dying.

### ⚙️ Full Admin Control
You run the bot, you control it:
- Set daily token limits per user
- Ban, warn, or unban users from Telegram
- Approve or deny quota increase requests
- View all users and stats in a web dashboard
- Remotely disable any user's phone access

---

## How It Works — 60 Second Version

1. User finds the bot on Telegram and sends `/start`
2. Bot asks for their name (required) then walks them through preferences — or they can skip all and use defaults
3. User connects their email with `/connectmail` (OAuth link for Gmail/Outlook, app password for others)
4. From that point, they have a fully personalised assistant available 24/7

No app to install. No account to create. Just Telegram.

---

## Who Is This For?

**As a user:**
- Professionals who get a lot of email and want AI to cut through the noise
- Anyone who wants a smarter morning briefing than scrolling through apps
- Android users who want to automate their phone with plain English
- People who live in Telegram and want their assistant there too

**As a buyer / builder:**
- A developer who wants a production-ready AI bot foundation to build on
- A team that wants to white-label this for their users
- An indie maker who wants to launch a SaaS without building from scratch
- Anyone who sees the potential and wants to own the asset

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js (App Router) on Vercel |
| Database | MongoDB Atlas |
| AI | Google Gemini 2.5 Flash + Flash-Lite |
| Vision AI | Gemini Flash (phone control screenshots) |
| Email OAuth | Gmail API, Microsoft Graph API |
| Email IMAP | imapflow + nodemailer |
| News | NewsAPI |
| Bot | Telegram Bot API (webhook mode) |
| Phone Bridge | Express + ADB (Termux or USB) |
| Tunnelling | ngrok |
| Encryption | Node.js AES-256-GCM (zero new dependencies) |
| Hosting | Vercel (runs on free Hobby plan) |

---

## What's Included in a Full Handover

✅ Complete source code (Next.js app + standalone bridge server)  
✅ Detailed README with step-by-step setup guide  
✅ OVERVIEW.md — full technical documentation of every system  
✅ All environment variable templates  
✅ One-time migration script for existing data  
✅ Web admin dashboard (built-in, no extra setup)  
✅ Setup support — I will help you get it running  

**External accounts you'll need to create (all free):**
- MongoDB Atlas (free M0 tier)
- Telegram Bot (free via @BotFather)
- Google Cloud Console (Gmail OAuth — free)
- Microsoft Azure (Outlook OAuth — free)
- NewsAPI (free tier)
- Vercel (free Hobby plan)
- Google AI Studio (Gemini API key — free tier)

Total cost to run: **$0/month** on free tiers for up to ~20-30 users.

---

## Monetisation Potential

This codebase is already built for multi-user SaaS:

- Per-user daily token quotas (already implemented)
- Admin controls to manage users (already implemented)
- Rate limiting per user (already implemented)
- Ban / warn / unban system (already implemented)

**What you'd add to monetise:**
- Stripe integration for paid tiers (e.g. Free: 10 tokens/day, Pro: 100 tokens/day)
- Higher quota limits for paying users
- Premium features (more email accounts, higher rate limits)

The infrastructure is ready. Monetisation is a Stripe integration away.

---

## Commands Reference

### General
| Command | What it does |
|---------|-------------|
| `/start` | Onboarding — name required, everything else optional |
| `/profile` | View your saved profile |
| `/setprofile field \| value` | Update any profile field |
| `/reset` | Clear conversation history |
| `/deleteaccount` | Permanently delete all your data |

### Personas
| Command | What it does |
|---------|-------------|
| `/personas` | List built-in + your custom personas |
| `/persona use <id>` | Switch the bot to a persona |
| `/persona clear` | Back to default profile-based behavior |
| `/persona create <id> \| <name> \| <role>` | Guided creation of a custom persona |
| `/persona clone <built-in-id> <new-id>` | Clone a built-in to edit |
| `/persona edit <id> <field> \| <value>` | Update one field on a custom persona |
| `/persona delete <id>` | Remove a custom persona |

### Email
| Command | What it does |
|---------|-------------|
| `/connectmail` | Connect Gmail, Outlook, Yahoo, iCloud, or any IMAP |
| `/mails` | Fetch and AI-analyse your inbox |
| `/readmail 3` | Read email #3 in full |
| `/send to \| subject \| body` | Send an email |
| `/accounts` | List connected accounts |

### News & Briefing
| Command | What it does |
|---------|-------------|
| `/news` | Get your personalised news briefing |
| `/setbriefing both/news/mails/none` | Control your daily briefing |

### Phone Control
| Command | What it does |
|---------|-------------|
| `/connectphone url secret` | Link your Android phone |
| `/phone <task>` | Control phone with plain English |
| `/apps` | Manage which apps the bot can access |

### Files
| Command | What it does |
|---------|-------------|
| [send any file] | Upload PDF, DOCX, TXT, CSV, XLSX, or image — AI reads and gives feedback |
| `/files` | List saved files with summaries |
| `/activefile name` | Include file in chat context |
| `/download name` | Get an updated copy of the file |
| `/removefile name` | Delete a file permanently |

### Usage
| Command | What it does |
|---------|-------------|
| `/usage` | Check daily token usage |
| `/requestquota reason` | Request more daily tokens |
| `/preferences` | View and update all preferences |

---

## Interested?

**To use the bot:** [Open in Telegram →](https://t.me/itush4r_bot)

**To buy this project:** Reach out via:
- GitHub: [github.com/itush4r](https://github.com/itush4r)
- Gumroad: [coming soon]
- Email: tushar8650@outlook.com

Full handover includes source code, documentation, and setup support.