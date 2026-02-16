# Study AI Scheduler — Roadmap

## Phase 1: Backend Core ✅ DONE
- [x] Project structure (backend folder, venv, dependencies)
- [x] SQLite database (users, tasks, schedule_blocks tables)
- [x] FastAPI server with CORS
- [x] User CRUD endpoints (POST /users, GET /users/{id})
- [x] Task CRUD endpoints (POST /tasks, GET /users/{id}/tasks, PATCH /tasks/{id}/done)
- [x] PDF upload + text extraction (PyMuPDF)
- [x] Claude AI integration for syllabus parsing
- [x] Scheduling algorithm (pomodoro/continuous, priority by deadline + difficulty)
- [x] Schedule generation endpoint (POST /users/{id}/generate-schedule)

## Phase 2: Frontend (Next)
- [ ] Simple HTML + Tailwind dashboard (single page to start)
- [ ] Onboarding form (name, study preferences)
- [ ] Upload syllabus UI
- [ ] Schedule view (daily timeline)
- [ ] Task list with "done" checkboxes
- [ ] Progress tracking

## Phase 3: Polish & Features
- [ ] Google Calendar integration (OAuth + sync)
- [ ] Motivational notifications (Claude-powered personality)
- [ ] Cron job for reminders
- [ ] Better scheduling (avoid back-to-back hard subjects)
- [ ] Task editing and rescheduling

## Phase 4: Deploy
- [ ] Backend → Render
- [ ] Frontend → Vercel
- [ ] PWA support (installable on phone)
- [ ] Custom domain

## Tech Stack
- **Backend**: Python, FastAPI, SQLite, PyMuPDF, Anthropic Claude API
- **Frontend**: HTML, Tailwind CSS (later: React)
- **AI**: Claude Sonnet for syllabus parsing + notifications
