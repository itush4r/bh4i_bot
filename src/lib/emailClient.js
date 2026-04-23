import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { google } from "googleapis";
import User from "../models/User";
import { encrypt, decrypt } from "./encryption";

// ─── IMAP: Verify connection ──────────────────────────────────────
export async function verifyImapConnection({ host, port, email, password }) {
  const client = new ImapFlow({
    host,
    port,
    secure: true,
    auth: { user: email, pass: password },
    logger: false,
  });
  await client.connect();
  await client.logout();
}

// ─── IMAP: Fetch emails ───────────────────────────────────────────
export async function fetchEmailsImap({ host, port, email, password, limit = 10 }) {
  const client = new ImapFlow({
    host,
    port,
    secure: true,
    auth: { user: email, pass: password },
    logger: false,
  });

  await client.connect();
  const emails = [];

  const mailbox = await client.mailboxOpen("INBOX");
  const total   = mailbox.exists;
  const start   = Math.max(1, total - limit + 1);

  for await (const msg of client.fetch(`${start}:*`, { envelope: true, bodyStructure: true, source: { maxBytes: 5000 } })) {
    let body = "";
    if (msg.source) {
      const raw = msg.source.toString();
      // Extract text after the blank line separating headers from body
      const bodyStart = raw.indexOf("\r\n\r\n");
      if (bodyStart !== -1) {
        body = raw.slice(bodyStart + 4, bodyStart + 2004).replace(/<[^>]+>/g, "").trim();
      }
    }
    emails.push({
      subject: msg.envelope.subject,
      from:    msg.envelope.from?.[0]?.address,
      sender:  msg.envelope.from?.[0]?.name || msg.envelope.from?.[0]?.address,
      date:    msg.envelope.date,
      preview: body.slice(0, 200),
      body:    body,
    });
  }

  await client.logout();
  return emails;
}

// ─── SMTP: Send email ─────────────────────────────────────────────
export async function sendEmailSmtp({ host, port, email, password, to, subject, body }) {
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: false,
    auth: { user: email, pass: password },
  });
  await transporter.sendMail({ from: email, to, subject, text: body });
}

// ─── Gmail: Fetch emails ──────────────────────────────────────────
export async function fetchEmailsGmail(account, chatId, count = 10) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    access_token:  decrypt(account.oauthAccessToken),
    refresh_token: decrypt(account.oauthRefreshToken),
    expiry_date:   account.oauthTokenExpiry?.getTime(),
  });

  oauth2Client.on("tokens", async (tokens) => {
    await User.updateOne(
      { chatId: String(chatId) },
      {
        $set: {
          "emailAccounts.$[acct].oauthAccessToken": encrypt(tokens.access_token),
          "emailAccounts.$[acct].oauthTokenExpiry": new Date(tokens.expiry_date),
        },
      },
      { arrayFilters: [{ "acct._id": account._id }] }
    );
  });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  const list  = await gmail.users.messages.list({ userId: "me", maxResults: count, q: "in:inbox" });

  const emails = await Promise.all(
    (list.data.messages || []).map(async (msg) => {
      const full = await gmail.users.messages.get({
        userId: "me",
        id: msg.id,
        format: "full",
        metadataHeaders: ["Subject", "From", "Date"],
      });
      const headers = full.data.payload.headers;
      const snippet = full.data.snippet || "";

      // Extract plain text body from payload
      let body = "";
      const payload = full.data.payload;
      if (payload.body?.data) {
        body = Buffer.from(payload.body.data, "base64url").toString("utf-8");
      } else if (payload.parts) {
        const textPart = payload.parts.find((p) => p.mimeType === "text/plain");
        if (textPart?.body?.data) {
          body = Buffer.from(textPart.body.data, "base64url").toString("utf-8");
        }
      }

      return {
        subject: headers.find((h) => h.name === "Subject")?.value,
        from:    headers.find((h) => h.name === "From")?.value,
        sender:  headers.find((h) => h.name === "From")?.value,
        date:    headers.find((h) => h.name === "Date")?.value,
        preview: snippet.slice(0, 200),
        body:    body.slice(0, 3000),
      };
    })
  );

  return emails;
}

