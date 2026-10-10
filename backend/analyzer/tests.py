import io
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, override_settings
from docx import Document

from .services.scoring import build_report

CV_TEXT = """Jane Doe  jane@example.com  +1 555 123 4567  linkedin.com/in/jane
Summary: Frontend engineer with 5 years building React and Next.js apps.
Experience: Acme Corp. Built TypeScript dashboards used by 20000 users, cut load time 40%.
Skills: React, Next.js, TypeScript, Tailwind CSS, Jest, Git, REST APIs, nodejs
Education: BSc Computer Science"""

LLM_RESULT = {
    "job_title": "Frontend Engineer",
    "candidate_name": "Jane Doe",
    "summary": "Good fit.",
    "keywords": [
        {"keyword": "React", "importance": "required", "match": "exact", "evidence": "React"},
        {"keyword": "Node.js", "importance": "preferred", "match": "missing", "evidence": ""},
        {"keyword": "GraphQL", "importance": "required", "match": "exact", "evidence": "?"},
        {"keyword": "AWS", "importance": "required", "match": "missing", "evidence": ""},
    ],
    "scores": {"skills": 80, "experience": 75, "education": 90, "impact": 70},
    "strengths": ["React"],
    "gaps": ["AWS"],
    "suggestions": ["Add AWS"],
}


def docx_upload(text: str, name="cv.docx") -> SimpleUploadedFile:
    doc = Document()
    for line in text.splitlines():
        doc.add_paragraph(line)
    buf = io.BytesIO()
    doc.save(buf)
    return SimpleUploadedFile(name, buf.getvalue())


class ScoringTests(SimpleTestCase):
    def test_keyword_matches_are_verified_against_cv(self):
        report = build_report(LLM_RESULT, CV_TEXT)
        matches = {k["keyword"]: k["match"] for k in report["keywords"]}
        self.assertEqual(matches["React"], "exact")
        self.assertEqual(matches["Node.js"], "exact")  # "nodejs" in CV
        self.assertEqual(matches["GraphQL"], "semantic")  # LLM over-claimed
        self.assertEqual(matches["AWS"], "missing")

    def test_score_is_bounded_and_survives_garbage(self):
        report = build_report({"keywords": "nope", "scores": {"skills": "abc"}}, CV_TEXT)
        self.assertTrue(0 <= report["ats_score"] <= 100)
        self.assertEqual(report["keywords"], [])


@override_settings(ALLOWED_HOSTS=["testserver"])
class AnalyzeEndpointTests(SimpleTestCase):
    url = "/api/analyze/"

    @patch("analyzer.views.analyze_with_llm", return_value=LLM_RESULT)
    def test_docx_cv_with_text_jd(self, _mock):
        res = self.client.post(
            self.url, {"cv": docx_upload(CV_TEXT), "jd_text": "React engineer with GraphQL and AWS. " * 3}
        )
        self.assertEqual(res.status_code, 200)
        self.assertIn("ats_score", res.json())

    @patch("analyzer.views.analyze_with_llm", return_value=LLM_RESULT)
    def test_jd_as_file(self, _mock):
        jd = SimpleUploadedFile("jd.txt", b"We want a React engineer with GraphQL and AWS skills, 3+ years.")
        res = self.client.post(self.url, {"cv": docx_upload(CV_TEXT), "jd_file": jd})
        self.assertEqual(res.status_code, 200)

    def test_missing_cv(self):
        res = self.client.post(self.url, {"jd_text": "x" * 60})
        self.assertEqual(res.status_code, 400)

    def test_unsupported_type(self):
        res = self.client.post(self.url, {"cv": SimpleUploadedFile("cv.png", b"x"), "jd_text": "x" * 60})
        self.assertEqual(res.status_code, 400)
        self.assertIn("Unsupported", res.json()["error"])
