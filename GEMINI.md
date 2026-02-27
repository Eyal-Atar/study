# Engineering Standards for StudyFlow

## Frontend Versioning & Caching
The project uses an **Automatic Build Hash** system to ensure users always see the latest code without manual version bumping.

### How it works:
1.  **Backend Injection:** `backend/server/__init__.py` computes a hash of all files in `frontend/js/` and `frontend/css/`.
2.  **Placeholders:** All asset references in `index.html`, `sw.js`, and JS module imports use the placeholder `?v=AUTO`.
3.  **Dynamic Replacement:** When serving these files, the backend automatically replaces `?v=AUTO` (and any other `?v=\w+` pattern) with the current build hash.

### Mandatory Rules for Developers (AI & Human):
- **NEVER** manually increment version numbers (e.g., `?v=35`).
- **ALWAYS** use `?v=AUTO` for all JavaScript module imports and asset links.
- **NEVER** remove the `?v=...` pattern from imports, as the server relies on it to force cache invalidation.
- **Build Hash Refresh:** The backend computes the hash based on file modification times. After making a set of changes, ALWAYS touch `frontend/js/app.js` to ensure the hash updates and browsers detect the new version.

### Example Import:
```javascript
// Correct
import { someFunc } from './module.js?v=AUTO';

// Incorrect
import { someFunc } from './module.js';
import { someFunc } from './module.js?v=35';
```
