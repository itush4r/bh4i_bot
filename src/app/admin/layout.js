import { headers } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Protect the /admin page with HTTP Basic Auth.
 * Runs server-side on every request to /admin/*.
 */
export default async function AdminLayout({ children }) {
  const headersList = await headers();
  const auth = headersList.get("authorization") || "";
  const expected =
    "Basic " +
    Buffer.from(
      `${process.env.ADMIN_USERNAME}:${process.env.ADMIN_SECRET}`
    ).toString("base64");

  if (auth !== expected) {
    // Return a 401 with WWW-Authenticate to trigger the browser's login dialog
    return new NextResponse("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Admin"' },
    });
  }

  return <>{children}</>;
}
