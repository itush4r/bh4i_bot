import User from "../models/User";
import { sendTelegramMessage } from "./telegram";

const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

export function isAdmin(chatId) {
  return String(chatId) === String(ADMIN_CHAT_ID);
}

const ADMIN_COMMANDS = [
  "/setquota", "/denyquota", "/ban", "/unban", "/warn",
  "/users", "/userinfo", "/resetquota", "/stats", "/adminhelp",
  "/setlimit", "/denylimit", "/phoneusers", "/disablephone",
];

export function isAdminCommand(text) {
  return ADMIN_COMMANDS.some((cmd) => text === cmd || text.startsWith(cmd + " "));
}

export async function handleAdminCommand(text, chatId) {
  // Block admin commands from non-admins
  if (!isAdmin(chatId)) {
    if (isAdminCommand(text)) {
      await sendTelegramMessage(
        "❌ This command is not available. Please use /help to see available commands.",
        chatId
      );
      return true;
    }
    return false;
  }

  // /setquota <chatId> <amount>
  if (text.startsWith("/setquota")) {
    const [, targetId, amount] = text.split(" ");
    if (!targetId || !amount) {
      await sendTelegramMessage("Usage: /setquota <chatId> <amount>", chatId);
      return true;
    }
    const user = await User.findOneAndUpdate(
      { chatId: targetId },
      { $set: { quotaLimit: parseInt(amount), quotaRequested: false } },
      { new: true }
    );
    if (!user) {
      await sendTelegramMessage(`❌ User ${targetId} not found.`, chatId);
      return true;
    }
    await sendTelegramMessage(
      `✅ Updated ${user.name || targetId}'s daily limit to ${amount} tokens.`,
      chatId
    );
    await sendTelegramMessage(
      `✅ Good news! Your daily quota has been updated to *${amount} tokens/day*.`,
      targetId
    );
    return true;
  }

  // /denyquota <chatId>
  if (text.startsWith("/denyquota")) {
    const [, targetId] = text.split(" ");
    await User.updateOne(
      { chatId: targetId },
      { $set: { quotaRequested: false, quotaRequestNote: null } }
    );
    await sendTelegramMessage(`✅ Quota request denied for ${targetId}.`, chatId);
    await sendTelegramMessage(
      "❌ Your quota request was reviewed and denied. Your current limit remains unchanged.",
      targetId
    );
    return true;
  }

  // /ban <chatId> <reason>
  if (text.startsWith("/ban")) {
    const parts = text.split(" ");
    const targetId = parts[1];
    const reason = parts.slice(2).join(" ") || "Violation of terms";
    await User.updateOne(
      { chatId: targetId },
      { $set: { status: "banned", warningMessage: reason } }
    );
    await sendTelegramMessage(`✅ Banned user ${targetId}. Reason: ${reason}`, chatId);
    await sendTelegramMessage(
      `🚫 Your account has been suspended.\n\nReason: ${reason}`,
      targetId
    );
    return true;
  }

  // /unban <chatId>
  if (text.startsWith("/unban")) {
    const [, targetId] = text.split(" ");
    await User.updateOne(
      { chatId: targetId },
      { $set: { status: "active", warningMessage: null } }
    );
    await sendTelegramMessage(`✅ Unbanned user ${targetId}.`, chatId);
    await sendTelegramMessage(
      "✅ Your account has been reinstated. You can use the bot again.",
      targetId
    );
    return true;
  }

  // /warn <chatId> <message>
  if (text.startsWith("/warn")) {
    const parts = text.split(" ");
    const targetId = parts[1];
    const message = parts.slice(2).join(" ") || "Please follow the usage guidelines.";
    await User.updateOne(
      { chatId: targetId },
      { $set: { status: "warned", warningMessage: message } }
    );
    await sendTelegramMessage(`✅ Warning sent to ${targetId}.`, chatId);
    await sendTelegramMessage(
      `⚠️ *Warning from Admin*\n\n${message}`,
      targetId
    );
    return true;
  }

  // /users — list all users
  if (text === "/users") {
    const users = await User.find({})
      .sort({ lastActiveAt: -1 })
      .limit(20);

    const list = users.map((u, i) =>
      `${i + 1}. ${u.name || "Unknown"} | \`${u.chatId}\`\n` +
      `   Status: ${u.status} | Quota: ${u.quotaUsed}/${u.quotaLimit} | ` +
      `Joined: ${u.joinedAt?.toLocaleDateString("en-IN")}`
    ).join("\n\n");

    await sendTelegramMessage(
      `👥 *All Users (last 20 active)*\n\n${list || "No users yet."}`,
      chatId
    );
    return true;
  }

  // /userinfo <chatId>
  if (text.startsWith("/userinfo")) {
    const [, targetId] = text.split(" ");
    const u = await User.findOne({ chatId: targetId });
    if (!u) {
      await sendTelegramMessage(`❌ User ${targetId} not found.`, chatId);
      return true;
    }
    await sendTelegramMessage(
      `👤 *User Info*\n\n` +
      `Name: ${u.name}\n` +
      `ChatId: \`${u.chatId}\`\n` +
      `Status: ${u.status}\n` +
      `Quota: ${u.quotaUsed}/${u.quotaLimit} today\n` +
      `Total messages: ${u.totalMessagesEver}\n` +
      `Email: ${u.emailAccounts?.[0]?.emailAddress || "Not connected"}\n` +
      `Provider: ${u.emailAccounts?.[0]?.provider || "None"}\n` +
      `Joined: ${u.joinedAt?.toLocaleDateString("en-IN")}\n` +
      `Last active: ${u.lastActiveAt?.toLocaleDateString("en-IN")}\n` +
      `Warning: ${u.warningMessage || "None"}`,
      chatId
    );
    return true;
  }

  // /resetquota <chatId>
  if (text.startsWith("/resetquota")) {
    const [, targetId] = text.split(" ");
    await User.updateOne(
      { chatId: targetId },
      { $set: { quotaUsed: 0, quotaResetDate: new Date() } }
    );
    await sendTelegramMessage(`✅ Quota reset for ${targetId}.`, chatId);
    await sendTelegramMessage(
      "✅ Your daily quota has been reset by admin.",
      targetId
    );
    return true;
  }

  // /stats — overall bot stats
  if (text === "/stats") {
    const total     = await User.countDocuments();
    const active    = await User.countDocuments({ status: "active" });
    const banned    = await User.countDocuments({ status: "banned" });
    const withEmail = await User.countDocuments({ "emailAccounts.0": { $exists: true } });
    const pending   = await User.countDocuments({ quotaRequested: true });

    await sendTelegramMessage(
      `📊 *Bot Stats*\n\n` +
      `Total users: ${total}\n` +
      `Active: ${active}\n` +
      `Banned: ${banned}\n` +
      `Email connected: ${withEmail}\n` +
      `Pending quota requests: ${pending}`,
      chatId
    );
    return true;
  }

  // /adminhelp
  if (text === "/adminhelp") {
    await sendTelegramMessage(
      `🛠 *Admin Commands*\n\n` +
      `/users — List last 20 active users\n` +
      `/userinfo <chatId> — Full user details\n` +
      `/stats — Overall bot statistics\n` +
      `/setquota <chatId> <amount> — Set daily token limit\n` +
      `/resetquota <chatId> — Reset today's usage to 0\n` +
      `/denyquota <chatId> — Deny quota request\n` +
      `/ban <chatId> <reason> — Ban a user\n` +
      `/unban <chatId> — Unban a user\n` +
      `/warn <chatId> <message> — Send warning to user\n` +
      `/setlimit <chatId> <amount> — Set rate limit (requests/min)\n` +
      `/denylimit <chatId> — Deny rate limit request\n` +
      `/phoneusers — List users with phone access\n` +
      `/disablephone <chatId> — Disable phone access for user`,
      chatId
    );
    return true;
  }

  // /setlimit <chatId> <amount>
  if (text.startsWith("/setlimit")) {
    const [, targetId, amount] = text.split(" ");
    if (!targetId || !amount) {
      await sendTelegramMessage("Usage: /setlimit <chatId> <amount>", chatId);
      return true;
    }
    const user = await User.findOneAndUpdate(
      { chatId: targetId },
      { $set: { rateLimit: parseInt(amount), rateLimitRequested: false, rateLimitRequestNote: null } },
      { new: true }
    );
    if (!user) {
      await sendTelegramMessage(`❌ User ${targetId} not found.`, chatId);
      return true;
    }
    await sendTelegramMessage(
      `✅ Updated ${user.name || targetId}'s rate limit to ${amount} requests/min.`,
      chatId
    );
    await sendTelegramMessage(
      `✅ Your rate limit has been updated to *${amount} requests/min*.`,
      targetId
    );
    return true;
  }

  // /phoneusers — list users with phone access enabled
  if (text === "/phoneusers") {
    const users = await User.find({ "phoneAccess.enabled": true })
      .sort({ lastActiveAt: -1 })
      .limit(20);

    if (users.length === 0) {
      await sendTelegramMessage("📱 No users have phone access enabled.", chatId);
      return true;
    }

    const list = users.map((u, i) =>
      `${i + 1}. ${u.name || "Unknown"} | \`${u.chatId}\`\n` +
      `   Bridge: ${u.phoneAccess.bridgeUrl || "N/A"}\n` +
      `   Apps: ${u.phoneAccess.allowedApps?.includes("*") ? "All" : u.phoneAccess.allowedApps?.length || 0}\n` +
      `   Last seen: ${u.phoneAccess.lastSeen?.toLocaleDateString("en-IN") || "Never"}`
    ).join("\n\n");

    await sendTelegramMessage(
      `📱 *Phone Users (${users.length})*\n\n${list}`,
      chatId
    );
    return true;
  }

  // /disablephone <chatId>
  if (text.startsWith("/disablephone")) {
    const [, targetId] = text.split(" ");
    if (!targetId) {
      await sendTelegramMessage("Usage: /disablephone <chatId>", chatId);
      return true;
    }
    const user = await User.findOneAndUpdate(
      { chatId: targetId },
      { $set: {
        "phoneAccess.enabled": false,
        "phoneAccess.bridgeUrl": null,
        "phoneAccess.bridgeSecret": null,
      }},
      { new: true }
    );
    if (!user) {
      await sendTelegramMessage(`❌ User ${targetId} not found.`, chatId);
      return true;
    }
    await sendTelegramMessage(`✅ Phone access disabled for ${user.name || targetId}.`, chatId);
    await sendTelegramMessage(
      "⚠️ Your phone access has been disabled by the admin. Your bridge has been disconnected.",
      targetId
    );
    return true;
  }

  // /denylimit <chatId>
  if (text.startsWith("/denylimit")) {
    const [, targetId] = text.split(" ");
    await User.updateOne(
      { chatId: targetId },
      { $set: { rateLimitRequested: false, rateLimitRequestNote: null } }
    );
    await sendTelegramMessage(`✅ Rate limit request denied for ${targetId}.`, chatId);
    await sendTelegramMessage(
      "❌ Your rate limit request was reviewed and denied. Your current limit remains unchanged.",
      targetId
    );
    return true;
  }

  return false;
}
