import { NextResponse } from "next/server";
import { runDailySummary } from "../../../jobs/dailySummary.js";
import dbConnect from "../../../lib/db";
import User from "../../../models/User";

export async function GET(request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    await dbConnect();

    // 1. Send daily briefings (news + mails) to all eligible users
    const briefingResult = await runDailySummary();

    // 2. Reset daily quota for all users
    const resetResult = await User.updateMany(
      {},
      { $set: { quotaUsed: 0, quotaResetDate: new Date(), quotaRequested: false } }
    );

    return NextResponse.json({
      success: true,
      briefingsSent: briefingResult.total,
      usersReset: resetResult.modifiedCount,
    });
  } catch (error) {
    console.error("[Cron] Failed:", error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
