import { z } from "zod";

/**
 * The shape the model must return. `strict: true` on the API side plus this
 * parse on the way back: nothing reaches the table without passing both.
 */
export const evidenceSchema = z.object({
  page: z.number().int().min(1),
  /** Must be copied verbatim from the supplied page text; verified after parsing. */
  quote: z.string().min(1).max(600),
});

export const answerSchema = z.object({
  /** "found" | "not_found" | "ambiguous" — the model's own verdict, re-checked below. */
  outcome: z.enum(["found", "not_found", "ambiguous"]),
  value: z.string().max(600).default(""),
  unit: z.string().max(40).default(""),
  /** Experimental conditions the number was reported under. Kept with the value, never dropped. */
  conditions: z.string().max(400).default(""),
  /** Short explanation used for not_found / ambiguous. */
  note: z.string().max(400).default(""),
  evidence: z.array(evidenceSchema).max(6).default([]),
});

export type ModelAnswer = z.infer<typeof answerSchema>;

/** JSON Schema mirror of the above, sent to the API with strict structured output. */
export const ANSWER_JSON_SCHEMA = {
  name: "paplora_answer",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["outcome", "value", "unit", "conditions", "note", "evidence"],
    properties: {
      outcome: { type: "string", enum: ["found", "not_found", "ambiguous"] },
      value: { type: "string" },
      unit: { type: "string" },
      conditions: { type: "string" },
      note: { type: "string" },
      evidence: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["page", "quote"],
          properties: {
            page: { type: "integer" },
            quote: { type: "string" },
          },
        },
      },
    },
  },
} as const;

/** Request body for POST /api/extract. Validated server-side before any model call. */
export const extractRequestSchema = z.object({
  instruction: z.string().min(1).max(1000),
  columnLabel: z.string().min(1).max(200),
  answerType: z.enum(["text", "number", "categorical"]),
  unit: z.string().max(40).optional(),
  options: z.array(z.string().max(80)).max(40).optional(),
  question: z.string().max(1000).optional(),
  configurationLabel: z.string().max(200).optional(),
  documentTitle: z.string().max(300),
  pages: z
    .array(
      z.object({
        pageNumber: z.number().int().min(1),
        text: z.string().max(20000),
      }),
    )
    .min(1)
    .max(40),
});

export type ExtractRequest = z.infer<typeof extractRequestSchema>;
