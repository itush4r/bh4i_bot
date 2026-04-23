import User from "../models/User";
import { PROVIDER_CONFIG } from "./emailProviders";
import { sendTelegramMessage } from "./telegram";
import { verifyImapConnection } from "./emailClient";
import { encrypt } from "./encryption";
import { isEscapeInput, sendEscapeMessage } from "./flowUtils";

const ESCAPE_HINT = "\n\n_Type_ `cancel` _anytime to stop._";

function buildGmailAuthUrl(chatId) {
  return (
    `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${process.env.GMAIL_CLIENT_ID}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(process.env.GMAIL_REDIRECT_URI)}` +
    `&scope=${encodeURIComponent("https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send")}` +
    `&access_type=offline` +
    `&prompt=consent` +
    `&state=${chatId}`
  );
}

function buildOutlookAuthUrl(chatId) {
  return (
    `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
    `client_id=${process.env.OUTLOOK_CLIENT_ID}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(process.env.OUTLOOK_REDIRECT_URI)}` +
    `&scope=${encodeURIComponent("Mail.Read Mail.Send offline_access")}` +
    `&state=${chatId}`
  );
}

function getAppPasswordGuide(provider) {
  const guides = {
    yahoo:  "yahoo.com/account/security → App passwords",
    icloud: "appleid.apple.com → Sign-In & Security → App passwords",
    other:  "Check your email provider's security settings",
  };
  return guides[provider] || guides.other;
}

export async function handleEmailSetup(user, text, chatId) {
  // Allow escape at any step
  if (isEscapeInput(text)) {
    await User.updateOne(
      { chatId: String(chatId) },
      {
        $set: {
          emailSetupPending: false,
          emailSetupStep:    0,
          emailProviderTemp: null,
          emailAddressTemp:  null,
          imapHostTemp:      null,
        },
      }
    );
    await sendEscapeMessage(chatId, "emailSetup");
    return;
  }

  const step  = user.emailSetupStep;
  const input = text.trim().toLowerCase();

  // Step 0 — choose provider
  if (step === 0) {
    const validProviders = ["gmail", "outlook", "yahoo", "icloud", "other"];
    if (!validProviders.includes(input)) {
      await sendTelegramMessage(
        "❌ Please reply with: gmail / outlook / yahoo / icloud / other",
        chatId
      );
      return;
    }

    const config = PROVIDER_CONFIG[input];

    if (config.type === "oauth") {
      await User.updateOne(
        { chatId: String(chatId) },
        { $set: { emailSetupPending: false, emailProviderTemp: input } }
      );

      const authUrl = input === "gmail"
        ? buildGmailAuthUrl(chatId)
        : buildOutlookAuthUrl(chatId);

      await sendTelegramMessage(
        `🔐 Click below to connect your ${input} account:\n\n[Connect ${input}](${authUrl})\n\n_Personal link — do not share._`,
        chatId
      );
      return;
    }

    // IMAP providers — start conversation
    await User.updateOne(
      { chatId: String(chatId) },
      { $set: { emailSetupStep: 1, emailProviderTemp: input } }
    );

    await sendTelegramMessage(`📧 Enter your *${input}* email address:` + ESCAPE_HINT, chatId);
    return;
  }

  // Step 1 — collect email address (IMAP only)
  if (step === 1) {
    if (!text.includes("@")) {
      await sendTelegramMessage("❌ That doesn't look like a valid email. Try again:", chatId);
      return;
    }

    const provider = user.emailProviderTemp;

    await User.updateOne(
      { chatId: String(chatId) },
      {
        $set: {
          emailAddressTemp: text.trim(),
          emailSetupStep:   provider === "other" ? 2 : 3,
        },
      }
    );

    if (provider === "other") {
      await sendTelegramMessage(
        "Enter your IMAP server address:\n(e.g. `imap.zoho.com`)" + ESCAPE_HINT,
        chatId
      );
      return;
    }

    await sendTelegramMessage(
      `🔑 Enter your *app password* for ${provider}.\n\n` +
      `⚠️ This is NOT your main password.\nGenerate one here:\n${getAppPasswordGuide(provider)}` +
      ESCAPE_HINT,
      chatId
    );
    return;
  }

  // Step 2 — collect IMAP server (only for "other")
  if (step === 2 && user.emailProviderTemp === "other") {
    await User.updateOne(
      { chatId: String(chatId) },
      {
        $set: {
          imapHostTemp:   text.trim(),
          emailSetupStep: 3,
        },
      }
    );

    await sendTelegramMessage(
      "🔑 Enter your *app password* (or account password if IMAP is enabled):" + ESCAPE_HINT,
      chatId
    );
    return;
  }

  // Step 3 — collect app password + verify + commit
  if (step === 3) {
    await sendTelegramMessage("⏳ Verifying connection...", chatId);

    const provider = user.emailProviderTemp;
    const config   = PROVIDER_CONFIG[provider];

    const resolvedImapHost = user.imapHostTemp || config.imapHost;
    const resolvedSmtpHost = user.imapHostTemp
      ? user.imapHostTemp.replace("imap", "smtp")
      : config.smtpHost;

    try {
      await verifyImapConnection({
        host:     resolvedImapHost,
        port:     config.imapPort,
        email:    user.emailAddressTemp,
        password: text.trim(),
      });

      // Determine if this will be the first (default) account
      const freshUser = await User.findOne({ chatId: String(chatId) });
      const isDefault = freshUser.emailAccounts.length === 0;

      await User.updateOne(
        { chatId: String(chatId) },
        {
          $push: {
            emailAccounts: {
              provider,
              emailAddress: user.emailAddressTemp,
              isDefault,
              imapHost:     resolvedImapHost,
              imapPort:     config.imapPort,
              smtpHost:     resolvedSmtpHost,
              smtpPort:     config.smtpPort,
              imapPassword: encrypt(text.trim()),
            },
          },
          $set: {
            emailSetupPending: false,
            emailSetupStep:    0,
            emailProviderTemp: null,
            emailAddressTemp:  null,
            imapHostTemp:      null,
          },
        }
      );

      await sendTelegramMessage(
        `✅ *${provider} connected!*\n\nAccount: ${user.emailAddressTemp}${isDefault ? " ⭐ (set as default)" : ""}\n\nUse /mails to check your emails.`,
        chatId
      );
    } catch (err) {
      await User.updateOne(
        { chatId: String(chatId) },
        {
          $set: {
            emailSetupPending: false,
            emailSetupStep:    0,
            emailProviderTemp: null,
            emailAddressTemp:  null,
            imapHostTemp:      null,
          },
        }
      );

      await sendTelegramMessage(
        `❌ Connection failed: ${err.message}\n\nCheck your app password and try /connectmail again.`,
        chatId
      );
    }
    return;
  }
}
