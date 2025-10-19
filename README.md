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
- Button: "Hide Advanced" / "Show Advanced" collapses CC, BCC, and Scheduling fields.
- Persistence: Visibility stored in `localStorage` key `beacon_advanced_visible` (values `1` or `0`).
- Accessibility: Uses `aria-expanded` and `aria-controls` on the toggle; collapsed container removed from reading order via `display:none`.

### Scrolling & Layout Corrections
- Removed forced `overflow:hidden` on `html`, `body`, `.surface`, and grid wrapper to prevent content clipping.
- Enabled natural vertical scroll while maintaining fixed star-field background visuals.
- Grid column width reduced (320px → 300px standard, 260px in compact) to surface more compose content.

### Layout & Spacing (Single Compact Baseline)
Beacon now ships a single, optimized compact layout as the default baseline. All previous density and advanced field toggles were removed to eliminate wasted vertical space and cognitive friction. CC, BCC, and scheduling fields are always visible for immediate access.

Key characteristics:
- Tight, consistent vertical rhythm (4–8px scale) with reduced padding.
- No hover lifts or ornamental glows that create layout jitter.
- Scrollable surface without clipping on smaller viewports.
- Unified action bar aligned right with wrap support on narrow widths.
- Modals are fully detached overlays (`hidden` + `aria-hidden` when inactive).

Rationale:
- Predictable form scanning for high-frequency enterprise usage.
- Lower visual noise; focus on input content, not chrome.
- Simplified code (removed density preference & advanced visibility persistence logic).
- Reduced maintenance: single style path, fewer conditional branches.

Future enhancements under consideration (non-breaking):
- Keyboard shortcuts for history toggle and template actions.
- Optional minimal subject length indicator heuristics.
- Progressive enhancement for HTML editor toolbar accessibility.

## License
Internal / Proprietary (add a LICENSE file if distribution is intended).
