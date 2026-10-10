"""Combine LLM judgement with deterministic checks into an ATS score.

ATS score = 50% keyword match + 35% semantic fit (LLM) + 15% formatting.
Keyword matches claimed by the LLM are double-checked against the CV text, so
a hallucinated "exact" match is downgraded.
"""

import re

KEYWORD_WEIGHT = 0.50
FIT_WEIGHT = 0.35
FORMAT_WEIGHT = 0.15

IMPORTANCE_WEIGHT = {"required": 2.0, "preferred": 1.0}
MATCH_CREDIT = {"exact": 1.0, "semantic": 0.6, "missing": 0.0}
FIT_WEIGHTS = {"skills": 0.35, "experience": 0.35, "education": 0.15, "impact": 0.15}

SECTION_PATTERNS = {
    "Experience": r"\b(work\s+)?experience\b|\bemployment\b|\bwork history\b",
    "Education": r"\beducation\b|\bacademic\b|\bqualifications?\b",
    "Skills": r"\bskills\b|\btechnologies\b|\btech stack\b|\bcompetencies\b",
    "Summary": r"\bsummary\b|\bprofile\b|\bobjective\b|\babout me\b",
}

QUANTIFIED = re.compile(
    r"\d+\s?%|[$€£¥]\s?\d|\b\d+[kKmM+]?\s+(users|clients|customers|projects|people|engineers)\b"
)


def _clamp(value, low=0, high=100) -> int:
    try:
        return int(max(low, min(high, round(float(value)))))
    except (TypeError, ValueError):
        return 0


def _in_text(keyword: str, text_lower: str, squashed_text: str) -> bool:
    kw = keyword.lower().strip()
    if not kw:
        return False
    # Word boundaries that still work for terms like "C++", "Node.js", "CI/CD".
    pattern = r"(?<![a-z0-9])" + re.escape(kw) + r"(?![a-z0-9])"
    if re.search(pattern, text_lower):
        return True
    # Tolerate punctuation/spacing variants: "nodejs" vs "node.js", "ci cd" vs "ci/cd".
    squashed_kw = re.sub(r"[^a-z0-9+#]", "", kw)
    return len(squashed_kw) >= 4 and squashed_kw in squashed_text


def _normalize_keywords(raw_keywords, cv_text: str) -> list[dict]:
    cv_lower = cv_text.lower()
    cv_squashed = re.sub(r"[^a-z0-9+#]", "", cv_lower)
    keywords, seen = [], set()
    for item in raw_keywords or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("keyword", "")).strip()
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())

        match = item.get("match", "missing")
        if match not in MATCH_CREDIT:
            match = "missing"
        if _in_text(name, cv_lower, cv_squashed):
            match = "exact"
        elif match == "exact":
            match = "semantic"  # LLM said exact but the term isn't literally there

        importance = item.get("importance", "preferred")
        if importance not in IMPORTANCE_WEIGHT:
            importance = "preferred"

        keywords.append(
            {
                "keyword": name,
                "category": item.get("category", "hard_skill"),
                "importance": importance,
                "match": match,
                "evidence": str(item.get("evidence", "")).strip() if match != "missing" else "",
            }
        )
    return keywords


def _keyword_score(keywords: list[dict]) -> int:
    total = sum(IMPORTANCE_WEIGHT[k["importance"]] for k in keywords)
    if not total:
        return 0
    earned = sum(IMPORTANCE_WEIGHT[k["importance"]] * MATCH_CREDIT[k["match"]] for k in keywords)
    return _clamp(100 * earned / total)


def _format_checks(cv_text: str) -> list[dict]:
    lower = cv_text.lower()
    words = len(cv_text.split())
    checks = [
        {
            "label": "Email address",
            "passed": bool(re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", cv_text)),
            "tip": "Add a professional email address at the top.",
        },
        {
            "label": "Phone number",
            "passed": bool(re.search(r"\+?\d[\d\s().-]{7,}\d", cv_text)),
            "tip": "Add a phone number so recruiters can reach you.",
        },
        {
            "label": "LinkedIn / portfolio link",
            "passed": bool(re.search(r"linkedin\.com|github\.com|https?://", lower)),
            "tip": "Link your LinkedIn, GitHub, or portfolio.",
        },
        {
            "label": "Length between 300 and 1200 words",
            "passed": 300 <= words <= 1200,
            "tip": f"Your CV has about {words} words. Aim for 300 to 1200.",
        },
        {
            "label": "Quantified achievements",
            "passed": len(QUANTIFIED.findall(cv_text)) >= 2,
            "tip": "Add numbers: percentages, revenue, users, team size, time saved.",
        },
    ]
    for section, pattern in SECTION_PATTERNS.items():
        checks.append(
            {
                "label": f"{section} section",
                "passed": bool(re.search(pattern, lower)),
                "tip": f"Add a clearly titled {section} heading. ATS parsers look for standard headings.",
            }
        )
    return checks


def _verdict(score: int) -> str:
    if score >= 80:
        return "Strong match"
    if score >= 65:
        return "Good match"
    if score >= 50:
        return "Fair match"
    return "Weak match"


def build_report(llm: dict, cv_text: str) -> dict:
    keywords = _normalize_keywords(llm.get("keywords"), cv_text)

    raw_scores = llm.get("scores") or {}
    fit = {name: _clamp(raw_scores.get(name)) for name in FIT_WEIGHTS}
    fit_score = _clamp(sum(fit[n] * w for n, w in FIT_WEIGHTS.items()))

    checks = _format_checks(cv_text)
    format_score = _clamp(100 * sum(c["passed"] for c in checks) / len(checks))

    keyword_score = _keyword_score(keywords)
    ats_score = _clamp(
        keyword_score * KEYWORD_WEIGHT + fit_score * FIT_WEIGHT + format_score * FORMAT_WEIGHT
    )

    def str_list(key):
        return [str(x).strip() for x in (llm.get(key) or []) if str(x).strip()]

    return {
        "ats_score": ats_score,
        "verdict": _verdict(ats_score),
        "job_title": str(llm.get("job_title", "")).strip(),
        "candidate_name": str(llm.get("candidate_name", "")).strip(),
        "summary": str(llm.get("summary", "")).strip(),
        "breakdown": {
            "keywords": keyword_score,
            "fit": fit_score,
            "formatting": format_score,
            **fit,
        },
        "keywords": keywords,
        "keyword_stats": {
            "total": len(keywords),
            "exact": sum(k["match"] == "exact" for k in keywords),
            "semantic": sum(k["match"] == "semantic" for k in keywords),
            "missing": sum(k["match"] == "missing" for k in keywords),
        },
        "format_checks": checks,
        "strengths": str_list("strengths"),
        "gaps": str_list("gaps"),
        "suggestions": str_list("suggestions"),
    }
