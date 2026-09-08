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
    // exactly one room per fixed board "slot" (see below)
    { "id": "study", "name": "Study", "slot": "top_left", "icon": "📚" }
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
    // "start" is the room id this suspect's token begins the game in
    { "id": "scarlett", "name": "Ms. Scarlett", "icon": "🔴", "color": "#b5333a", "start": "lounge" }
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
- The board's physical shape is fixed engine-side (`SLOTS` in `app.js`),
  modeled on the real Clue board's proportions: three rooms across the top,
  three across the bottom, two rooms stacked on the left-middle, one tall
  room on the right-middle, and a non-interactive center "Cellar" block.
  Each theme's 9 rooms map one-to-one onto these 9 slot names — `top_left`,
  `top_center`, `top_right`, `mid_left_upper`, `mid_left_lower`, `mid_right`,
  `bottom_left`, `bottom_center`, `bottom_right` — via each room's `slot`
  field. The space between/around the rooms renders as a fine corridor grid
  (22x25 squares) rather than one hallway cell per connection, so movement
  distance actually means something. A theme can't add/remove rooms or
  change the board shape — that's an engine change, not a theme one.
- `passages` conventionally connects diagonal corner pairs (`top_left` ↔
  `bottom_right`, `top_right` ↔ `bottom_left`), matching the real board's
  two secret passages.
- Each suspect's `start` should be a distinct room id (their token's
  starting square). Movement/turn logic isn't built yet — tokens just render
  in their start room for now.

To add a brand overlay: copy `mystery-manor.json`, rename the file and `id`,
swap names/icons/colors, keep the same shape, then add its id to
`manifest.json`'s `themes` array (GitHub Pages can't list a directory, so the
manifest is how the picker knows what's available).
