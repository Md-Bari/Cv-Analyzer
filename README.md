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

## Deploy

The frontend and backend deploy separately. Push this repository to a Git provider
first so both Render and Vercel can import it. You can set up Vercel first to get
its site origin for the Render CORS setting.

### Frontend on Vercel

1. Import the repository into Vercel and set **Root Directory** to `frontend`.
   Vercel should detect Next.js automatically. The initial page can deploy before
   the API is available; analysis will work after the next steps.
2. Note the deployed site's origin (for example, `https://your-app.vercel.app`).

### Backend on Render

1. In Render, create a **Blueprint** from the repository. Render detects the root
   `render.yaml` and configures the Django web service.
2. Set `GROQ_API_KEY` to your key and `CORS_ALLOWED_ORIGINS` to the exact Vercel
   site origin noted above, with no trailing slash. Separate multiple origins
   with commas. Do not commit the Groq key.
3. After the service deploys, verify its Render URL plus `/api/health/` returns
   `{"status":"ok",...}`.

The Render configuration generates `DJANGO_SECRET_KEY`, disables Django debug
mode, and uses Gunicorn. Django automatically allows the service's Render hostname.

### Connect the frontend

1. In Vercel, set `NEXT_PUBLIC_API_URL` to the Render service's base URL, such as
   `https://cv-analyzer-api.onrender.com` (no trailing slash).
2. Set it for each Vercel environment you deploy, then redeploy the frontend so
   the API URL is included in its build.

You need a Groq API key for analysis requests; the health endpoint does not require it.

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
