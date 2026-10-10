"use client";

import { useState } from "react";
import FileDrop from "./FileDrop";
import Results from "./Results";
import { analyzeCv, type AnalysisResult } from "@/lib/api";

type JdMode = "text" | "file";

export default function Analyzer() {
  const [cv, setCv] = useState<File | null>(null);
  const [jdMode, setJdMode] = useState<JdMode>("text");
  const [jdText, setJdText] = useState("");
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);

  const jdReady = jdMode === "text" ? jdText.trim().length >= 50 : jdFile !== null;
  const canSubmit = cv !== null && jdReady && !loading;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cv) return;
    setLoading(true);
    setError(null);
    try {
      const data = await analyzeCv(cv, jdMode === "text" ? { text: jdText } : { file: jdFile! });
      setResult(data);
      requestAnimationFrame(() =>
        document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-10">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="card">
            <StepHeader step={1} title="Your CV" subtitle="PDF or DOCX, up to 5 MB" />
            <FileDrop file={cv} onChange={setCv} accept={[".pdf", ".docx"]} hint="PDF or DOCX" />
          </section>

          <section className="card">
            <div className="flex items-start justify-between gap-4">
              <StepHeader step={2} title="Job description" subtitle="Paste text or upload a file" />
              <div className="flex shrink-0 rounded-lg bg-surface-2 p-1 text-sm" role="tablist">
                {(["text", "file"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={jdMode === mode}
                    onClick={() => setJdMode(mode)}
                    className={`rounded-md px-3 py-1 font-medium capitalize ${
                      jdMode === mode ? "bg-surface text-foreground shadow-sm" : "text-muted"
                    }`}
                  >
                    {mode === "text" ? "Paste" : "Upload"}
                  </button>
                ))}
              </div>
            </div>
            {jdMode === "text" ? (
              <div>
                <textarea
                  value={jdText}
                  onChange={(e) => setJdText(e.target.value)}
                  placeholder="Paste the full job description here…"
                  rows={8}
                  className="w-full resize-y rounded-xl border border-line bg-surface-2 p-3 text-sm outline-none placeholder:text-muted focus:border-accent"
                />
                <p className="mt-1 text-right text-xs text-muted">
                  {jdText.trim().length < 50
                    ? `${50 - jdText.trim().length} more characters needed`
                    : `${jdText.trim().split(/\s+/).length} words`}
                </p>
              </div>
            ) : (
              <FileDrop
                file={jdFile}
                onChange={setJdFile}
                accept={[".pdf", ".docx", ".txt"]}
                hint="PDF, DOCX, or TXT"
              />
            )}
          </section>
        </div>

        {error && (
          <div className="rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad" role="alert">
            {error}
          </div>
        )}

        <div className="flex justify-center">
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex min-w-56 items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3 font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading && (
              <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            )}
            {loading ? "Analyzing…" : "Analyze my CV"}
          </button>
        </div>
      </form>

      {result && (
        <div id="results" className="scroll-mt-6">
          <Results result={result} />
        </div>
      )}
    </div>
  );
}

function StepHeader({ step, title, subtitle }: { step: number; title: string; subtitle: string }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent">
        {step}
      </span>
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-xs text-muted">{subtitle}</p>
      </div>
    </div>
  );
}
