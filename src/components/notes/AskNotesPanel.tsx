import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  MessageCircleQuestion,
  MessageSquare,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { commands, type NoteChatSummary, type NotesAnswer } from "@/bindings";
import { MarkdownContent } from "../whats-new/MarkdownContent";
import { Button } from "../ui/Button";

interface Exchange {
  question: string;
  answer: NotesAnswer;
}

const SUGGESTION_KEYS = [
  "notes.ask.suggestions.actionItems",
  "notes.ask.suggestions.decisions",
  "notes.ask.suggestions.thisWeek",
  "notes.ask.suggestions.followUps",
] as const;

/** "Today 14:05", "Yesterday", or a short date, for the Recent chats list. */
const whenLabel = (
  seconds: number,
  locale: string,
  words: { today: string; yesterday: string },
) => {
  const date = new Date(seconds * 1000);
  const now = new Date();
  const days = Math.floor(
    (new Date(now.toDateString()).getTime() -
      new Date(date.toDateString()).getTime()) /
      86_400_000,
  );
  if (days === 0)
    return `${words.today} ${date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`;
  if (days === 1) return words.yesterday;
  return date.toLocaleDateString(locale, { month: "short", day: "numeric" });
};

/** Chat-style Q&A over every note, with citations back to the source notes.
 * Chats are saved, so earlier ones can be reopened from Recent chats. */
