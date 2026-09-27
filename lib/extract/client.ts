import { ANSWER_JSON_SCHEMA, answerSchema, type ExtractRequest, type ModelAnswer } from "./schema";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt";

/**
 * The OpenAI adapter. Server-side only — the key never leaves the server, and
 * nothing here logs document text or the key itself.
 *
 * Kept behind this one function so the boundary can be mocked in tests and
 * swapped for another provider without touching the verification path.
 */

export interface CallOptions {
  apiKey: string;
  model: string;
  signal?: AbortSignal;
  /** Injected in tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class ExtractionError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ExtractionError";
  }
}

export async function callModel(
  input: ExtractRequest,
  options: CallOptions,
): Promise<{ answer: ModelAnswer; model: string }> {
  const doFetch = options.fetchImpl ?? fetch;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 90_000);
  const signal = options.signal
    ? // Either the caller cancelling or the timeout ends the request.
      (AbortSignal as unknown as { any(list: AbortSignal[]): AbortSignal }).any([options.signal, timeout])
    : timeout;

  let response: Response;
  try {
    response = await doFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.apiKey}`,
      },
      signal,
      body: JSON.stringify({
        model: options.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(input) },
        ],
        response_format: { type: "json_schema", json_schema: ANSWER_JSON_SCHEMA },
        max_completion_tokens: 1500,
      }),
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError" || (error as Error)?.name === "TimeoutError") {
      throw new ExtractionError("The extraction request was cancelled or timed out.", true);
    }
    throw new ExtractionError("Could not reach the model provider.", true);
  }

  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    // Provider error bodies can echo request content, so only the status is surfaced.
    if (response.status === 401 || response.status === 403) {
      throw new ExtractionError("The API key was rejected by the provider.", false);
    }
    if (response.status === 404) {
      throw new ExtractionError(
        `The provider does not offer the model "${options.model}". Set OPENAI_MODEL to a model your account can call.`,
        false,
      );
    }
    throw new ExtractionError(
      `The model provider returned ${response.status}.`,
      retryable,
    );
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
  };
  const choice = payload.choices?.[0];
  const content = choice?.message?.content;
  if (!content) {
    throw new ExtractionError("The model returned an empty response.", true);
  }
  if (choice?.finish_reason === "length") {
    throw new ExtractionError("The model ran out of output budget before finishing.", true);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new ExtractionError("The model returned something that is not JSON.", true);
  }

  const parsed = answerSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ExtractionError("The model's answer did not match the required schema.", true);
  }
  return { answer: parsed.data, model: options.model };
}
