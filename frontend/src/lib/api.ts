export type MatchType = "exact" | "semantic" | "missing";

export interface Keyword {
  keyword: string;
  category: "hard_skill" | "tool" | "soft_skill" | "qualification" | "domain";
  importance: "required" | "preferred";
  match: MatchType;
  evidence: string;
}

export interface FormatCheck {
  label: string;
  passed: boolean;
  tip: string;
}

export interface AnalysisResult {
  ats_score: number;
  verdict: string;
  job_title: string;
  candidate_name: string;
  summary: string;
  breakdown: {
    keywords: number;
    fit: number;
    formatting: number;
    skills: number;
    experience: number;
    education: number;
    impact: number;
  };
  keywords: Keyword[];
  keyword_stats: { total: number; exact: number; semantic: number; missing: number };
  format_checks: FormatCheck[];
  strengths: string[];
  gaps: string[];
  suggestions: string[];
}

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001").replace(/\/$/, "");

export async function analyzeCv(cv: File, jd: { file?: File; text?: string }): Promise<AnalysisResult> {
  const body = new FormData();
  body.append("cv", cv);
  if (jd.file) body.append("jd_file", jd.file);
  else if (jd.text) body.append("jd_text", jd.text);

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/analyze/`, { method: "POST", body });
  } catch {
    throw new Error(
      `Cannot reach the analysis server at ${API_URL}. Check that the Django backend is running on that port ` +
        `and that it allows requests from ${window.location.origin} (CORS).`,
    );
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error ?? `Analysis failed (HTTP ${res.status}).`);
  }
  return data as AnalysisResult;
}
