"use client";

import { useState } from "react";
import type { AnalysisResult, Keyword, MatchType } from "@/lib/api";

function tone(score: number) {
  if (score >= 75) return "text-good";
  if (score >= 50) return "text-warn";
  return "text-bad";
}

function barTone(score: number) {
  if (score >= 75) return "bg-good";
  if (score >= 50) return "bg-warn";
  return "bg-bad";
}

export default function Results({ result }: { result: AnalysisResult }) {
  const { breakdown, keyword_stats: stats } = result;

  return (
    <div className="space-y-6">
      {/* Score overview */}
      <section className="card grid gap-8 md:grid-cols-[auto_1fr] md:items-center">
        <div className="flex flex-col items-center gap-2">
          <ScoreRing score={result.ats_score} />
          <span className={`text-sm font-semibold ${tone(result.ats_score)}`}>{result.verdict}</span>
        </div>
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">ATS match report</p>
            <h2 className="text-xl font-semibold">
              {result.candidate_name || "Your CV"}
              {result.job_title && <span className="text-muted"> → {result.job_title}</span>}
            </h2>
            {result.summary && <p className="mt-2 text-sm leading-relaxed text-muted">{result.summary}</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Bar label="Keyword match" value={breakdown.keywords} weight="50%" />
            <Bar label="Role fit" value={breakdown.fit} weight="35%" />
            <Bar label="Formatting" value={breakdown.formatting} weight="15%" />
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Keywords */}
        <section className="card lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="font-semibold">Keywords from the job description</h3>
              <p className="text-xs text-muted">
                {stats.exact + stats.semantic} of {stats.total} matched. Click a matched keyword to see evidence.
              </p>
            </div>
            <div className="flex gap-3 text-xs">
              <Legend className="bg-good" label={`Exact ${stats.exact}`} />
              <Legend className="bg-warn" label={`Related ${stats.semantic}`} />
              <Legend className="bg-bad" label={`Missing ${stats.missing}`} />
            </div>
          </div>
          <KeywordGroups keywords={result.keywords} />
        </section>

        {/* Fit breakdown */}
        <section className="card space-y-4">
          <h3 className="font-semibold">Role fit details</h3>
          <Bar label="Skills" value={breakdown.skills} />
          <Bar label="Experience" value={breakdown.experience} />
          <Bar label="Education" value={breakdown.education} />
          <Bar label="Impact & clarity" value={breakdown.impact} />
        </section>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <ListCard title="Strengths" items={result.strengths} icon="✓" iconClass="text-good" />
        <ListCard title="Gaps" items={result.gaps} icon="!" iconClass="text-bad" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <h3 className="mb-3 font-semibold">How to improve this CV for the job</h3>
          <ol className="space-y-3">
            {result.suggestions.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm leading-relaxed">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent">
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
        </section>

        <section className="card">
          <h3 className="mb-3 font-semibold">ATS formatting checks</h3>
          <ul className="space-y-2.5">
            {result.format_checks.map((c) => (
              <li key={c.label} className="text-sm">
                <div className="flex items-center gap-2">
                  <span className={c.passed ? "text-good" : "text-bad"}>{c.passed ? "✓" : "✗"}</span>
                  <span className={c.passed ? "" : "font-medium"}>{c.label}</span>
                </div>
                {!c.passed && <p className="ml-5 text-xs text-muted">{c.tip}</p>}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative size-36">
      <svg viewBox="0 0 120 120" className="size-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="10" className="stroke-surface-2" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - score / 100)}
          className={`${tone(score)} transition-[stroke-dashoffset] duration-1000`}
          stroke="currentColor"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-bold tabular-nums">{score}</span>
        <span className="text-xs text-muted">ATS score</span>
      </div>
    </div>
  );
}

function Bar({ label, value, weight }: { label: string; value: number; weight?: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span>
          {label}
          {weight && <span className="ml-1 text-xs text-muted">({weight})</span>}
        </span>
        <span className="font-semibold tabular-nums">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full ${barTone(value)}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-muted">
      <span className={`size-2.5 rounded-full ${className}`} />
      {label}
    </span>
  );
}

const MATCH_STYLE: Record<MatchType, string> = {
  exact: "border-good/40 bg-good/10 text-good",
  semantic: "border-warn/40 bg-warn/10 text-warn",
  missing: "border-bad/40 bg-bad/10 text-bad",
};

function KeywordGroups({ keywords }: { keywords: Keyword[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const selected = keywords.find((k) => k.keyword === open);
  const groups: { title: string; items: Keyword[] }[] = [
    { title: "Required", items: keywords.filter((k) => k.importance === "required") },
    { title: "Nice to have", items: keywords.filter((k) => k.importance === "preferred") },
  ];

  return (
    <div className="space-y-4">
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <div key={g.title}>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{g.title}</p>
            <div className="flex flex-wrap gap-2">
              {g.items.map((k) => (
                <button
                  key={k.keyword}
                  type="button"
                  disabled={k.match === "missing"}
                  onClick={() => setOpen(open === k.keyword ? null : k.keyword)}
                  className={`rounded-full border px-3 py-1 text-sm font-medium transition ${MATCH_STYLE[k.match]} ${
                    open === k.keyword ? "ring-2 ring-current/40" : ""
                  } disabled:cursor-default`}
                  title={k.match === "missing" ? "Not found in your CV" : "Show evidence"}
                >
                  {k.match === "missing" ? "✗ " : k.match === "exact" ? "✓ " : "≈ "}
                  {k.keyword}
                </button>
              ))}
            </div>
          </div>
        ))}
      {selected && selected.evidence && (
        <div className="rounded-xl bg-surface-2 p-3 text-sm">
          <span className="font-semibold">{selected.keyword}</span>
          <span className="text-muted"> · {selected.match === "exact" ? "found in CV" : "related experience"}</span>
          <p className="mt-1 italic text-muted">“{selected.evidence}”</p>
        </div>
      )}
    </div>
  );
}

function ListCard({ title, items, icon, iconClass }: { title: string; items: string[]; icon: string; iconClass: string }) {
  return (
    <section className="card">
      <h3 className="mb-3 font-semibold">{title}</h3>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm leading-relaxed">
            <span className={`font-bold ${iconClass}`}>{icon}</span>
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
