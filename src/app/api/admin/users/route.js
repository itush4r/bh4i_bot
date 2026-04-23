import { NextResponse } from "next/server";
import dbConnect from "../../../../lib/db";
import User from "../../../../models/User";
import { requireBasicAuth } from "../../../../lib/basicAuth";

export async function GET(request) {
  const authError = requireBasicAuth(request);
  if (authError) return authError;

  await dbConnect();
  const users = await User.find({})
    .sort({ lastActiveAt: -1 })
    .select("-oauthAccessToken -oauthRefreshToken -imapPassword");
  return NextResponse.json(users);
}
