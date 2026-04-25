# WorshipBase UG Backend v68.4

Small backend helper for WorshipBase Ultimate Guitar import.

## Endpoints

- `GET /health`
- `GET /api/ug/search?q=amazing%20grace`
- `GET /api/ug/import?url=https://tabs.ultimate-guitar.com/tab/...`

## Render settings

- Build command: `npm install`
- Start command: `npm start`

## Notes

v68.4 adds:

- More browser-like request headers.
- Better JSON diagnostics when a fetch is blocked.
- Fallback search via DuckDuckGo HTML results when Ultimate Guitar search returns 403.
- Direct URL import endpoint unchanged for the WorshipBase app.

If Ultimate Guitar blocks Render IPs for direct tab page fetches, the search endpoint may still work but import can still return 403. In that case the backend architecture is still correct, but the importer will need a different source strategy or a permitted API/source.
