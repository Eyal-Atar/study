---
status: resolved
trigger: "ERR_NGROK_8012 error when opening ngrok URL."
created: 2026-03-21T16:48:13Z
updated: 2026-03-21T16:55:00Z
---

## Root Cause

Port 8000 was already in use by a zombie or existing process (PID 81365). `start.sh` launched the backend in the background but did not verify it successfully bound to the port before starting ngrok. When ngrok received traffic, it failed to connect to the backend (Bad Gateway / 8012).

## Resolution

1.  **Cleared port:** Manually killed the zombie process on port 8000.
2.  **Updated `backend/run.py`**: Added support for the `PORT` environment variable to ensure consistency with the startup script and `.env`.
3.  **Hardened `start.sh`**:
    -   Added a pre-check using `lsof` to ensure the port is available before starting the server.
    -   Added a wait and verification step to ensure the backend binds successfully before proceeding.
    -   Ensured ngrok uses `127.0.0.1` explicitly to avoid macOS IPv6 localhost resolution issues.

## Evidence

- Manual check showed port 8000 was in use.
- Starting the server manually failed with "Address already in use".
- After killing the process and applying the fixes, ngrok successfully tunnels traffic to the backend.

## Verification

Run `./start.sh --ngrok`. The script now confirms port availability and ensures the backend is listening before ngrok starts.

files_changed: 
- backend/run.py
- start.sh
