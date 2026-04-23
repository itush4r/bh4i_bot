import User from "../models/User";

const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const WINDOW_MS = 60_000; // 1 minute

export async function checkRateLimit(user) {
  // Admin bypasses rate limit
  if (String(user.chatId) === String(ADMIN_CHAT_ID)) return { allowed: true };

  const maxRequests = user.rateLimit || 5;
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MS);

  // Filter hits within the last minute
  const recentHits = (user.rateLimitHits || []).filter((t) => new Date(t) > windowStart);

  if (recentHits.length >= maxRequests) {
    const oldest = new Date(recentHits[0]);
    const retryAfter = Math.ceil((oldest.getTime() + WINDOW_MS - now.getTime()) / 1000);
    return {
      allowed: false,
      message:
        `⏳ You're sending messages too fast (${maxRequests}/min limit). Please wait ${retryAfter} seconds.\n\n` +
        `Need a higher limit? Send /requestlimit with a reason.`,
    };
  }

  // Add current hit and prune old ones
  recentHits.push(now);
  await User.updateOne(
    { chatId: user.chatId },
    { $set: { rateLimitHits: recentHits } }
  );

  return { allowed: true };
}
