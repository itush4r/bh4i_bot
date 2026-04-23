import { NextResponse } from "next/server";

/**
 * Validate HTTP Basic Auth credentials against ADMIN_USERNAME / ADMIN_SECRET.
 * Returns a 401 NextResponse if invalid, or null if valid.
 */
export function requireBasicAuth(request) {
  const auth = request.headers.get("authorization") || "";
  const expected =
    "Basic " +
    Buffer.from(
      `${process.env.ADMIN_USERNAME}:${process.env.ADMIN_SECRET}`
    ).toString("base64");

  if (auth !== expected) {
    return new NextResponse("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Admin"' },
    });
  }

  return null; // auth passed
}
