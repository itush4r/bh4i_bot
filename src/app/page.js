export const metadata = {
  title: "AI Assistant — Your personal Telegram bot",
  description:
    "Reads your emails, summarises your news, controls your Android phone — all in Telegram. Free to use.",
  openGraph: {
    title: "AI Assistant — Your personal Telegram bot",
    description:
      "Reads your emails, summarises your news, controls your Android phone — all in Telegram.",
    type: "website",
  },
};

const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME || "your_bot";
const GITHUB_URL   = "https://github.com/itush4r/ai-assistant";
const TELEGRAM_URL = `https://t.me/${BOT_USERNAME}`;

const features = [
  {
    icon: "🤖",
    title: "Personalised AI Chat",
    desc: "Remembers your name, job, city, and preferences. Responds like an assistant who knows you — not a generic chatbot.",
  },
  {
    icon: "📧",
    title: "Multi-Account Email",
    desc: "Connect Gmail, Outlook, Yahoo, iCloud, or any IMAP provider. AI categorises your inbox and surfaces what matters.",
  },
  {
    icon: "📰",
    title: "Personalised News",
    desc: "Choose your categories. Get a sharp AI-written briefing every day — not raw headlines, actual summaries.",
  },
  {
    icon: "⏰",
    title: "Daily Briefing at 9 AM",
    desc: "Every morning, your emails and news land in Telegram automatically. No apps to open.",
  },
  {
    icon: "📱",
    title: "Android Phone Control",
    desc: 'Say "/phone Open WhatsApp and send hello to Mom" — the bot takes screenshots, thinks, and acts. Powered by Gemini Vision.',
  },
  {
    icon: "🔒",
    title: "Private by Design",
    desc: "Your data is yours alone. Credentials encrypted with AES-256-GCM. Delete everything anytime with /deleteaccount.",
  },
];

const commands = [
  ["/start",        "7-step personalised setup"],
  ["/mails",        "AI-analyse your inbox (all providers)"],
  ["/readmail 2",   "Read email #2 in full"],
  ["/news",         "Your personalised news briefing"],
  ["/phone <task>", "Control your Android phone in plain English"],
  ["/send",         "Send an email directly from Telegram"],
  ["/usage",        "Check your daily token usage"],
  ["/preferences",  "Customise everything"],
];

