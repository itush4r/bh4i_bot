import "./globals.css";

export const metadata = {
  title: "AI Assistant — Your Personal Telegram Bot",
  description: "AI-powered daily briefings, email analysis, and personalised news — delivered straight to Telegram.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="m-0 p-0 border-0">{children}</body>
    </html>
  );
}
