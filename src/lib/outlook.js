const { ConfidentialClientApplication } = require("@azure/msal-node");
const { Client } = require("@microsoft/microsoft-graph-client");

const msalConfig = {
  auth: {
    clientId: process.env.OUTLOOK_CLIENT_ID,
    clientSecret: process.env.OUTLOOK_CLIENT_SECRET,
    authority: `https://login.microsoftonline.com/${process.env.OUTLOOK_TENANT_ID}`,
  },
};

async function getAccessToken() {
  const cca = new ConfidentialClientApplication(msalConfig);

  const result = await cca.acquireTokenByRefreshToken({
    refreshToken: process.env.OUTLOOK_REFRESH_TOKEN,
    scopes: ["https://graph.microsoft.com/.default"],
  });

  return result.accessToken;
}

function getGraphClient(accessToken) {
  return Client.init({
    authProvider: (done) => done(null, accessToken),
  });
}

/**
 * Fetch the last N emails from Outlook via Microsoft Graph API.
 * Returns an array of { subject, sender, preview, timestamp }.
 */
async function getRecentEmails(count = 10) {
  const accessToken = await getAccessToken();
  const client = getGraphClient(accessToken);

  const response = await client
    .api("/me/messages")
    .top(count)
    .select("subject,from,bodyPreview,receivedDateTime")
    .orderby("receivedDateTime desc")
    .get();

  return response.value.map((msg) => ({
    subject: msg.subject,
    sender: msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || "Unknown",
    preview: msg.bodyPreview?.slice(0, 200) || "",
    timestamp: msg.receivedDateTime,
  }));
}

/**
 * Send an email via Microsoft Graph API.
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} body - Email body (plain text)
 */
async function sendEmail(to, subject, body) {
  const accessToken = await getAccessToken();
  const client = getGraphClient(accessToken);

  const mail = {
    message: {
      subject: subject,
      body: {
        contentType: "Text",
        content: body,
      },
      toRecipients: [
        {
          emailAddress: {
            address: to,
          },
        },
      ],
    },
    saveToSentItems: "true",
  };

  await client.api("/me/sendMail").post(mail);
}

module.exports = { getRecentEmails, sendEmail };
