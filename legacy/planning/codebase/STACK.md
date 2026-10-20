# Technology Stack

**Analysis Date:** 2026-02-20

## Languages

**Primary:**
- Python 3.x - Backend API and AI integration
- JavaScript (ES6+) - Modularized frontend client application
- HTML5 - Frontend markup with Tailwind CSS utility classes

**Secondary:**
- SQL - SQLite database queries

## Runtime

**Environment:**
- Python 3.x (development/production)
- Node.js (not required for running application)

**Package Manager:**
- pip (Python)
- No package.json - frontend uses native ES6 modules with no build step

## Frameworks

**Core:**
- FastAPI 0.115.0 - REST API framework for backend
- Uvicorn 0.30.6 - ASGI server for running FastAPI application
- **Authlib 1.6.8** - Google OAuth and session management

**Frontend:**
- Tailwind CSS (via CDN) - Utility-first CSS framework for styling
- Vanilla JavaScript (ES6 Modules) - Direct DOM manipulation with modular structure
- **Event Calendar (vkurko)** - Lightweight calendar component

**PDF Processing:**
- PyMUPDF (pymupdf) 1.24.10 - PDF text extraction for exam materials

**Data Validation:**
- Pydantic 2.9.2 - Data validation and settings management

## Key Dependencies

**Critical:**
- anthropic 0.34.2 - Anthropic API client for Claude integration
- python-multipart 0.0.9 - Multipart form data parsing for file uploads
- python-dotenv 1.0.1 - Environment variable loading from .env files
- **httpx** - For asynchronous HTTP requests (used in OAuth)

**Infrastructure:**
- sqlite3 - Built-in Python SQLite database driver

## Configuration

**Environment:**
- ANTHROPIC_API_KEY - Required for AI features
- GOOGLE_CLIENT_ID - Required for OAuth
- GOOGLE_CLIENT_SECRET - Required for OAuth
- SECRET_KEY - For session signing (Phase 6)

**Build:**
- No build process - frontend is served as static HTML/CSS/JS via native ES6 imports
- Backend runs directly with uvicorn
