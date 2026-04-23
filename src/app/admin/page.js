"use client";
import { useEffect, useState } from "react";

export default function AdminDashboard() {
  const [users, setUsers]     = useState([]);
  const [search, setSearch]   = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/users")
      .then((r) => r.json())
      .then((data) => { setUsers(data); setLoading(false); });
  }, []);

  async function updateUser(chatId, field, value) {
    await fetch(`/api/admin/users/${chatId}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ [field]: value }),
    });
    setUsers((prev) =>
      prev.map((u) => (u.chatId === chatId ? { ...u, [field]: value } : u))
    );
  }

  const filtered = users.filter((u) =>
    u.name?.toLowerCase().includes(search.toLowerCase()) ||
    u.chatId?.includes(search) ||
    u.emailAccounts?.[0]?.emailAddress?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <p style={{ padding: 40 }}>Loading...</p>;

  return (
    <div style={{ fontFamily: "sans-serif", padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <h1>🛠 Admin Dashboard</h1>

      {/* Stats bar */}
      <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
        {[
          ["Total", users.length],
          ["Active", users.filter((u) => u.status === "active").length],
          ["Banned", users.filter((u) => u.status === "banned").length],
          ["Email connected", users.filter((u) => u.emailAccounts?.length > 0).length],
          ["Quota requests", users.filter((u) => u.quotaRequested).length],
        ].map(([label, val]) => (
          <div key={label} style={{ background: "#f4f4f4", borderRadius: 8, padding: "12px 20px" }}>
            <div style={{ fontSize: 24, fontWeight: "bold" }}>{val}</div>
            <div style={{ fontSize: 12, color: "#666" }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <input
        placeholder="Search by name, chatId, or email..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ width: "100%", padding: "10px 14px", marginBottom: 16,
          border: "1px solid #ddd", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }}
      />

      {/* Users table */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#f4f4f4", textAlign: "left" }}>
            {["Name", "ChatId", "Status", "Quota Used", "Daily Limit",
              "Email", "Last Active", "Actions"].map((h) => (
              <th key={h} style={{ padding: "10px 12px", borderBottom: "1px solid #ddd" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.map((u) => (
            <tr key={u.chatId} style={{ borderBottom: "1px solid #f0f0f0" }}>
              <td style={{ padding: "10px 12px" }}>{u.name || "—"}</td>
              <td style={{ padding: "10px 12px", fontFamily: "monospace" }}>{u.chatId}</td>
              <td style={{ padding: "10px 12px" }}>
                <select
                  value={u.status}
                  onChange={(e) => updateUser(u.chatId, "status", e.target.value)}
                  style={{ padding: "4px 8px", borderRadius: 4 }}
                >
                  <option value="active">active</option>
                  <option value="warned">warned</option>
                  <option value="banned">banned</option>
                </select>
              </td>
              <td style={{ padding: "10px 12px" }}>{u.quotaUsed}</td>
              <td style={{ padding: "10px 12px" }}>
                <input
                  type="number"
                  defaultValue={u.quotaLimit}
                  onBlur={(e) => updateUser(u.chatId, "quotaLimit", parseInt(e.target.value))}
                  style={{ width: 60, padding: "4px 8px", borderRadius: 4,
                    border: "1px solid #ddd" }}
                />
              </td>
              <td style={{ padding: "10px 12px" }}>{u.emailAccounts?.[0]?.emailAddress || "—"}</td>
              <td style={{ padding: "10px 12px" }}>
                {u.lastActiveAt ? new Date(u.lastActiveAt).toLocaleDateString("en-IN") : "—"}
              </td>
              <td style={{ padding: "10px 12px" }}>
                {u.quotaRequested && (
                  <span style={{ background: "#fff3cd", padding: "2px 8px",
                    borderRadius: 4, fontSize: 11, marginRight: 6 }}>
                    ⏳ Quota request
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
