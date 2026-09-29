import { z } from "zod";
import { readAiConfig } from "@/lib/extract/model";
import { callResponses, extractJson } from "@/lib/server/responses";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({
  columns: z
    .array(
      z.object({
        label: z.string().min(2).max(60),
        instruction: z.string().min(8).max(400),
        answerType: z.enum(["text", "number", "categorical"]).default("text"),
        unit: z.string().max(24).default(""),
      }),
    )
    .max(8)
    .default([]),
});

/**
 * Suggests comparison criteria from the research question. Starting points the
 * user edits, not a fixed schema — the response is validated before it is used.
 */
export async function POST(request: Request) {
  const config = readAiConfig();
  if (!config.configured || !config.model) {
    return Response.json({ error: config.reason ?? "AI is not configured.", code: "not_configured" }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as { question?: string; existing?: string[] };
  const question = (body.question ?? "").slice(0, 1500);
  if (!question.trim()) return Response.json({ error: "No question supplied.", code: "bad_request" }, { status: 400 });

  try {
    const result = await callResponses(
      {
        input: [
          {
            role: "system",
            content: `Propose 4 to 6 comparison criteria for reading a set of research papers against a question.
Each criterion is one factual thing to find in every paper. Prefer criteria that keep results interpretable:
the method, the data used, the evaluation setting, the reported result with its metric, and the stated limitations.
Work for any discipline — do not assume machine learning.
Reply with JSON only: {"columns":[{"label":string,"instruction":string,"answerType":"text"|"number"|"categorical","unit":string}]}`,
          },
          {
            role: "user",
            content: `Research question: ${question}${
              body.existing?.length ? `\nColumns that already exist (do not repeat): ${body.existing.slice(0, 20).join(", ")}` : ""
            }`,
          },
        ],
        max_output_tokens: 900,
      },
      { signal: request.signal },
    );

    const parsed = schema.safeParse(extractJson(result.text));
    if (!parsed.success || !parsed.data.columns.length) {
      return Response.json(
        { error: "The model did not return usable criteria. Try again, or add a column by hand.", code: "schema" },
        { status: 502 },
      );
    }
    return Response.json({ columns: parsed.data.columns, usage: result.usage });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not suggest columns.", code: "failed" },
      { status: 502 },
    );
  }
}
