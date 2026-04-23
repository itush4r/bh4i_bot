import User from "../models/User";

const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

// Token costs per action
export const TOKEN_COST = {
  chat:     1,
  news:     3,
  mails:    3,
  send:     1,
  cron:     3,
  phone:    5,
  file:     3, // upload + AI analysis
  download: 2, // generate + send updated file
};

// Check quota before action
export async function checkQuota(user, action) {
  // Admin always passes
  if (String(user.chatId) === String(ADMIN_CHAT_ID)) return { allowed: true };

  // Banned users
  if (user.status === "banned") {
    return {
      allowed: false,
      reason: "banned",
      message: `🚫 Your account has been suspended.\n\n${user.warningMessage || "Contact support for more info."}`,
    };
  }

  // Reset quota if new day (IST midnight)
  const now = new Date();
  const lastReset = new Date(user.quotaResetDate);
  const istOffset = 5.5 * 60 * 60 * 1000;
  const nowIST   = new Date(now.getTime() + istOffset);
  const resetIST = new Date(lastReset.getTime() + istOffset);

  if (nowIST.toDateString() !== resetIST.toDateString()) {
    await User.updateOne(
      { chatId: user.chatId },
      { $set: { quotaUsed: 0, quotaResetDate: now, quotaRequested: false } }
    );
    user.quotaUsed = 0;
  }

  const cost = TOKEN_COST[action] || 1;
  const remaining = user.quotaLimit - user.quotaUsed;

  // Quota exhausted
  if (remaining <= 0) {
    return {
      allowed: false,
      reason:  "exhausted",
      message:
        `⚠️ You've used all your ${user.quotaLimit} daily tokens.\n\n` +
        `Your quota resets at midnight IST.\n\n` +
        `Need more? Send /requestquota with a reason.`,
    };
  }

  // Not enough for this action
  if (remaining < cost) {
    return {
      allowed: false,
      reason:  "insufficient",
      message:
        `⚠️ This action costs ${cost} tokens but you only have ${remaining} left today.\n\n` +
        `Send /requestquota to request more.`,
    };
  }

  // Low quota warning (≤ 3 tokens left after deduction)
  const warning =
    remaining - cost <= 3
      ? `\n\n⚠️ _You have ${remaining - cost} tokens left today. Send /requestquota if you need more._`
      : "";

  return { allowed: true, cost, warning };
}

// Deduct tokens after successful action
export async function deductQuota(user, action) {
  if (String(user.chatId) === String(ADMIN_CHAT_ID)) return;

  const cost = TOKEN_COST[action] || 1;
  await User.updateOne(
    { chatId: user.chatId },
    {
      $inc: { quotaUsed: cost, totalMessagesEver: 1 },
      $set: { lastActiveAt: new Date() },
    }
  );
}
