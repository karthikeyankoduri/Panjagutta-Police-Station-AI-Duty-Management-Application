"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import Icon from "@/components/icons";
import {
  broadcastChat, ChatMessage, ChatThread, getChatMessages, getChatThreads, markChatRead, sendChatMessage,
} from "@/lib/api";

const OPEN_POLL_MS = 8_000;
const CLOSED_POLL_MS = 20_000;
const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin", SHO: "SHO", ADMIN_SI: "Admin SI", SECTOR_SI: "Sector SI", DI: "DI", DSI: "DSI", STAFF: "Staff",
};

function clock(iso: string | null) {
  if (!iso) return "";
  const t = new Date(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  const hm = t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return t.toDateString() === new Date().toDateString()
    ? hm
    : `${t.toLocaleDateString([], { day: "2-digit", month: "2-digit" })} ${hm}`;
}

/**
 * Floating chat. A round button hovers at the bottom-right of every page; clicking it expands into a chat box.
 * Inside: a list of conversations (superiors: every user + Station channel; others: Station + their own thread),
 * then the open conversation. Who may read what is enforced by the server.
 */
export default function ChatLauncher() {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [canBroadcast, setCanBroadcast] = useState(false);
  const [view, setView] = useState<"list" | "thread">("list");
  const [selected, setSelected] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [query, setQuery] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastText, setBroadcastText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const lastId = useRef(0);

  const loadThreads = useCallback(async () => {
    if (!token) return;
    try {
      const r = await getChatThreads(token);
      setThreads(r.threads);
      setCanBroadcast(r.can_broadcast);
    } catch {
      /* badge is best-effort */
    }
  }, [token]);

  useEffect(() => {
    loadThreads();
    const id = setInterval(loadThreads, open ? OPEN_POLL_MS : CLOSED_POLL_MS);
    return () => clearInterval(id);
  }, [loadThreads, open]);

  const loadMessages = useCallback(async (reset: boolean) => {
    if (!token || view !== "thread") return;
    try {
      const fresh = await getChatMessages(token, selected, reset ? undefined : lastId.current || undefined);
      setError(null);
      if (reset) setMessages(fresh);
      else if (fresh.length) setMessages((prev) => [...prev, ...fresh.filter((m) => !prev.some((p) => p.id === m.id))]);
      if (fresh.length) {
        lastId.current = fresh[fresh.length - 1].id;
        await markChatRead(token, selected);
        loadThreads();
      }
    } catch (e: any) {
      setError(e.message || "Failed to load messages");
    } finally {
      setLoaded(true);
    }
  }, [token, selected, view, loadThreads]);

  useEffect(() => {
    if (!open || view !== "thread") return;
    lastId.current = 0;
    setMessages([]);
    setLoaded(false);
    loadMessages(true);
    const id = setInterval(() => loadMessages(false), OPEN_POLL_MS);
    return () => clearInterval(id);
  }, [open, view, selected, loadMessages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, open, view]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const send = async () => {
    const body = text.trim();
    if (!token || !body || sending) return;
    setSending(true);
    try {
      await sendChatMessage(token, selected, body);
      setText("");
      await loadMessages(false);
    } catch (e: any) {
      setError(e.message || "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const sendBroadcast = async () => {
    const body = broadcastText.trim();
    if (!token || !body) return;
    try {
      await broadcastChat(token, body);
      setBroadcastText("");
      setBroadcasting(false);
      loadThreads();
      if (view === "thread" && selected === null) await loadMessages(false);
    } catch (e: any) {
      setError(e.message || "Failed to send to everyone");
    }
  };

  if (!token) return null;

  const totalUnread = threads.reduce((n, t) => n + t.unread, 0);
  const q = query.trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  // Matches name, service number or role, and phone numbers however they are typed (spaces, +91, dashes).
  const shown = threads.filter(
    (t) =>
      !q ||
      `${t.title} ${t.subtitle ?? ""} ${t.phone ?? ""}`.toLowerCase().includes(q) ||
      (qDigits.length >= 3 && (t.phone ?? "").replace(/\D/g, "").includes(qDigits))
  );
  const current = threads.find((t) => t.thread_user_id === selected);

  const border = "1px solid #e2e8f0";

  return (
    <div className="chat-launcher" style={{ position: "fixed", right: 20, bottom: 20, zIndex: 1500 }}>
      {open && (
        <div
          role="dialog"
          aria-label="Chat"
          style={{
            position: "absolute", right: 0, bottom: 64, width: 380, maxWidth: "calc(100vw - 32px)", height: 540,
            maxHeight: "calc(100vh - 110px)", display: "flex", flexDirection: "column", background: "#fff", color: "#0f172a",
            border, borderRadius: 14, boxShadow: "0 18px 48px rgba(15,23,42,0.35)", overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "#0f2238", color: "#fff" }}>
            {view === "thread" && (
              <button className="btn btn-secondary btn-sm" onClick={() => { setView("list"); loadThreads(); }} aria-label="Back to conversations">←</button>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{view === "thread" ? (current?.title ?? "Station channel") : "Chat"}</div>
              <div style={{ fontSize: 11, opacity: 0.75 }}>
                {view === "thread"
                  ? selected === null ? "Visible to everyone" : "Private: this person and the SHO / Admin SI / Super Admin"
                  : "Station channel and private conversations"}
              </div>
            </div>
            {view === "list" && canBroadcast && (
              <button className="btn btn-primary btn-sm" onClick={() => setBroadcasting(true)} title="Send one message to every user">Message all</button>
            )}
            <button className="btn btn-secondary btn-sm" onClick={() => setOpen(false)} aria-label="Close chat">✕</button>
          </div>

          {error && <div className="alert alert-danger" role="alert" style={{ margin: 8 }}>{error}</div>}

          {view === "list" ? (
            <>
              {canBroadcast && (
                <div style={{ padding: 10, borderBottom: border }}>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search name, service no. or phone…"
                    aria-label="Search people"
                    style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13 }}
                  />
                </div>
              )}
              <div style={{ overflowY: "auto", flex: 1 }}>
                {shown.length === 0 && <div style={{ padding: 14, fontSize: 13, color: "#64748b" }}>No conversations to show.</div>}
                {shown.map((t) => (
                  <button
                    key={String(t.thread_user_id)}
                    onClick={() => { setSelected(t.thread_user_id); setView("thread"); }}
                    style={{ all: "unset", cursor: "pointer", display: "flex", width: "100%", boxSizing: "border-box", padding: "10px 12px", gap: 8, alignItems: "center", borderBottom: border }}
                  >
                    <span aria-hidden style={{ width: 34, height: 34, borderRadius: "50%", background: "#e9f0fe", color: "#0f2238", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{t.kind === "station" ? <Icon name="broadcast" size={16} /> : t.title.charAt(0).toUpperCase()}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontWeight: 600, fontSize: 14 }}>{t.title}</span>
                      <span style={{ display: "block", fontSize: 12, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {t.last?.body ?? ([t.subtitle, t.phone].filter(Boolean).join(" · ") || "No messages yet")}
                      </span>
                    </span>
                    {t.unread > 0 && (
                      <span style={{ background: "#dc2626", color: "#fff", borderRadius: 999, fontSize: 11, fontWeight: 700, padding: "2px 7px" }}>{t.unread}</span>
                    )}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                {loaded && messages.length === 0 && <div style={{ color: "#64748b", fontSize: 14 }}>No messages yet. Say hello.</div>}
                {messages.map((m) => {
                  const broadcast = m.kind === "broadcast";
                  const role = ROLE_LABELS[m.sender_role] ?? "";
                  return (
                    <div
                      key={m.id}
                      style={{
                        alignSelf: m.mine ? "flex-end" : "flex-start", maxWidth: "85%", padding: "8px 12px", borderRadius: 12,
                        background: broadcast ? "#fff4d6" : m.mine ? "#0f2238" : "#e8edf3",
                        color: m.mine && !broadcast ? "#fff" : "#0f172a",
                      }}
                    >
                      {(!m.mine || broadcast) && (
                        <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.7 }}>
                          {broadcast ? "To everyone · " : ""}{m.sender_name}{role ? ` · ${role}` : ""}
                        </div>
                      )}
                      <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.body}</div>
                      <div style={{ fontSize: 10, opacity: 0.6, textAlign: "right" }}>{clock(m.created_at)}</div>
                    </div>
                  );
                })}
                <div ref={endRef} />
              </div>
              <form onSubmit={(e) => { e.preventDefault(); send(); }} style={{ display: "flex", gap: 8, padding: 10, borderTop: border }}>
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={1000}
                  placeholder="Type a message"
                  aria-label="Message"
                  style={{ flex: 1, minWidth: 0, padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 14 }}
                />
                <button className="btn btn-primary" type="submit" disabled={sending || !text.trim()}>Send</button>
              </form>
            </>
          )}

          {broadcasting && (
            <div style={{ position: "absolute", inset: 0, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
              <div role="dialog" aria-label="Message everyone" style={{ background: "#fff", borderRadius: 12, padding: 16, width: "100%" }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Message everyone</div>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>Goes to every user and appears in the Station channel.</div>
                <textarea
                  autoFocus
                  value={broadcastText}
                  onChange={(e) => setBroadcastText(e.target.value)}
                  maxLength={1000}
                  rows={4}
                  style={{ width: "100%", boxSizing: "border-box", padding: 8, border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 14 }}
                />
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => setBroadcasting(false)}>Cancel</button>
                  <button className="btn btn-primary btn-sm" onClick={sendBroadcast} disabled={!broadcastText.trim()}>Send to all</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close chat" : `Open chat${totalUnread ? `, ${totalUnread} unread` : ""}`}
        aria-expanded={open}
        style={{
          position: "relative", width: 56, height: 56, borderRadius: "50%", border: "2px solid #c9a227", background: "#0f2238",
          color: "#fff", fontSize: 24, cursor: "pointer", boxShadow: "0 8px 22px rgba(15,23,42,0.4)",
        }}
      >
        {open ? <Icon name="close" size={22} /> : <Icon name="chat" size={24} />}
        {!open && totalUnread > 0 && (
          <span style={{ position: "absolute", top: -4, right: -4, background: "#dc2626", color: "#fff", borderRadius: 999, fontSize: 11, fontWeight: 700, padding: "2px 6px", minWidth: 18 }}>
            {totalUnread}
          </span>
        )}
      </button>
    </div>
  );
}
