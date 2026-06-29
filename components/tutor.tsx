"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function Tutor({
  lessonId,
  slideIndex,
}: {
  lessonId: string;
  slideIndex: number;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [starters, setStarters] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [lastSend, setLastSend] = useState<{
    question: string;
    slideIndex: number;
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void (async () => {
      const res = await fetch(`/api/lessons/${lessonId}/tutor`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as {
          messages: Message[];
          starters: string[];
        };
        setMessages(data.messages.map((m) => ({ role: m.role, content: m.content })));
        setStarters(data.starters);
      }
    })();
  }, [lessonId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, liveText, streaming]);

  async function send(question: string, atSlide: number = slideIndex) {
    const q = question.trim();
    if (!q || streaming) return;
    setChatError(null);
    // Remember the slide the question was asked about so a retry re-sends the
    // original slide context even if the reader has since navigated away.
    setLastSend({ question: q, slideIndex: atSlide });
    setInput("");
    setMessages((m) => [...m, { role: "user", content: q }]);
    setStreaming(true);
    setLiveText("");

    let full = "";
    try {
      const res = await fetch(`/api/lessons/${lessonId}/tutor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          slideContext: { index: atSlide },
        }),
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "The tutor couldn't answer just now.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith("data:")) continue;
          const payload = JSON.parse(line.slice(5)) as {
            text?: string;
            done?: boolean;
            error?: string;
          };
          if (payload.error) throw new Error(payload.error);
          if (payload.text) {
            full += payload.text;
            setLiveText(full);
          }
        }
      }
      if (!full.trim()) throw new Error("The tutor sent an empty reply — try again.");
      setMessages((m) => [...m, { role: "assistant", content: full }]);
    } catch (err) {
      setChatError((err as Error).message);
      // Roll the failed question out of the thread so retry re-sends it cleanly.
      setMessages((m) =>
        m.length > 0 && m[m.length - 1].role === "user" && full === ""
          ? m.slice(0, -1)
          : m
      );
    } finally {
      setLiveText("");
      setStreaming(false);
    }
  }

  return (
    <div className="fade flex min-h-0 flex-1 flex-col">
      <div className="flex-1 min-h-0 space-y-5 overflow-y-auto pr-1">
        {messages.length === 0 && !streaming && (
          <div className="rise">
            <p className="text-ink-soft">
              Ask anything about this lesson — the tutor has read these exact
              pages.
            </p>
            {starters.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {starters.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => void send(s)}
                    className="rounded-full border border-line bg-paper-raised px-4 py-2 text-sm text-ink-soft hover:border-accent hover:text-accent transition-colors text-left cursor-pointer"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((message, i) => (
          <MessageBubble key={i} message={message} />
        ))}

        {streaming && (
          <MessageBubble
            message={{ role: "assistant", content: liveText }}
            live
          />
        )}

        {chatError && (
          <div role="alert" className="rise rounded-xl border border-bad/40 bg-bad/5 p-4 text-sm">
            <p className="text-bad">{chatError}</p>
            {lastSend && (
              <button
                type="button"
                onClick={() => void send(lastSend.question, lastSend.slideIndex)}
                className="mt-2 underline text-ink-soft hover:text-ink cursor-pointer"
              >
                Try again
              </button>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="mt-3 shrink-0 bg-paper pt-2"
      >
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-paper-raised p-2 focus-within:border-accent transition-colors shadow-[0_10px_30px_-18px_rgba(35,29,18,0.4)]">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            placeholder="Ask your tutor…"
            aria-label="Ask your tutor"
            className="flex-1 resize-none bg-transparent px-3 py-2 outline-none placeholder:text-ink-faint max-h-40"
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            aria-label="Send"
            className="size-9 shrink-0 rounded-xl bg-accent text-accent-ink inline-flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-30 cursor-pointer disabled:cursor-default"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path
                d="M7 12V2M7 2L2.5 6.5M7 2l4.5 4.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}

function MessageBubble({
  message,
  live = false,
}: {
  message: Message;
  live?: boolean;
}) {
  if (message.role === "user") {
    return (
      <div className="rise flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-ink text-paper px-4 py-2.5 leading-relaxed">
          {message.content}
        </p>
      </div>
    );
  }
  return (
    <div className="rise flex gap-3">
      <span
        aria-hidden
        className="mt-1 size-7 shrink-0 rounded-full bg-accent text-accent-ink inline-flex items-center justify-center font-display text-sm"
      >
        F
      </span>
      <div
        className={`tutor-prose max-w-[85%] leading-relaxed pt-1 ${
          live && !message.content ? "caret" : ""
        }`}
      >
        {message.content ? (
          <>
            <ReactMarkdown
              remarkPlugins={[remarkMath]}
              rehypePlugins={[rehypeKatex]}
            >
              {message.content}
            </ReactMarkdown>
            {live && <span className="caret" />}
          </>
        ) : null}
      </div>
    </div>
  );
}
