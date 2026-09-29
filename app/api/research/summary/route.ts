import { z } from "zod";
import { readAiConfig } from "@/lib/extract/model";
import { callResponses } from "@/lib/server/responses";

export const runtime = "nodejs";
export const maxDuration = 90;

const requestSchema = z.object({
  question: z.string().max(1000).default(""),
  rows: z
    .array(
      z.object({
        paper: z.string().max(300),
        coverage: z.string().max(20).default("fulltext"),
        cells: z
          .array(
            z.object({
              column: z.string().max(120),
              value: z.string().max(600),
              conditions: z.string().max(400).default(""),
              status: z.string().max(40).default(""),
            }),
          )
          .max(20),
      }),
    )
    .min(1)
    .max(20),
});

/**
 * Writes a summary strictly from the stored answers it is given.
 *
 * It never sees the papers, so it cannot add facts; and it is told to refuse a
 * ranking when the conditions behind two numbers differ, which is the whole
 * reason conditions are carried alongside every value.
 */
export async function POST(request: Request) {
  const config = readAiConfig();
  if (!config.configured || !config.model) {
    return Response.json({ error: config.reason ?? "AI is not configured.", code: "not_configured" }, { status: 503 });
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Nothing to summarise yet.", code: "bad_request" }, { status: 400 });
  }

  const table = parsed.data.rows
    .map(
      (row) =>
        `PAPER: ${row.paper} (read: ${row.coverage})\n` +
        row.cells
          .map(
            (cell) =>
              `  - ${cell.column}: ${cell.value || "(no answer)"}${cell.conditions ? ` [conditions: ${cell.conditions}]` : ""} (${cell.status})`,
          )
          .join("\n"),
    )
    .join("\n\n");

  try {
    const result = await callResponses(
      {
        input: [
          {
            role: "system",
            content: `Summarise a comparison table for a researcher.

Rules:
- Use only the answers given. You have not read the papers; do not add facts.
- Say where papers agree and where they differ.
- If two results were measured under different conditions (different data, metric, setting or hardware), say they are not directly comparable and explain why. Never rank them anyway.
- Name a paper as best only if the stored answers make the conditions equivalent. Otherwise say what a fair comparison would need.
- Mention where answers are missing or were read from an abstract only.
- 120-200 words, plain prose, no headings.`,
          },
          { role: "user", content: `Question: ${parsed.data.question || "(none stated)"}\n\n${table.slice(0, 12000)}` },
        ],
        max_output_tokens: 700,
      },
      { signal: request.signal },
    );
    return Response.json({ summary: result.text.trim(), usage: result.usage });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not summarise.", code: "failed" },
      { status: 502 },
    );
  }
}
