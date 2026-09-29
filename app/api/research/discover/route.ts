import { discoverPapers } from "@/lib/server/discover";
import { readAiConfig } from "@/lib/extract/model";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Discovery, streamed as newline-delimited JSON so the client can show what is
 * actually happening. Every event comes from a real step, never a timer.
 */
export async function POST(request: Request) {
  const config = readAiConfig();
  if (!config.configured) {
    return Response.json({ error: config.reason ?? "AI is not configured.", code: "not_configured" }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as { question?: string };
  const question = (body.question ?? "").trim();
  if (question.length < 8 || question.length > 2000) {
    return Response.json({ error: "Describe what you are looking for in a sentence or two.", code: "bad_request" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        const result = await discoverPapers(question, {
          signal: request.signal,
          onEvent: (event) => send(event),
        });
        send({ type: "result", ...result });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Discovery failed.";
        send({ type: "error", message: request.signal.aborted ? "Cancelled." : message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" },
  });
}
