from django.conf import settings
from django.http import JsonResponse
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .services.extract import ExtractionError, clean_text, extract_text
from .services.llm import LLMError, analyze_with_llm
from .services.scoring import build_report


def health(request):
    return JsonResponse({"status": "ok", "model": settings.GROQ_MODEL})


class AnalyzeView(APIView):
    """POST multipart: cv (file) or cv_text (string) + jd_file (file) or jd_text (string)."""

    def post(self, request):
        cv_file = request.FILES.get("cv")
        cv_text = (request.data.get("cv_text") or "").strip()
        jd_file = request.FILES.get("jd_file")
        jd_text = (request.data.get("jd_text") or "").strip()

        if not cv_file and not cv_text:
            return self._error("Please upload your CV (PDF or DOCX).")
        if not jd_file and not jd_text:
            return self._error("Please provide a job description as text or a file.")

        max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
        for f in filter(None, (cv_file, jd_file)):
            if f.size > max_bytes:
                return self._error(f"'{f.name}' exceeds the {settings.MAX_UPLOAD_MB} MB limit.")

        try:
            # Edited text from the CV editor takes precedence over the original file.
            cv_text = clean_text(cv_text) if cv_text else extract_text(cv_file)
            jd_text = extract_text(jd_file) if jd_file else clean_text(jd_text)
        except ExtractionError as exc:
            return self._error(str(exc))

        if len(cv_text) < 50:
            return self._error("The CV is too short to analyze.")
        if len(jd_text) < 50:
            return self._error("The job description is too short to analyze.")

        try:
            llm_result = analyze_with_llm(cv_text, jd_text)
        except LLMError as exc:
            return self._error(str(exc), status.HTTP_502_BAD_GATEWAY)

        return Response(build_report(llm_result, cv_text))

    @staticmethod
    def _error(message, code=status.HTTP_400_BAD_REQUEST):
        return Response({"error": message}, status=code)
