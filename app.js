// CommsClue — board renderer, detective sheet, dice, and turn tracking.
// No backend yet: theme data is fetched as static JSON, all game/session
// state lives in localStorage, scoped per theme.

const STATE_CYCLE = ["blank", "not_it", "suspect"];
const STATE_MARK = { blank: "", not_it: "✕", suspect: "★" };

// Pip layout for a d6, positions numbered 1-9 left-to-right/top-to-bottom.
const DIE_PATTERNS = {
  1: [5],
  2: [3, 7],
  3: [3, 5, 7],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};

const MAX_DICE_HISTORY = 6;

let currentTheme = null;
let rollInFlight = false;

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

function sessionStorageKeyFor(themeId) {
  return `commsclue.session.${themeId}`;
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

function loadSessionState(themeId) {
  try {
    const raw = localStorage.getItem(sessionStorageKeyFor(themeId));
    return raw ? JSON.parse(raw) : { turn: null, diceHistory: [], selectedRoom: null };
  } catch {
    return { turn: null, diceHistory: [], selectedRoom: null };
  }
}

function saveSessionState(themeId, state) {
  localStorage.setItem(sessionStorageKeyFor(themeId), JSON.stringify(state));
}

function announce(message) {
  const el = document.getElementById("sr-status");
  if (el) el.textContent = message;
}

// Rooms sit on a 3x3 logical grid; on screen that becomes a 5x5 grid where
// the cells between adjacent rooms are hallway squares (room at row r, col c
// -> screen row/col 2r-1, 2c-1). Screen cells where both coordinates are even
// are unused corner "wall" filler.
function renderBoard(theme, session) {
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
        const isSelected = session.selectedRoom === room.id;
        cell.className = "room" + (passageRooms.has(room.id) ? " passage" : "") + (isSelected ? " selected" : "");
        cell.setAttribute("role", "button");
        cell.setAttribute("tabindex", "0");
        cell.setAttribute("aria-pressed", String(isSelected));
        cell.innerHTML = `<span class="icon">${room.icon || ""}</span><span>${room.name}</span>`;

        const selectRoom = () => {
          session.selectedRoom = session.selectedRoom === room.id ? null : room.id;
          saveSessionState(theme.id, session);
          renderBoard(theme, session);
          if (session.selectedRoom) announce(`Selected ${room.name}`);
        };
        cell.addEventListener("click", selectRoom);
        cell.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            selectRoom();
          }
        });

        const tokens = tokensByRoom.get(room.id) || [];
        if (tokens.length) {
          const tokenWrap = document.createElement("div");
          tokenWrap.className = "room-tokens";
          tokens.forEach((s) => {
            const t = document.createElement("span");
            t.className = "token" + (session.turn === s.id ? " active" : "");
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
    const count = items.filter((item) => state[`${key}.${item.id}`] === "not_it").length;
    section.innerHTML = `<h3>${label} <span class="sheet-count">${count}/${items.length} ruled out</span></h3>`;

    const list = document.createElement("div");
    list.className = "sheet-items";

    items.forEach((item) => {
      const itemState = state[`${key}.${item.id}`] || "blank";
      const el = document.createElement("div");
      el.className = "sheet-item";
      el.dataset.state = itemState;
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
      el.innerHTML = `<span class="mark">${STATE_MARK[itemState]}</span><span>${item.icon || ""} ${item.name}</span>`;

      const cycle = () => {
        const current = state[`${key}.${item.id}`] || "blank";
        const next = STATE_CYCLE[(STATE_CYCLE.indexOf(current) + 1) % STATE_CYCLE.length];
        state[`${key}.${item.id}`] = next;
        saveSheetState(theme.id, state);
        renderSheet(theme);
      };
      el.addEventListener("click", cycle);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          cycle();
        }
      });

      list.appendChild(el);
    });

    section.appendChild(list);
    grid.appendChild(section);
  });
}

function renderDie(value) {
  const face = document.getElementById("die-face");
  face.innerHTML = "";
  face.dataset.value = value;
  const active = new Set(DIE_PATTERNS[value] || []);
  for (let i = 1; i <= 9; i++) {
    const pip = document.createElement("span");
    pip.className = "pip" + (active.has(i) ? " active" : "");
    face.appendChild(pip);
  }
}

function renderDiceHistory(history) {
  const list = document.getElementById("dice-history");
  list.innerHTML = "";
  history.forEach((value) => {
    const chip = document.createElement("span");
    chip.className = "dice-chip";
    chip.textContent = value;
    list.appendChild(chip);
  });
}

function wireDice(theme, session) {
  const button = document.getElementById("roll-dice");
  renderDie(session.diceHistory[session.diceHistory.length - 1] || 1);
  renderDiceHistory(session.diceHistory);

  button.onclick = () => {
    if (rollInFlight) return;
    rollInFlight = true;
    button.disabled = true;

    let ticks = 0;
    const flicker = setInterval(() => {
      renderDie(Math.floor(Math.random() * 6) + 1);
      ticks++;
      if (ticks >= 8) {
        clearInterval(flicker);
        const finalRoll = Math.floor(Math.random() * 6) + 1;
        renderDie(finalRoll);
        session.diceHistory.push(finalRoll);
        if (session.diceHistory.length > MAX_DICE_HISTORY) session.diceHistory.shift();
        saveSessionState(theme.id, session);
        renderDiceHistory(session.diceHistory);
        announce(`Rolled a ${finalRoll}`);
        button.disabled = false;
        rollInFlight = false;
      }
    }, 60);
  };
}

function wireTurnTracker(theme, session) {
  const select = document.getElementById("turn-select");
  select.innerHTML = "";
  theme.suspects.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = `${s.icon || ""} ${s.name}`;
    select.appendChild(opt);
  });

  if (!session.turn || !theme.suspects.some((s) => s.id === session.turn)) {
    session.turn = theme.suspects[0]?.id || null;
  }
  select.value = session.turn;

  select.onchange = (e) => {
    session.turn = e.target.value;
    saveSessionState(theme.id, session);
    renderBoard(theme, session);
    const suspect = theme.suspects.find((s) => s.id === session.turn);
    if (suspect) announce(`${suspect.name}'s turn`);
  };
}

function wireResetSession(theme, session) {
  document.getElementById("reset-session").addEventListener("click", () => {
    if (!confirm("Reset turn, dice history, and room selection for this theme?")) return;
    session.turn = theme.suspects[0]?.id || null;
    session.diceHistory = [];
    session.selectedRoom = null;
    saveSessionState(theme.id, session);
    renderBoard(theme, session);
    renderDie(1);
    renderDiceHistory([]);
    document.getElementById("turn-select").value = session.turn;
    announce("Turn, dice, and room selection reset");
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
  const session = loadSessionState(themeId);

  document.getElementById("game-title").textContent = currentTheme.name;
  renderBoard(currentTheme, session);
  renderSheet(currentTheme);
  wireClearButton(currentTheme);
  wireDice(currentTheme, session);
  wireTurnTracker(currentTheme, session);
  wireResetSession(currentTheme, session);
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