const steps = [
  { n: "1", title: "Open the bot",        desc: "Find it on Telegram and send /start" },
  { n: "2", title: "Set up your profile", desc: "Name is required. Everything else is optional — skip all and use defaults" },
  { n: "3", title: "Connect your email",  desc: "Gmail and Outlook use a one-click OAuth link. Yahoo and others use an app password" },
  { n: "4", title: "You're done",         desc: "Your assistant is live. Chat, fetch emails, get news, or control your phone" },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-[#0a0a14] via-[#111827] to-[#0f172a] text-slate-100 overflow-x-hidden">

      {/* Nav */}
      <nav className="max-w-[1100px] mx-auto px-6 py-5 flex items-center justify-between border-b border-white/5">
        <span className="font-extrabold text-lg tracking-tight">🤖 AI Assistant</span>
        <div className="flex items-center gap-5">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-400 text-sm hover:text-slate-200 transition-colors"
          >
            GitHub
          </a>
          <a
            href={TELEGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-blue-400/10 border border-blue-400/30 text-blue-400 px-5 py-2 rounded-full text-sm font-semibold hover:bg-blue-400/20 transition-colors"
          >
            Open Bot →
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-2xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="inline-block bg-blue-400/10 border border-blue-400/20 text-blue-400 px-4 py-1.5 rounded-full text-xs font-semibold tracking-wide mb-6">
          POWERED BY GOOGLE GEMINI
        </div>

        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black leading-tight tracking-tight mb-6">
          Your personal AI assistant{" "}
          <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
            lives in Telegram
          </span>
        </h1>

        <p className="text-base sm:text-lg lg:text-xl text-slate-400 leading-relaxed mb-11 max-w-xl mx-auto">
          Reads your emails, delivers your news, and controls your Android
          phone — all personalised to you, all inside one chat.
        </p>

        <div className="flex flex-wrap gap-3 justify-center">
          <a
            href={TELEGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-gradient-to-r from-blue-600 to-violet-700 text-white px-9 py-4 rounded-full text-base font-bold shadow-[0_8px_32px_rgba(96,165,250,0.25)] hover:opacity-90 transition-opacity"
          >
            Start for free →
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-white/5 border border-white/10 text-slate-200 px-9 py-4 rounded-full text-base font-semibold hover:bg-white/10 transition-colors"
          >
            View source
          </a>
        </div>

        <p className="text-slate-600 text-xs mt-4">
          Free to use · No app to install · Just Telegram
        </p>
      </section>

      {/* Features grid */}
      <section className="max-w-[1060px] mx-auto px-6 pb-20 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {features.map((f) => (
          <div
            key={f.title}
            className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-8"
          >
            <div className="text-4xl mb-4">{f.icon}</div>
            <h3 className="text-base font-bold mb-2">{f.title}</h3>
            <p className="text-slate-400 text-sm leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </section>

      {/* How it works */}
      <section className="max-w-[760px] mx-auto px-6 pb-20 text-center">
        <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight mb-3">
          Up and running in 2 minutes
        </h2>
        <p className="text-slate-500 mb-12">No app to install. No account to create. Just Telegram.</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-left">
          {steps.map((s) => (
            <div
              key={s.n}
              className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-6"
            >
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-600 to-violet-700 flex items-center justify-center font-extrabold text-sm mb-4">
                {s.n}
              </div>
              <h4 className="text-sm font-bold mb-1">{s.title}</h4>
              <p className="text-slate-500 text-xs leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Commands */}
      <section className="max-w-[680px] mx-auto px-6 pb-20">
        <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight mb-8 text-center">
          Everything via commands
        </h2>
        <div className="bg-black/50 border border-white/[0.08] rounded-2xl px-8 py-7 font-mono text-sm leading-[2.1]">
          {commands.map(([cmd, desc]) => (
            <div key={cmd} className="flex flex-wrap gap-x-2">
              <span className="text-blue-400 font-bold">{cmd}</span>
              <span className="text-slate-500">— {desc}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Providers */}
      <section className="max-w-[760px] mx-auto px-6 pb-20 text-center">
        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-3">
          Works with every email provider
        </h2>
        <p className="text-slate-500 mb-9">
          Gmail and Outlook connect in one click. Yahoo, iCloud, and others use an app password.
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          {["Gmail", "Outlook", "Yahoo", "iCloud", "Zoho", "Fastmail", "Any IMAP"].map((p) => (
            <span
              key={p}
              className="bg-white/5 border border-white/10 px-5 py-2 rounded-full text-sm text-slate-300"
            >
              {p}
            </span>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-[680px] mx-auto px-6 pb-24 text-center">
        <div className="bg-gradient-to-br from-blue-600/15 to-violet-700/15 border border-blue-400/20 rounded-3xl px-8 sm:px-16 py-14">
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight mb-3">
            Ready to try it?
          </h2>
          <p className="text-slate-400 text-base mb-9">
            Free to use. No credit card. No app install.
            <br />
            Just open Telegram and start.
          </p>
          <a
            href={TELEGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block bg-gradient-to-r from-blue-600 to-violet-700 text-white px-11 py-4 rounded-full text-lg font-bold shadow-[0_8px_32px_rgba(96,165,250,0.2)] hover:opacity-90 transition-opacity"
          >
            Open in Telegram →
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 text-center py-7 px-6 text-slate-600 text-sm">
        Built by{" "}
        <a
          href="https://github.com/itush4r"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:underline"
        >
          Tushar
        </a>
        {" · "}
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:underline"
        >
          Open source on GitHub
        </a>
        {" · "}
        <a
          href={`${GITHUB_URL}/blob/master/PRODUCT.md`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:underline"
        >
          Buy this project
        </a>
      </footer>
    </main>
  );
}
