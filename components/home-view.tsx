"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import Link from "next/link";
import { useWorkspace } from "@/lib/workspace";
import { IconPlus, IconUpload } from "./icons";

/**
 * The workspace home.
 *
 * The input creates a local project from a research question. It is not a search
 * box: nothing is queried, no papers are discovered, no answers are simulated.
 * The next step is always "add your papers".
 */
export function HomeView() {
  const ws = useWorkspace();
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [working, setWorking] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  /** A question makes a poor title verbatim, so drop the interrogative opener. */
  const titleFromQuestion = (text: string) => {
    const clean = text.trim().replace(/\s+/g, " ");
    if (!clean) return "Untitled project";
    const short = clean
      .replace(/^(how|what|which|why|when|where)\s+(do|does|did|are|is|was|were|can|should)\b\s*/i, "")
      .replace(/^(how|what|which|why|do|does|are|is|can|should)\b\s*/i, "");
    const trimmed = (short || clean).replace(/[?.,;:]+\s*$/, "");
    return (trimmed.charAt(0).toUpperCase() + trimmed.slice(1)).slice(0, 70);
  };

  const create = async (openFilePicker: boolean) => {
    setWorking(true);
    try {
      const project = await ws.createProject({ title: titleFromQuestion(question), question: question.trim() });
      router.push(`/p/${project.id}${openFilePicker ? "?add=1" : ""}`);
    } finally {
      setWorking(false);
    }
  };

  const recent = ws.projects.slice(0, 6);
  const sample = ws.projects.find((p) => p.kind === "sample");

  return (
    <div className="scroll-area min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[860px] px-6 py-16">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">What are you researching?</h1>
        <p className="mt-1.5 text-[15px]" style={{ color: "var(--text-2)" }}>
          Bring your papers together and compare the evidence.
        </p>

        <div className="card mt-6 p-2" style={{ boxShadow: "var(--shadow-sm)" }}>
          <label className="sr-only" htmlFor="research-question">
            Research question
          </label>
          <textarea
            id="research-question"
            className="w-full resize-none bg-transparent px-2 py-2 text-[15px] leading-relaxed outline-none"
            rows={2}
            placeholder="How do these papers differ in methods, datasets, and reported results?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) create(false);
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-0.5 pt-1">
            <p className="text-[12px]" style={{ color: "var(--text-3)" }}>
              Creates a project on this device. Nothing is searched or sent anywhere.
            </p>
            <div className="flex items-center gap-1.5">
              <button className="btn" onClick={() => fileRef.current?.click()} disabled={working}>
                <IconUpload size={15} />
                Upload papers
              </button>
              <button className="btn btn-primary" onClick={() => create(false)} disabled={working}>
                <IconPlus size={15} />
                Create project
              </button>
            </div>
          </div>
        </div>

        {/* Choosing files first still creates the project, then carries the files in. */}
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="sr-only"
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            if (!files.length) return;
            setWorking(true);
            try {
              const project = await ws.createProject({
                title: titleFromQuestion(question) === "Untitled project" ? "New project" : titleFromQuestion(question),
                question: question.trim(),
              });
              await ws.uploadFiles(files, project.id);
              router.push(`/p/${project.id}`);
            } finally {
              setWorking(false);
              e.target.value = "";
            }
          }}
        />

        <section className="mt-12">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[13px] font-medium uppercase tracking-wide" style={{ color: "var(--text-3)" }}>
              Recent projects
            </h2>
            {!sample ? (
              <button
                className="text-[12.5px]"
                style={{ color: "var(--text-2)" }}
                onClick={async () => {
                  setWorking(true);
                  try {
                    const project = await ws.openSample();
                    if (project) router.push(`/p/${project.id}`);
                  } finally {
                    setWorking(false);
                  }
                }}
                disabled={working}
              >
                {ws.busy ?? "Open sample project"}
              </button>
            ) : null}
          </div>

          {recent.length === 0 ? (
            <p className="mt-3 text-[13.5px]" style={{ color: "var(--text-2)" }}>
              No projects yet. Write a question above, or open the sample project to see how a finished comparison
              looks.
            </p>
          ) : (
            <ul className="mt-2">
              {recent.map((project) => {
                const count = ws.projectPaperCount[project.id] ?? 0;
                return (
                  <li key={project.id} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                    <Link
                      href={`/p/${project.id}`}
                      className="flex items-baseline gap-3 py-2.5 transition-colors"
                    >
                      <span className="min-w-0 flex-1 truncate text-[14.5px]">{project.title}</span>
                      {project.kind === "sample" ? (
                        <span className="badge shrink-0">Sample</span>
                      ) : null}
                      <span className="shrink-0 text-[12.5px] tabular-nums" style={{ color: "var(--text-3)" }}>
                        {count} paper{count === 1 ? "" : "s"}
                      </span>
                      <span className="hidden shrink-0 text-[12.5px] sm:inline" style={{ color: "var(--text-3)" }}>
                        {relativeTime(project.updatedAt)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function relativeTime(at: number) {
  const seconds = Math.round((Date.now() - at) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(at).toLocaleDateString();
}
