# Theme / Brand Overlay Schema

Any file dropped in `themes/*.json` becomes a selectable board skin — this is how
you swap in a different brand, show, or IP without touching the game engine.

```jsonc
{
  "id": "mystery-manor",        // unique, matches the filename (no .json)
  "name": "Mystery Manor",      // shown in the theme picker
  "tagline": "A classic whodunit",
  "colors": {
    "board": "#1b1428",
    "accent": "#c9a227",
    "text": "#f5f0e6"
  },
  "rooms": [
    // 9 rooms, positioned on a 3x3 grid via row/col (1-3, 1-3)
    { "id": "study", "name": "Study", "row": 1, "col": 1, "icon": "📚" }
    // ...
  ],
  "passages": [
    // optional secret passages connecting two room ids (diagonal corners, classically)
    ["study", "kitchen"],
    ["lounge", "conservatory"]
  ],
  "weapons": [
    { "id": "candlestick", "name": "Candlestick", "icon": "🕯️" }
    // ...
  ],
  "suspects": [
    { "id": "scarlett", "name": "Ms. Scarlett", "icon": "🔴", "color": "#b5333a" }
    // ...
  ]
}
```

## Rules the engine assumes

- `rooms` should be exactly 9 for the classic 3x3 board layout. More or fewer
  rooms just means editing `row`/`col` — the board renders whatever grid
  positions it's given, up to 3x3. (A future theme with a different room
  count can request a bigger grid — that's an engine change, not a theme one.)
- `weapons` and `suspects` can be any length — the solution/deal math in the
  gameplay engine (not yet built) reads category sizes from the theme, it
  doesn't assume 6 and 6.
- Every `id` must be unique within its own list (room ids, weapon ids,
  suspect ids) — they're used as localStorage keys for the deduction sheet.

To add a brand overlay: copy `mystery-manor.json`, rename the file and `id`,
swap names/icons/colors, keep the same shape, then add its id to
`manifest.json`'s `themes` array (GitHub Pages can't list a directory, so the
manifest is how the picker knows what's available).
