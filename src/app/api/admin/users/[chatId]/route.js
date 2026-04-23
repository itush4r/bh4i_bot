import { NextResponse } from "next/server";
import dbConnect from "../../../../../lib/db";
import User from "../../../../../models/User";
import { requireBasicAuth } from "../../../../../lib/basicAuth";

export async function PATCH(request, { params }) {
  const authError = requireBasicAuth(request);
  if (authError) return authError;

  await dbConnect();
  const body = await request.json();

  const allowed = ["quotaLimit", "status", "warningMessage", "quotaUsed"];
  const update  = {};
  for (const key of allowed) {
    if (body[key] !== undefined) update[key] = body[key];
  }

  const user = await User.findOneAndUpdate(
    { chatId: params.chatId },
    { $set: update },
    { new: true }
  );

  return NextResponse.json(user);
}
