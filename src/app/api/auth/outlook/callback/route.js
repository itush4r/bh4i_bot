import { NextResponse } from "next/server";
import dbConnect from "../../../../../lib/db";
import User from "../../../../../models/User";
import { sendTelegramMessage } from "../../../../../lib/telegram";
import { encrypt } from "../../../../../lib/encryption";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code   = searchParams.get("code");
  const chatId = searchParams.get("state");

  if (!code || !chatId) {
    return NextResponse.json({ error: "Missing code or state" }, { status: 400 });
  }

  const tokenRes = await fetch(
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     process.env.OUTLOOK_CLIENT_ID,
        client_secret: process.env.OUTLOOK_CLIENT_SECRET,
        code,
        redirect_uri:  process.env.OUTLOOK_REDIRECT_URI,
        grant_type:    "authorization_code",
      }),
    }
  );

  const tokens = await tokenRes.json();

  if (!tokens.access_token) {
    return NextResponse.json({ error: "Token exchange failed", detail: tokens }, { status: 500 });
  }

  const meRes = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const me = await meRes.json();
  const emailAddress = me.mail || me.userPrincipalName;

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
          "emailAccounts.$[acct].oauthTokenExpiry":  new Date(Date.now() + tokens.expires_in * 1000),
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
            provider:          "outlook",
            emailAddress,
            isDefault,
            oauthAccessToken:  encrypt(tokens.access_token),
            oauthRefreshToken: encrypt(tokens.refresh_token),
            oauthTokenExpiry:  new Date(Date.now() + tokens.expires_in * 1000),
          },
        },
        $set: { emailSetupPending: false },
      }
    );
  }

  const isFirst = freshUser.emailAccounts.length === 0;
  await sendTelegramMessage(
    `✅ *Outlook connected!*\n\nAccount: ${emailAddress}${isFirst ? " ⭐ (set as default)" : ""}\n\nUse /mails to check your emails.`,
    chatId
  );

  return NextResponse.redirect(new URL("/connected", request.url));
}