export const AskNotesPanel: React.FC<{ onOpenNote: (id: number) => void }> = ({
  onOpenNote,
}) => {
  const { t, i18n } = useTranslation();
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [history, setHistory] = useState<Exchange[]>([]);
  // The saved chat being shown; null for a new, unsaved one.
  const [chatId, setChatId] = useState<number | null>(null);
  const [chats, setChats] = useState<NoteChatSummary[]>([]);

  const refreshChats = useCallback(async () => {
    const res = await commands.listNoteChats();
    if (res.status === "ok") setChats(res.data);
  }, []);

  useEffect(() => {
    refreshChats();
  }, [refreshChats]);

  const openChat = async (id: number) => {
    if (asking) return;
    const res = await commands.getNoteChat(id);
    if (res.status === "ok" && res.data) {
      setChatId(res.data.id);
      setHistory(res.data.turns);
      setQuestion("");
    } else if (res.status === "error") {
      toast.error(res.error);
    }
  };

  const newChat = () => {
    if (asking) return;
    setChatId(null);
    setHistory([]);
    setQuestion("");
  };

  const deleteChat = async (id: number) => {
    const res = await commands.deleteNoteChat(id);
    if (res.status === "error") {
      toast.error(res.error);
      return;
    }
    if (id === chatId) newChat();
    refreshChats();
  };

  const ask = async (q: string) => {
    const text = q.trim();
    if (!text || asking) return;
    setAsking(true);
    const contextHistory = history.map((h) => ({
      question: h.question,
      answer: h.answer.answer,
    }));
    const result = await commands.askNotes(text, contextHistory);
    setAsking(false);
    if (result.status === "ok") {
      const turns = [...history, { question: text, answer: result.data }];
      setHistory(turns);
      setQuestion("");
      // Save after every answer, so the chat survives leaving the page.
      const saved = await commands.saveNoteChat(chatId, turns);
      if (saved.status === "ok") {
        setChatId(saved.data);
        refreshChats();
      }
    } else {
      toast.error(result.error);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex gap-3">
      <aside className="hidden sm:flex w-52 shrink-0 flex-col rounded-2xl border border-line bg-surface/70 shadow-2xs overflow-hidden">
        <div className="p-2 border-b border-line">
          <button
            type="button"
            onClick={newChat}
            disabled={asking}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border border-line bg-surface hover:border-logo-primary hover:bg-logo-primary/10 cursor-pointer transition-all disabled:opacity-40"
          >
            <Plus size={14} />
            {t("notes.ask.newChat")}
          </button>
        </div>
        <p className="px-3 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">
          {t("notes.ask.recent")}
        </p>
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
          {chats.length === 0 && (
            <p className="px-2 py-3 text-xs text-ink-3">
              {t("notes.ask.noChats")}
            </p>
          )}
          {chats.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center rounded-lg ${c.id === chatId ? "bg-logo-primary/12" : "hover:bg-surface"}`}
            >
              <button
                type="button"
                onClick={() => openChat(c.id)}
                className="flex-1 min-w-0 text-start px-2 py-1.5 cursor-pointer"
              >
                <span className="flex items-center gap-1.5 text-xs font-medium text-text">
                  <MessageSquare size={12} className="shrink-0 text-ink-3" />
                  <span className="truncate">
                    {c.title || t("notes.untitled")}
                  </span>
                </span>
                <span className="block ps-[18px] text-[11px] text-ink-3">
                  {whenLabel(c.updated_at, i18n.language, {
                    today: t("notes.ask.today"),
                    yesterday: t("notes.ask.yesterday"),
                  })}
                  {" · "}
                  {t("notes.ask.turns", { count: c.turn_count })}
                </span>
              </button>
              <button
                type="button"
                onClick={() => deleteChat(c.id)}
                aria-label={t("notes.ask.deleteChat")}
                title={t("notes.ask.deleteChat")}
                className="me-1 p-1 rounded-md text-ink-3 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-red-500 cursor-pointer"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </aside>
      <div className="flex-1 min-w-0 min-h-0 flex flex-col rounded-2xl border border-line bg-surface/70 shadow-2xs overflow-hidden backdrop-blur-md">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {history.length === 0 && (
            <div className="max-w-md mx-auto text-center space-y-3 py-8">
              <div className="w-12 h-12 rounded-2xl bg-logo-primary/15 border border-logo-primary/25 flex items-center justify-center mx-auto text-logo-primary shadow-2xs">
                <MessageCircleQuestion size={24} />
              </div>
              <p className="text-sm font-semibold text-text">
                {t("notes.ask.title")}
              </p>
              <p className="text-xs text-ink-3 leading-relaxed">
                {t("notes.ask.description")}
              </p>
              <div className="flex flex-wrap justify-center gap-1.5 pt-2">
                {SUGGESTION_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => ask(t(key))}
                    disabled={asking}
                    className="px-3 py-1 rounded-full text-xs font-medium border border-line bg-surface hover:border-logo-primary hover:bg-logo-primary/10 cursor-pointer transition-all shadow-2xs disabled:opacity-40"
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {history.map((ex, i) => (
            <div key={i} className="space-y-2">
              <div className="ml-auto max-w-[80%] w-fit rounded-2xl rounded-tr-xs bg-primary text-primary-foreground px-4 py-2.5 text-sm shadow-2xs">
                {ex.question}
              </div>
              <div className="max-w-[90%] rounded-2xl rounded-tl-xs border border-line bg-surface/90 px-4 py-3 text-sm shadow-2xs space-y-2">
                <MarkdownContent markdown={ex.answer.answer} />
                {ex.answer.sources.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-line flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-ink-3 font-medium">
                      {t("notes.ask.sources")}
                    </span>
                    {ex.answer.sources.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => onOpenNote(s.id)}
                        className="px-2.5 py-0.5 rounded-full text-[11px] font-medium border border-line bg-surface hover:border-logo-primary hover:text-logo-primary cursor-pointer transition-all shadow-2xs max-w-[200px] truncate"
                      >
                        {s.title || t("notes.untitled")}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {asking && (
            <div className="flex items-center gap-2 text-xs text-ink-3 p-2">
              <Loader2 size={13} className="animate-spin text-logo-primary" />
              {t("notes.ask.thinking")}
            </div>
          )}
        </div>
        <form
          className="flex gap-2 p-3 border-t border-line bg-surface/50"
          onSubmit={(e) => {
            e.preventDefault();
            ask(question);
          }}
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t("notes.ask.placeholder")}
            className="flex-1 min-w-0 px-3.5 py-2 rounded-xl border border-line bg-surface text-xs outline-none focus:border-logo-primary focus:ring-1 focus:ring-logo-primary/20 shadow-2xs"
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={asking || !question.trim()}
            className="flex items-center gap-1.5 rounded-xl px-3.5 shadow-2xs font-medium"
          >
            <Send size={13} />
            {t("notes.ask.send")}
          </Button>
        </form>
      </div>
    </div>
  );
};
