"use client";

import { useState } from "react";
import { useWorkspace } from "@/lib/workspace";
import { IconSparkle } from "./icons";

/**
 * The follow-up input.
 *
 * Deliberately not a chat: it routes a sentence to one of a few real actions and
 * says plainly when a request is outside that set. Matching is keyword-based, so
 * a follow-up costs nothing unless it actually starts work.
 */
const INTENTS = [
  { id: "more", test: /\b(more|another|additional|further|extra)\b.*\b(paper|stud|article|work)/i, label: "Find more papers" },
  { id: "refine", test: /\b(only|just|instead|narrow|restrict|focus|filter|exclude|since|after|before)\b/i, label: "Search again with new constraints" },
  { id: "columns", test: /\b(column|criteri|extract|compare)\b.*\b(add|new|also|another)\b|\b(add|suggest)\b.*\b(column|criteri)/i, label: "Add comparison criteria" },
  { id: "compare", test: /\b(compare|comparison|table)\b/i, label: "Compare the selected papers" },
  { id: "summary", test: /\b(summar|difference|differ|contrast|overview)\b/i, label: "Summarise the comparison" },
] as const;

export function RefineInput({ onCompare }: { onCompare: () => void }) {
  const ws = useWorkspace();
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const run = async () => {
    const request = text.trim();
    if (!request || !ws.project) return;
    const intent = INTENTS.find((candidate) => candidate.test.test(request));

    if (!intent) {
      setNote(
        "That is outside what this can do. Try: find more papers, narrow the search, add a comparison criterion, compare the selected papers, or summarise the differences.",
      );
      return;
    }

    setNote(null);
    setText("");
    if (intent.id === "columns") {
      setNote("Suggesting comparison criteria…");
      try {
        const added = await ws.suggestColumns();
        const message = added
          ? `Added ${added} comparison criteria.${ws.rows.length ? "" : " Choose papers to fill them."}`
          : "No new criteria were suggested.";
        setNote(message);
        ws.setNotice(message);
        // Only jump to the table when there is a table to look at.
        if (added && ws.rows.length) onCompare();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not suggest criteria.";
        setNote(message);
        ws.setNotice(message);
      }
      return;
    }
    if (intent.id === "compare") {
      onCompare();
      return;
    }
    if (intent.id === "summary") {
      onCompare();
      setNote("Open the table's menu and choose “Summarise comparison”.");
      return;
    }
    // "more" and "refine" both run discovery again, with the follow-up as context.
    const question =
      intent.id === "refine"
        ? `${ws.project.question || ws.project.title}. Additional constraint: ${request}`
        : `${ws.project.question || ws.project.title}. ${request}`;
    try {
      await ws.research(ws.project.id, question);
    } catch (error) {
      setNote(error instanceof Error ? error.message : "That search failed.");
    }
  };

  return (
    <div className="mt-6">
      <div className="card flex items-end gap-2 p-2">
        <textarea
          className="min-h-[38px] w-full resize-none bg-transparent px-1.5 py-1.5 text-[13.5px] outline-none"
          rows={1}
          placeholder="Refine this research…"
          aria-label="Refine this research"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void run();
            }
          }}
        />
        <button className="btn btn-primary shrink-0" onClick={run} disabled={!text.trim() || ws.researching}>
          <IconSparkle size={15} />
          Run
        </button>
      </div>
      <p className="mt-1 text-[11.5px]" style={{ color: "var(--text-3)" }}>
        Find more papers · narrow the search · add a criterion · compare selected · summarise differences
      </p>
      {note ? (
        <p className="mt-1 text-[12.5px]" role="status" style={{ color: "var(--text-2)" }}>
          {note}
        </p>
      ) : null}
    </div>
  );
}
