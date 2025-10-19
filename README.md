# SMTP2GO Sender Pro

A Flask-based application for sending single or bulk personalized emails through the SMTP2GO API with attachment support and progress tracking.

## Features
- Single email sending with CC/BCC & attachments
- Bulk personalized campaigns (Excel or TXT upload)
- Simple template placeholders: `{{Column_Name}}`
- Progress polling with success/fail stats
- Attachment base64 handling
- Interval throttling between sends

## Tech Stack
- Python / Flask
- Frontend: Tailwind (CDN) + Vanilla JS
- Background bulk sending via Python thread (not persistent across restarts)

## Quick Start (Local)
1. Create environment file:
```
cp .env.example .env
# Edit values, especially SMTP2GO_API_KEY
```
2. (Optional) Create virtualenv.
3. Install dependencies:
```
pip install -r requirements.txt
```
4. Run development server:
```
python app.py
```
5. Open: http://localhost:5000

## Production (Gunicorn)
```
WEB_CONCURRENCY=2 gunicorn -b 0.0.0.0:5000 wsgi:application
```

## Docker
Build and run:
```
docker build -t smtp2go-sender .
docker run --env-file .env -p 5000:5000 smtp2go-sender
```

## Environment Variables
| Name | Required | Description |
|------|----------|-------------|
| SMTP2GO_API_URL | Yes | Base URL of API (e.g. https://api.smtp2go.com/v3) |
| SMTP2GO_API_KEY | Yes | API key from SMTP2GO |
| DEFAULT_SENDER_EMAIL | Yes | Default From email |
| DEFAULT_SENDER_NAME | Yes | Default From display name |
| FLASK_DEBUG | No | Set to True for debug mode |
| APP_SECRET_TOKEN | Recommended | Planned bearer token for basic auth |

## Deployment Options
See section below (Cloudflare vs Hostinger) for guidance.

## Limitations (Current)
- In-memory job status (lost on restart)
- No auth / rate limiting (add before exposing publicly)
- No retry/backoff on API failures

## Roadmap (Short Term)
- Add Bearer auth
- Add cancellation endpoint
- Move job tracking to Redis
- Add tests & CI workflow

## Web Worker UI Enhancements (Beacon Interface)
The `web-worker/` interface (Beacon) now includes enterprise-grade usability controls:

### Density Mode Toggle
- Button: "Compact" / "Standard" switches between default standard spacing and reduced vertical density.
- Persistence: Choice stored in `localStorage` under `beacon_density_mode`.
- Compact adjustments: Smaller paddings, reduced input heights, hidden decorative glows for maximum viewport utilization.

### Advanced Fields Collapse
### Layout & Spacing
The interface now operates in a single optimized compact mode. All previous density and advanced toggles have been removed to eliminate wasted vertical space and ensure a consistent productivity layout.

Key characteristics of the compact baseline:
- Tight vertical rhythm (minimal spacing between form groups)
- Reduced padding inside panels while preserving readability
- CC, BCC, and Scheduling fields always visible (no hidden state)
- Action buttons aligned without oversized gaps or decorative transforms
- Modals are hidden by default (`display:none`) and only rendered when active, preventing layout shifts

### Usage
1. Open `/web-worker/index.html` in a modern browser.
2. Fill sender and recipient fields (CC/BCC optional but always present for rapid access).
3. Attach files, compose plaintext and HTML bodies, then send or schedule.

### Design Rationale
Removing multiple density profiles and collapsible advanced sections prevents inconsistent experiences and reduces cognitive overhead. The single compact baseline:
- Improves scan efficiency for power users
- Prevents clipped or off‑screen controls on smaller viewports
- Simplifies maintenance (no branching CSS or preference persistence)
- Eliminates redundant animation & hover elevation for a stable enterprise feel

### Accessibility
- All interactive elements maintain focus outlines and sufficient hit areas despite reduced spacing.
- Modals use overlay layering and are removed from the reading order until activated.

### Future Considerations
- Inline template previews in a side drawer (optional enhancement)
- Keyboard shortcuts for rapid scheduling presets
- Minimal responsive adjustments for ultra‑narrow mobile widths

## License
Internal / Proprietary (add a LICENSE file if distribution is intended).