// ─── Gmail: Send email ────────────────────────────────────────────
export async function sendEmailGmail(account, { to, subject, body }) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    access_token:  decrypt(account.oauthAccessToken),
    refresh_token: decrypt(account.oauthRefreshToken),
  });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  const raw   = Buffer.from(`To: ${to}\r\nSubject: ${subject}\r\n\r\n${body}`).toString("base64url");
  await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
}

// ─── Outlook: Token refresh ───────────────────────────────────────
async function refreshOutlookToken(account, chatId) {
  if (account.oauthTokenExpiry > new Date(Date.now() + 5 * 60 * 1000)) {
    return decrypt(account.oauthAccessToken);
  }

  const res = await fetch(
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     process.env.OUTLOOK_CLIENT_ID,
        client_secret: process.env.OUTLOOK_CLIENT_SECRET,
        refresh_token: decrypt(account.oauthRefreshToken),
        grant_type:    "refresh_token",
        scope:         "Mail.Read Mail.Send offline_access",
      }),
    }
  );

  const tokens = await res.json();
  if (!tokens.access_token) throw new Error("Outlook token refresh failed");

  await User.updateOne(
    { chatId: String(chatId) },
    {
      $set: {
        "emailAccounts.$[acct].oauthAccessToken": encrypt(tokens.access_token),
        "emailAccounts.$[acct].oauthTokenExpiry": new Date(Date.now() + tokens.expires_in * 1000),
        ...(tokens.refresh_token && {
          "emailAccounts.$[acct].oauthRefreshToken": encrypt(tokens.refresh_token),
        }),
      },
    },
    { arrayFilters: [{ "acct._id": account._id }] }
  );

  return tokens.access_token;
}

// ─── Outlook: Fetch emails ────────────────────────────────────────
export async function fetchEmailsOutlook(account, chatId, count = 10) {
  const token = await refreshOutlookToken(account, chatId);

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages?$top=${count}&$select=subject,from,receivedDateTime,bodyPreview,body`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  const data = await res.json();
  return (data.value || []).map((m) => ({
    subject: m.subject,
    from:    m.from?.emailAddress?.address,
    sender:  m.from?.emailAddress?.name || m.from?.emailAddress?.address,
    date:    m.receivedDateTime,
    preview: (m.bodyPreview || "").slice(0, 200),
    body:    (m.body?.content || "").replace(/<[^>]+>/g, "").slice(0, 3000),
  }));
}

// ─── Outlook: Send email ──────────────────────────────────────────
export async function sendEmailOutlook(account, chatId, { to, subject, body }) {
  const token = await refreshOutlookToken(account, chatId);

  await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject,
        body:         { contentType: "Text", content: body },
        toRecipients: [{ emailAddress: { address: to } }],
      },
    }),
  });
}

// ─── Universal router ─────────────────────────────────────────────
export async function fetchEmails(account, chatId, count = 10) {
  switch (account.provider) {
    case "gmail":
      return fetchEmailsGmail(account, chatId, count);
    case "outlook":
      return fetchEmailsOutlook(account, chatId, count);
    default:
      return fetchEmailsImap({
        host:     account.imapHost,
        port:     account.imapPort,
        email:    account.emailAddress,
        password: decrypt(account.imapPassword),
        limit:    count,
      });
  }
}

export async function sendEmail(account, chatId, { to, subject, body }) {
  switch (account.provider) {
    case "gmail":
      return sendEmailGmail(account, { to, subject, body });
    case "outlook":
      return sendEmailOutlook(account, chatId, { to, subject, body });
    default:
      return sendEmailSmtp({
        host:     account.smtpHost,
        port:     account.smtpPort,
        email:    account.emailAddress,
        password: decrypt(account.imapPassword),
        to, subject, body,
      });
  }
}
