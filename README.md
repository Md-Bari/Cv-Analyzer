# CV Analyzer

Upload a CV (PDF/DOCX) and a job description (text, PDF, DOCX, or TXT) to get an ATS score,
matched and missing keywords, and tailored improvement suggestions.

- **Frontend:** Next.js 16 + Tailwind CSS (`frontend/`)
- **Backend:** Django + Django REST Framework (`backend/`)
- **LLM:** Groq API

## Setup

### 1. Backend (port 8001)

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env      # then set GROQ_API_KEY in .env
python manage.py runserver 8001
```

Get a key at https://console.groq.com/keys. Change the model with `GROQ_MODEL` in `.env`.

### 2. Frontend (port 3000)

```powershell
cd frontend
npm install
copy .env.example .env.local
npm run dev
```

Open http://localhost:3000.

> The backend runs on 8001 because Docker/WSL already use port 8000 on this machine.
> If you change the port, update `NEXT_PUBLIC_API_URL` in `frontend/.env.local`.

## How the ATS score is calculated

| Component | Weight | Source |
|---|---|---|
| Keyword match | 50% | The LLM extracts 15-35 keywords from the JD. Each is verified against the CV text: exact = 1.0, related/synonym = 0.6, missing = 0. Required keywords count double. |
| Role fit | 35% | LLM ratings for skills, experience, education, and impact. |
| Formatting | 15% | Rule-based checks: contact info, links, standard section headings, length, quantified results. |

If the LLM claims an "exact" match but the term is not in the CV, the server downgrades it to "related",
which limits the effect of hallucinated matches.

## API

`POST /api/analyze/` (multipart/form-data)

| Field | Required | Notes |
|---|---|---|
| `cv` | yes | `.pdf` or `.docx` (also accepts `.txt`) |
| `jd_text` | one of | Job description as plain text |
| `jd_file` | one of | `.pdf`, `.docx`, or `.txt` |

`GET /api/health/` returns the server status and the configured model.

## Tests

```powershell
cd backend
.venv\Scripts\python manage.py test analyzer
```

## Limitations

- Scanned (image-only) PDFs have no extractable text. Use a PDF with selectable text.
- CV and JD text are each truncated to 15,000 characters before being sent to the LLM.
