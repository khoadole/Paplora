import { readAiConfig } from "../extract/model";

/**
 * One place that knows how to call the Responses API and read what comes back.
 *
 * `output_text` is a convenience field that is not always present, so the text
 * is also collected from the output items. Reading only `output_text` is why an
 * earlier version of the column suggester failed on a perfectly good response.
 */

export interface ResponsesResult {
  text: string;
  citations: { url: string; title?: string }[];
  searched: boolean;
  usage: { input: number; output: number };
}

export async function callResponses(
  body: Record<string, unknown>,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<ResponsesResult> {
  const config = readAiConfig();
  if (!config.configured || !config.model) throw new Error(config.reason ?? "AI is not configured.");
  const doFetch = options.fetchImpl ?? fetch;

  const response = await doFetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: config.model, ...body }),
    signal: options.signal,
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("The API key was rejected by OpenAI.");
    if (response.status === 404) throw new Error(`The configured model "${config.model}" is not available to this account.`);
    if (response.status === 429) throw new Error("OpenAI rate-limited this request. Try again shortly.");
    throw new Error(`OpenAI returned ${response.status}.`);
  }

  const payload = (await response.json()) as {
    output?: {
      type?: string;
      content?: { type?: string; text?: string; annotations?: { url?: string; title?: string }[] }[];
    }[];
    output_text?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  let text = "";
  const citations: { url: string; title?: string }[] = [];
  let searched = false;
  for (const item of payload.output ?? []) {
    if (item.type === "web_search_call") searched = true;
    for (const part of item.content ?? []) {
      if (typeof part.text === "string") text += part.text;
      for (const annotation of part.annotations ?? []) {
        if (annotation.url) citations.push({ url: annotation.url, title: annotation.title });
      }
    }
  }
  if (!text && payload.output_text) text = payload.output_text;

  return {
    text,
    citations,
    searched,
    usage: { input: payload.usage?.input_tokens ?? 0, output: payload.usage?.output_tokens ?? 0 },
  };
}

/** Pulls the first JSON object out of a reply that may be wrapped in prose. */
export function extractJson(text: string): unknown | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
