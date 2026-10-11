"use client";

import { useCallback, useState } from "react";
import CvEditor from "./CvEditor";
import FileDrop from "./FileDrop";
import Results from "./Results";
import StepHeader from "./StepHeader";
import { analyzeCv, type AnalysisResult } from "@/lib/api";

type JdMode = "text" | "file";

export default function Analyzer() {
  const [cv, setCv] = useState<File | null>(null);
  const [cvText, setCvText] = useState("");
  const [cvOriginal, setCvOriginal] = useState<string | null>(null);
  const [jdMode, setJdMode] = useState<JdMode>("text");
  const [jdText, setJdText] = useState("");
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);

  const cvEdited = cvOriginal !== null && cvText !== cvOriginal;
  const jdReady = jdMode === "text" ? jdText.trim().length >= 50 : jdFile !== null;
  const canSubmit = cv !== null && jdReady && !loading;

  function handleCvChange(file: File | null) {
    if (cvEdited && !confirm("Discard the edits you made to your CV?")) return;
    setCv(file);
    setCvOriginal(null);
    setCvText("");
    setError(null);
  }

  const handleCvLoad = useCallback((text: string | null) => {
    setCvOriginal(text);
    setCvText(text ?? "");
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cv) return;
    setLoading(true);
    setError(null);
    try {
      const data = await analyzeCv(
        cvEdited ? { text: cvText } : { file: cv },
        jdMode === "text" ? { text: jdText } : { file: jdFile! },
      );
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
    <>
      <div className="flex flex-col gap-5 px-4 py-6 sm:px-8 lg:h-dvh">
        <header className="shrink-0 text-center">
          <p className="mb-2 inline-block rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
            AI-powered ATS check
          </p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">CV Analyzer</h1>
          <p className="mx-auto mt-1 max-w-3xl text-sm text-muted">
            Upload your CV and a job description to get an ATS score, see which keywords you match or miss, then edit
            your CV right here, keeping its original layout.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 lg:grid-cols-[minmax(340px,2fr)_3fr] [&>*]:min-w-0">
            <div className="flex min-h-0 flex-col gap-5">
              <section className="card shrink-0">
                <StepHeader step={1} title="Your CV" subtitle="PDF or DOCX, up to 5 MB" />
                <FileDrop file={cv} onChange={handleCvChange} accept={[".pdf", ".docx"]} hint="PDF or DOCX" />
              </section>

              <section className="card flex min-h-0 flex-1 flex-col">
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
                  <div className="flex min-h-0 flex-1 flex-col">
                    <textarea
                      value={jdText}
                      onChange={(e) => setJdText(e.target.value)}
                      placeholder="Paste the full job description here…"
                      rows={8}
                      className="min-h-40 w-full flex-1 resize-y lg:resize-none rounded-xl border border-line bg-surface-2 p-3 text-sm outline-none placeholder:text-muted focus:border-accent"
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

            <CvEditor
              file={cv}
              edited={cvEdited}
              onLoad={handleCvLoad}
              onTextChange={setCvText}
              text={cvText}
              missingKeywords={result?.keywords.filter((k) => k.match === "missing").map((k) => k.keyword) ?? []}
            />
          </div>

          {error && (
            <div className="rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad" role="alert">
              {error}
            </div>
          )}

          <div className="flex shrink-0 justify-center">
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex min-w-56 items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3 font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading && <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
              {loading
                ? "Analyzing…"
                : result
                  ? cvEdited
                    ? "Re-analyze edited CV"
                    : "Re-analyze my CV"
                  : "Analyze my CV"}
            </button>
          </div>
        </form>
      </div>

      {result && (
        <div id="results" className="scroll-mt-6 px-4 pb-10 sm:px-8">
          <Results result={result} />
        </div>
      )}
    </>
  );
}
