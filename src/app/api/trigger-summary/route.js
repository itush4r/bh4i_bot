import { NextResponse } from "next/server";

async function runPipeline() {
  // Dynamic import to handle CommonJS modules
  const { runDailySummary } = await import("../../../jobs/dailySummary.js");
  return runDailySummary();
}

export async function POST(request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await runPipeline();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: "Use POST to trigger the daily summary pipeline.",
    usage: "POST /api/trigger-summary",
  });
}
