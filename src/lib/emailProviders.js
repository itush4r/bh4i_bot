export const PROVIDER_CONFIG = {
  gmail: {
    type: "oauth",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    smtpHost: "smtp.gmail.com",
    smtpPort: 587,
  },
  outlook: {
    type: "oauth",
    imapHost: "outlook.office365.com",
    imapPort: 993,
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
  },
  yahoo: {
    type: "imap",
    imapHost: "imap.mail.yahoo.com",
    imapPort: 993,
    smtpHost: "smtp.mail.yahoo.com",
    smtpPort: 587,
  },
  icloud: {
    type: "imap",
    imapHost: "imap.mail.me.com",
    imapPort: 993,
    smtpHost: "smtp.mail.me.com",
    smtpPort: 587,
  },
  other: {
    type: "imap",
    imapHost: null,
    imapPort: 993,
    smtpHost: null,
    smtpPort: 587,
  },
};
