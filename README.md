# CommsClue

A Clue-style deduction board game with swappable brand/IP themes, served as a
static site (no build step, no backend — yet).

## Run locally

Any static file server works, e.g.:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## GitHub Pages

Enable Pages in repo Settings → Pages → **Deploy from a branch** → `main` /
root. This repo is plain HTML/CSS/JS at the root, so no build step is needed.

## Structure

- `index.html`, `styles.css`, `app.js` — board + detective sheet UI
- `themes/*.json` — brand/IP overlays (rooms, weapons, suspects, colors).
  See `themes/theme-schema.md` for the format and how to add your own.
- `themes/manifest.json` — lists which theme files exist (Pages can't list a
  directory, so this drives the theme picker)

## What's here so far

- Static 3x3 room board rendered from theme data, with secret-passage markers
- A personal **detective sheet** (suspects / weapons / rooms checklist) that
  cycles blank → not-it → suspect per item, saved to `localStorage` per theme
  — private to your browser, nothing sent anywhere
- "Clear Sheet" wipes your local sheet for the current theme

## Not built yet

- Actual gameplay (turns, movement, solution envelope, deal logic)
- Multiplayer / per-player secret card delivery (the "slushbucket" URLs) —
  planned as a small ephemeral backend (e.g. Cloudflare Workers + KV with a
  TTL) layered on top of this static frontend, not stored in git
