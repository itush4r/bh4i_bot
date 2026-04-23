import { NextResponse } from "next/server";
import dbConnect from "../../../../../lib/db";
import User from "../../../../../models/User";
import { sendTelegramMessage } from "../../../../../lib/telegram";
import { google } from "googleapis";
import { encrypt } from "../../../../../lib/encryption";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code   = searchParams.get("code");
  const chatId = searchParams.get("state");

  if (!code || !chatId) {
    return NextResponse.json({ error: "Missing code or state" }, { status: 400 });
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  const gmail   = google.gmail({ version: "v1", auth: oauth2Client });
  const profile = await gmail.users.getProfile({ userId: "me" });
  const emailAddress = profile.data.emailAddress;

  await dbConnect();
  const freshUser = await User.findOne({ chatId: String(chatId) });

  if (!freshUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const existingIndex = freshUser.emailAccounts.findIndex(
    (a) => a.emailAddress === emailAddress
  );

  if (existingIndex !== -1) {
    // Update tokens for existing account
    await User.updateOne(
      { chatId: String(chatId) },
      {
        $set: {
          "emailAccounts.$[acct].oauthAccessToken":  encrypt(tokens.access_token),
          "emailAccounts.$[acct].oauthRefreshToken": encrypt(tokens.refresh_token),
          "emailAccounts.$[acct].oauthTokenExpiry":  new Date(tokens.expiry_date),
          emailSetupPending: false,
        },
      },
      { arrayFilters: [{ "acct.emailAddress": emailAddress }] }
    );
  } else {
    const isDefault = freshUser.emailAccounts.length === 0;

    await User.updateOne(
      { chatId: String(chatId) },
      {
        $push: {
          emailAccounts: {
            provider:          "gmail",
            emailAddress,
            isDefault,
            oauthAccessToken:  encrypt(tokens.access_token),
            oauthRefreshToken: encrypt(tokens.refresh_token),
            oauthTokenExpiry:  new Date(tokens.expiry_date),
          },
        },
        $set: { emailSetupPending: false },
      }
    );
  }

  const isFirst = freshUser.emailAccounts.length === 0;
  await sendTelegramMessage(
    `✅ *Gmail connected!*\n\nAccount: ${emailAddress}${isFirst ? " ⭐ (set as default)" : ""}\n\nUse /mails to check your emails.`,
    chatId
  );

  return NextResponse.redirect(new URL("/connected", request.url));
}
