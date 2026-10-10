"""Groq LLM call that extracts JD keywords and judges the CV against them."""

import json

from django.conf import settings
from groq import Groq

MAX_CHARS = 15000

SYSTEM_PROMPT = """You are an expert technical recruiter and ATS (Applicant Tracking System) specialist.
You compare a candidate's CV against a job description and respond ONLY with a JSON object.

Rules:
- Extract the important keywords from the JOB DESCRIPTION only: hard skills, tools, technologies,
  certifications, methodologies, domain knowledge, soft skills, and required qualifications.
  Return 15-35 keywords. Use the short canonical form an ATS would search for (e.g. "React", "AWS", "CI/CD").
- For each keyword decide how the CV covers it:
  "exact"    = the term (or an obvious spelling variant) appears in the CV,
  "semantic" = the CV clearly shows the skill using different wording or a close equivalent,
  "missing"  = no evidence in the CV.
- "evidence" is a short quote or paraphrase from the CV proving the match, or "" when missing.
- Be strict and honest. Do not invent experience the CV does not show.
- Scores are integers from 0 to 100."""

USER_TEMPLATE = """Return JSON with exactly this shape:
{{
  "job_title": string,
  "candidate_name": string,
  "summary": string (2-3 sentence overall verdict),
  "keywords": [
    {{
      "keyword": string,
      "category": "hard_skill" | "tool" | "soft_skill" | "qualification" | "domain",
      "importance": "required" | "preferred",
      "match": "exact" | "semantic" | "missing",
      "evidence": string
    }}
  ],
  "scores": {{
    "skills": int,       // how well skills match the role
    "experience": int,   // relevance and seniority of work experience
    "education": int,    // degrees/certifications vs requirements (80 if the JD states none)
    "impact": int        // quantified achievements, action verbs, clarity
  }},
  "strengths": [string],     // 3-5 items
  "gaps": [string],          // 3-5 items
  "suggestions": [string]    // 4-6 concrete, actionable CV edits for this job
}}

=== JOB DESCRIPTION ===
{jd}

=== CANDIDATE CV ===
{cv}"""


class LLMError(RuntimeError):
    pass


def analyze_with_llm(cv_text: str, jd_text: str) -> dict:
    if not settings.GROQ_API_KEY or settings.GROQ_API_KEY.startswith("your_"):
        raise LLMError("GROQ_API_KEY is not configured on the server.")

    client = Groq(api_key=settings.GROQ_API_KEY)
    try:
        completion = client.chat.completions.create(
            model=settings.GROQ_MODEL,
            temperature=0.1,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": USER_TEMPLATE.format(
                        jd=jd_text[:MAX_CHARS], cv=cv_text[:MAX_CHARS]
                    ),
                },
            ],
        )
    except Exception as exc:
        raise LLMError(f"Groq API request failed: {exc}") from exc

    content = completion.choices[0].message.content or ""
    try:
        return json.loads(content)
    except json.JSONDecodeError as exc:
        raise LLMError("The model returned invalid JSON. Please try again.") from exc
