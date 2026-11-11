import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, MessageCircleQuestion, Send } from "lucide-react";
import { toast } from "sonner";
import { commands, type NotesAnswer } from "@/bindings";
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

/** Chat-style Q&A over every note, with citations back to the source notes. */
export const AskNotesPanel: React.FC<{ onOpenNote: (id: number) => void }> = ({
  onOpenNote,
}) => {
  const { t } = useTranslation();
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [history, setHistory] = useState<Exchange[]>([]);

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
      setHistory((h) => [...h, { question: text, answer: result.data }]);
      setQuestion("");
    } else {
      toast.error(result.error);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col rounded-2xl border border-line bg-surface/70 shadow-2xs overflow-hidden backdrop-blur-md">
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
  );
};
