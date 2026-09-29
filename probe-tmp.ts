async function main() {
  const body = {
    model: process.env.OPENAI_MODEL,
    instructions:
      "You help a researcher find papers. Search before answering. Only list a paper if you found a real page for it, and give that exact URL. Never invent metadata.",
    input: [
      {
        role: "user",
        content:
          'Find action recognition methods suitable for edge devices, realtime inference, available code. Reply JSON only: {"overview":string,"papers":[{"title":string,"url":string,"why":string,"description":string,"codeUrl":string}]}',
      },
    ],
    tools: [{ type: "web_search" }],
    tool_choice: "auto",
    max_output_tokens: 3000,
  };
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify(body),
  });
  const d = (await r.json()) as any;
  const citations: { url: string; title?: string }[] = [];
  let text = d.output_text ?? "";
  for (const item of d.output ?? []) {
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && part.text && !d.output_text) text += part.text;
      for (const a of part.annotations ?? []) if (a.url) citations.push({ url: a.url, title: a.title });
    }
  }
  console.log("CITATIONS:", citations.length);
  for (const c of citations.slice(0, 12)) console.log("  ", c.url.slice(0, 110), "|", (c.title ?? "").slice(0, 50));
  const start = text.indexOf("{");
  const parsed = JSON.parse(text.slice(start, text.lastIndexOf("}") + 1));
  console.log("\nMODEL PAPERS:", parsed.papers?.length);
  for (const p of parsed.papers ?? []) console.log("  ", p.title.slice(0, 60), "->", p.url.slice(0, 100));
}
main().catch((e) => console.error("FAILED:", e.message));
