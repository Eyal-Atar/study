# Technology Stack

**Analysis Date:** 2026-02-17

## Languages

**Primary:**
- Python 3.x - Backend API and AI integration
- JavaScript (ES6+) - Frontend client application
- HTML5 - Frontend markup with Tailwind CSS utility classes

**Secondary:**
- SQL - SQLite database queries

## Runtime

**Environment:**
- Python 3.x (development/production)
- Node.js (for frontend dependencies only, not required for running application)

**Package Manager:**
- pip (Python)
- No package.json found - frontend is vanilla JavaScript with no build step

## Frameworks

**Core:**
- FastAPI 0.115.0 - REST API framework for backend
- Uvicorn 0.30.6 - ASGI server for running FastAPI application

**Frontend:**
- Tailwind CSS (via CDN) - Utility-first CSS framework for styling
- Vanilla JavaScript - No frontend framework; direct DOM manipulation

**PDF Processing:**
- PyMUPDF (pymupdf) 1.24.10 - PDF text extraction for exam materials

**Data Validation:**
- Pydantic 2.9.2 - Data validation and settings management

## Key Dependencies

**Critical:**
- anthropic 0.34.2 - Anthropic API client for Claude integration (exam brain AI)
- python-multipart 0.0.9 - Multipart form data parsing for file uploads
- python-dotenv 1.0.1 - Environment variable loading from .env files

**Infrastructure:**
- sqlite3 - Built-in Python SQLite database driver (no external package needed)

## Configuration

**Environment:**
- Configured via environment variables loaded by python-dotenv
- ANTHROPIC_API_KEY - Required for AI features (exam analysis and calendar generation)
- No database URL needed - SQLite file stored locally at `backend/study_scheduler.db`

**Build:**
- No build process - frontend is served as static HTML/CSS/JS
- Backend runs directly with uvicorn in development mode with auto-reload

## Platform Requirements

**Development:**
- Python 3.x installation
- Backend runs on localhost:8000 with uvicorn
- Frontend served as static files from `/frontend/index.html`
- CORS middleware enabled to allow frontend-to-backend communication

**Production:**
- Python 3.x runtime
- Uvicorn server (or compatible ASGI server)
- Environment variable `ANTHROPIC_API_KEY` must be set
- SQLite database file writable at configured path `backend/study_scheduler.db`
- Frontend assets must be accessible at `/css` and `/js` routes

---

*Stack analysis: 2026-02-17*
