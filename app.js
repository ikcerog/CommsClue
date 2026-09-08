// CommsClue — board renderer + local detective sheet.
// No backend yet: theme data is fetched as static JSON, sheet state lives in localStorage.

const STATE_CYCLE = ["blank", "not_it", "suspect"];
const STATE_MARK = { blank: "", not_it: "✕", suspect: "★" };

let currentTheme = null;

async function loadManifest() {
  const res = await fetch("themes/manifest.json");
  return res.json();
}

async function loadTheme(themeId) {
  const res = await fetch(`themes/${themeId}.json`);
  return res.json();
}

function sheetStorageKey(themeId) {
  return `commsclue.sheet.${themeId}`;
}

function loadSheetState(themeId) {
  try {
    const raw = localStorage.getItem(sheetStorageKey(themeId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSheetState(themeId, state) {
  localStorage.setItem(sheetStorageKey(themeId), JSON.stringify(state));
}

// Rooms sit on a 3x3 logical grid; on screen that becomes a 5x5 grid where
// the cells between adjacent rooms are hallway squares (room at row r, col c
// -> screen row/col 2r-1, 2c-1). Screen cells where both coordinates are even
// are unused corner "wall" filler.
function renderBoard(theme) {
  const board = document.getElementById("board");
  board.innerHTML = "";
  board.style.setProperty("--accent", theme.colors.accent);

  const passageRooms = new Set((theme.passages || []).flat());
  const roomsByPos = new Map(theme.rooms.map((r) => [`${r.row},${r.col}`, r]));
  const tokensByRoom = new Map();
  theme.suspects.forEach((s) => {
    if (!s.start) return;
    if (!tokensByRoom.has(s.start)) tokensByRoom.set(s.start, []);
    tokensByRoom.get(s.start).push(s);
  });

  for (let screenRow = 1; screenRow <= 5; screenRow++) {
    for (let screenCol = 1; screenCol <= 5; screenCol++) {
      const rowIsRoom = screenRow % 2 === 1;
      const colIsRoom = screenCol % 2 === 1;
      const cell = document.createElement("div");
      cell.style.gridRow = screenRow;
      cell.style.gridColumn = screenCol;

      if (rowIsRoom && colIsRoom) {
        const room = roomsByPos.get(`${(screenRow + 1) / 2},${(screenCol + 1) / 2}`);
        if (!room) continue;
        cell.className = "room" + (passageRooms.has(room.id) ? " passage" : "");
        cell.innerHTML = `<span class="icon">${room.icon || ""}</span><span>${room.name}</span>`;

        const tokens = tokensByRoom.get(room.id) || [];
        if (tokens.length) {
          const tokenWrap = document.createElement("div");
          tokenWrap.className = "room-tokens";
          tokens.forEach((s) => {
            const t = document.createElement("span");
            t.className = "token";
            t.title = s.name;
            t.style.background = s.color || "#888";
            t.textContent = s.icon || "";
            tokenWrap.appendChild(t);
          });
          cell.appendChild(tokenWrap);
        }
      } else if (rowIsRoom !== colIsRoom) {
        cell.className = "hallway";
      } else {
        cell.className = "wall";
      }

      board.appendChild(cell);
    }
  }
}

function renderSheet(theme) {
  const grid = document.getElementById("sheet-grid");
  grid.innerHTML = "";
  const state = loadSheetState(theme.id);

  const categories = [
    { label: "Suspects", key: "suspects", items: theme.suspects },
    { label: "Weapons", key: "weapons", items: theme.weapons },
    { label: "Rooms", key: "rooms", items: theme.rooms },
  ];

  categories.forEach(({ label, key, items }) => {
    const section = document.createElement("div");
    section.className = "sheet-category";
    section.innerHTML = `<h3>${label}</h3>`;

    const list = document.createElement("div");
    list.className = "sheet-items";

    items.forEach((item) => {
      const itemState = state[`${key}.${item.id}`] || "blank";
      const el = document.createElement("div");
      el.className = "sheet-item";
      el.dataset.state = itemState;
      el.innerHTML = `<span class="mark">${STATE_MARK[itemState]}</span><span>${item.icon || ""} ${item.name}</span>`;

      el.addEventListener("click", () => {
        const current = state[`${key}.${item.id}`] || "blank";
        const next = STATE_CYCLE[(STATE_CYCLE.indexOf(current) + 1) % STATE_CYCLE.length];
        state[`${key}.${item.id}`] = next;
        saveSheetState(theme.id, state);
        el.dataset.state = next;
        el.querySelector(".mark").textContent = STATE_MARK[next];
      });

      list.appendChild(el);
    });

    section.appendChild(list);
    grid.appendChild(section);
  });
}

function wireDice() {
  const button = document.getElementById("roll-dice");
  const face = document.getElementById("die-face");
  button.onclick = () => {
    const roll = Math.floor(Math.random() * 6) + 1;
    face.textContent = roll;
  };
}

function wireTurnTracker(theme) {
  const select = document.getElementById("turn-select");
  select.innerHTML = "";
  theme.suspects.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = `${s.icon || ""} ${s.name}`;
    select.appendChild(opt);
  });
}

function wireClearButton(theme) {
  document.getElementById("clear-sheet").addEventListener("click", () => {
    if (!confirm("Clear your detective sheet for this theme? This can't be undone.")) return;
    localStorage.removeItem(sheetStorageKey(theme.id));
    renderSheet(theme);
  });
}

async function selectTheme(themeId) {
  currentTheme = await loadTheme(themeId);
  document.getElementById("game-title").textContent = currentTheme.name;
  renderBoard(currentTheme);
  renderSheet(currentTheme);
  wireClearButton(currentTheme);
  wireDice();
  wireTurnTracker(currentTheme);
  localStorage.setItem("commsclue.lastTheme", themeId);
}

async function init() {
  const manifest = await loadManifest();
  const select = document.getElementById("theme-select");

  const themeMetas = await Promise.all(manifest.themes.map(loadTheme));
  themeMetas.forEach((meta) => {
    const opt = document.createElement("option");
    opt.value = meta.id;
    opt.textContent = meta.name;
    select.appendChild(opt);
  });

  const lastTheme = localStorage.getItem("commsclue.lastTheme");
  const startTheme = manifest.themes.includes(lastTheme) ? lastTheme : manifest.themes[0];
  select.value = startTheme;

  select.addEventListener("change", (e) => selectTheme(e.target.value));

  await selectTheme(startTheme);
}

init();
