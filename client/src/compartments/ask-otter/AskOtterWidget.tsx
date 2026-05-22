import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { MessageCircle, Loader2, Lock, Settings as SettingsIcon } from "lucide-react";

interface AskOtterStatus {
  enabled: boolean;
  reason: "ready" | "no-api-key" | "account-disabled" | "unauthenticated";
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function AskOtterWidget() {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [serverMessage, setServerMessage] = useState<string | null>(null);

  const { data: status, isLoading } = useQuery<AskOtterStatus>({
    queryKey: ["/api/dashboard/ask-otter/status"],
    queryFn: async () => (await apiRequest("GET", "/api/dashboard/ask-otter/status")).json(),
    staleTime: 5 * 60 * 1000,
  });

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setServerMessage(null);
    const newMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setDraft("");
    try {
      const res = await apiRequest("POST", "/api/dashboard/ask-otter/chat", {
        messages: newMessages,
      });
      const data = await res.json();
      if (!res.ok) {
        setServerMessage(data?.message || "Ask Otter is unavailable.");
      } else if (data?.reply) {
        setMessages([...newMessages, { role: "assistant", content: data.reply }]);
      }
    } catch (err: any) {
      setServerMessage(err?.message || "Network error.");
    } finally {
      setSending(false);
    }
  }

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading Ask Otter…
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" data-testid="ask-otter">
      <div className="flex items-center justify-between px-3 py-2 border-b border-card-border">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider font-semibold text-muted-foreground">
          <MessageCircle className="h-3.5 w-3.5" />
          Ask Otter
        </div>
        <span className="text-micro text-muted-foreground">Powered by Claude</span>
      </div>

      {/* Status banner — explains the gate when disabled */}
      {status && !status.enabled && (
        <div className="px-3 py-2 bg-watch/5 border-b border-watch/20 flex items-start gap-2">
          <Lock className="h-3.5 w-3.5 text-watch-light mt-0.5 shrink-0" />
          <div className="text-xs text-foreground/80 leading-snug">
            <div className="font-semibold text-watch-light">Ask Otter is a paid feature</div>
            <div className="text-muted-foreground mt-0.5">
              {status.reason === "no-api-key"
                ? "Server admin must add ANTHROPIC_API_KEY to env to enable."
                : <>Enable per-account in <SettingsIcon className="h-3 w-3 inline -mt-0.5" /> Settings → Ask Otter. Adds ~pennies per conversation.</>}
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0">
        {messages.length === 0 && (
          <div className="text-xs text-muted-foreground italic">
            Ask anything about Stockotter's signals, strategies, or indicators. Educational discussion — not investment advice.
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`text-sm rounded px-2.5 py-1.5 leading-snug ${
              m.role === "user"
                ? "bg-brand-accent/10 text-foreground ml-6"
                : "bg-muted/40 text-foreground mr-6"
            }`}
          >
            {m.content}
          </div>
        ))}
        {serverMessage && (
          <div className="text-xs text-bear-light bg-bear/10 border border-bear/20 rounded px-2 py-1.5">
            {serverMessage}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-card-border">
        <div className="flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={status?.enabled ? "Ask about a signal, strategy, or ticker…" : "Enable in Settings to chat"}
            disabled={!status?.enabled || sending}
            className="flex-1 text-xs px-2 py-1.5 rounded border border-card-border bg-background text-foreground placeholder:text-muted-foreground/50 disabled:opacity-60"
            data-testid="ask-otter-input"
          />
          <button
            onClick={send}
            disabled={!status?.enabled || sending || !draft.trim()}
            className="text-xs font-semibold px-3 py-1.5 rounded bg-brand-accent text-white hover:bg-brand-accent-deep disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="ask-otter-send"
          >
            {sending ? "…" : "Ask"}
          </button>
        </div>
      </div>
    </div>
  );
}
