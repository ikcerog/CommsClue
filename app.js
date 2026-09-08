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

// Fixed board geometry, modeled after the real Clue board's proportions:
// two stacked rooms on the left-middle (Library/Billiard Room), one tall
// room on the right-middle (Dining Room), and a non-interactive center
// "Cellar" block, all on a fine movement grid so corridors get many
// individual squares instead of one hallway cell per connection. This
// shape is the same for every theme — only room names/icons/colors change.
const GRID_COLS = 22;
const GRID_ROWS = 25;

const SLOTS = {
  top_left:        { col: 1,  colSpan: 6, row: 1,  rowSpan: 5 },
  top_center:      { col: 9,  colSpan: 6, row: 1,  rowSpan: 5 },
  top_right:       { col: 17, colSpan: 6, row: 1,  rowSpan: 5 },
  mid_left_upper:  { col: 1,  colSpan: 6, row: 8,  rowSpan: 5 },
  mid_left_lower:  { col: 1,  colSpan: 6, row: 14, rowSpan: 5 },
  mid_right:       { col: 17, colSpan: 6, row: 8,  rowSpan: 11 },
  bottom_left:     { col: 1,  colSpan: 6, row: 21, rowSpan: 5 },
  bottom_center:   { col: 9,  colSpan: 6, row: 21, rowSpan: 5 },
  bottom_right:    { col: 17, colSpan: 6, row: 21, rowSpan: 5 },
};

const CENTER_SLOT = { col: 9, colSpan: 6, row: 8, rowSpan: 11 };

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

function applySlot(el, slot) {
  el.style.gridColumn = `${slot.col} / span ${slot.colSpan}`;
  el.style.gridRow = `${slot.row} / span ${slot.rowSpan}`;
}

// Rooms are placed on a fine corridor grid (see SLOTS above) instead of one
// cell per room — the corridor area between/around them is real walkable
// square footage, drawn as a graph-paper background rather than individual
// DOM cells (there's nothing to click between rooms yet, so this keeps the
// DOM light while still looking like a real multi-square corridor).
function renderBoard(theme, session, onRoomClick) {
  const board = document.getElementById("board");
  board.innerHTML = "";
  board.style.setProperty("--accent", theme.colors.accent);
  board.style.setProperty("--grid-cols", GRID_COLS);
  board.style.setProperty("--grid-rows", GRID_ROWS);
  board.style.gridTemplateColumns = `repeat(${GRID_COLS}, 1fr)`;
  board.style.gridTemplateRows = `repeat(${GRID_ROWS}, 1fr)`;

  const passageRooms = new Set((theme.passages || []).flat());
  const tokensByRoom = new Map();
  theme.suspects.forEach((s) => {
    if (!s.start) return;
    if (!tokensByRoom.has(s.start)) tokensByRoom.set(s.start, []);
    tokensByRoom.get(s.start).push(s);
  });

  const center = document.createElement("div");
  center.className = "cellar";
  applySlot(center, CENTER_SLOT);
  center.innerHTML = `<span class="cellar-label">${theme.name}</span>`;
  board.appendChild(center);

  theme.rooms.forEach((room) => {
    const slot = SLOTS[room.slot];
    if (!slot) return;
    const cell = document.createElement("div");
    const isSelected = session.selectedRoom === room.id;
    cell.className = "room" + (passageRooms.has(room.id) ? " passage" : "") + (isSelected ? " selected" : "");
    applySlot(cell, slot);
    cell.setAttribute("role", "button");
    cell.setAttribute("tabindex", "0");
    cell.setAttribute("aria-pressed", String(isSelected));
    cell.innerHTML = `<span class="icon">${room.icon || ""}</span><span>${room.name}</span>`;

    const selectRoom = () => {
      if (onRoomClick) {
        onRoomClick(room.id);
        return;
      }
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

    board.appendChild(cell);
  });
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

function renderDie(value, elementId = "die-face") {
  const face = document.getElementById(elementId);
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

// ===== Live multiplayer (Cloudflare Worker) =====
// Connects to the GameRoom Durable Object over WebSocket. This shares the
// same #board element as the local sandbox above — while connected, the
// board reflects the live game's state instead of your local practice
// session, and the sandbox controls are disabled to avoid the two fighting
// over the same view.

let liveSocket = null;
let livePlayerId = null;
let liveGameState = null;
let liveHand = null;

function wsUrlFor(baseUrl, gameId, name) {
  return `${baseUrl.replace(/\/$/, "")}/game/${encodeURIComponent(gameId)}?name=${encodeURIComponent(name)}`;
}

function httpUrlFor(baseUrl) {
  return baseUrl.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://").replace(/\/$/, "");
}

function randomGameId() {
  return Math.random().toString(36).slice(2, 10);
}

function setLiveStatus(text) {
  document.getElementById("live-status").textContent = text;
}

function setLocalControlsEnabled(enabled) {
  ["theme-select", "roll-dice", "turn-select", "reset-session"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  });
}

async function createLiveGame() {
  const baseUrl = document.getElementById("live-url").value.trim();
  const name = document.getElementById("live-name").value.trim() || "Player";
  const playerCount = Number(document.getElementById("live-player-count").value);
  const gameId = randomGameId();
  document.getElementById("live-game-id").value = gameId;

  const categories = {
    suspects: currentTheme.suspects.map((s) => s.id),
    weapons: currentTheme.weapons.map((w) => w.id),
    rooms: currentTheme.rooms.map((r) => r.id),
  };

  setLiveStatus("Creating game…");
  try {
    const res = await fetch(`${httpUrlFor(baseUrl)}/game/${gameId}/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: currentTheme.id, playerCount, categories }),
    });
    if (!res.ok) throw new Error(`server responded ${res.status}`);
    connectLiveSocket(baseUrl, gameId, name);
  } catch (err) {
    setLiveStatus(`Failed to create game: ${err.message}`);
  }
}

function joinLiveGame() {
  const baseUrl = document.getElementById("live-url").value.trim();
  const name = document.getElementById("live-name").value.trim() || "Player";
  const gameId = document.getElementById("live-game-id").value.trim();
  if (!gameId) {
    setLiveStatus("Enter a Game ID to join.");
    return;
  }
  connectLiveSocket(baseUrl, gameId, name);
}

function connectLiveSocket(baseUrl, gameId, name) {
  if (liveSocket) liveSocket.close();
  setLiveStatus("Connecting…");

  const ws = new WebSocket(wsUrlFor(baseUrl, gameId, name));
  liveSocket = ws;

  ws.onopen = () => {
    setLiveStatus(`Connected to ${gameId}`);
    setLocalControlsEnabled(false);
    document.getElementById("live-setup").hidden = true;
    document.getElementById("live-active").hidden = false;
    document.getElementById("live-active-id").textContent = gameId;
  };

  ws.onclose = () => disconnectLiveGame("Disconnected");
  ws.onerror = () => disconnectLiveGame("Connection error");

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "welcome") {
      livePlayerId = msg.playerId;
    } else if (msg.type === "state") {
      liveGameState = msg.game;
      renderLiveUI();
    } else if (msg.type === "hand") {
      liveHand = msg.cards;
      renderLiveHand();
    } else if (msg.type === "error") {
      setLiveStatus(`Error: ${msg.message}`);
    }
  };
}

function disconnectLiveGame(statusText) {
  liveSocket = null;
  livePlayerId = null;
  liveGameState = null;
  liveHand = null;
  setLiveStatus(statusText || "Not connected");
  setLocalControlsEnabled(true);
  document.getElementById("live-setup").hidden = false;
  document.getElementById("live-active").hidden = true;
  if (currentTheme) renderBoard(currentTheme, loadSessionState(currentTheme.id));
}

function renderLiveUI() {
  if (!liveGameState) return;

  renderBoard(currentTheme, liveGameState, (roomId) => {
    liveSocket?.send(JSON.stringify({ type: "selectRoom", roomId }));
  });

  renderDie(liveGameState.diceHistory[liveGameState.diceHistory.length - 1] || 1, "live-die-face");

  const turnPlayer = liveGameState.players.find((p) => p.id === liveGameState.turn);
  const isMyTurn = liveGameState.turn === livePlayerId;
  document.getElementById("live-turn-line").textContent =
    liveGameState.status === "waiting"
      ? `Waiting for players (${liveGameState.players.length}/${liveGameState.playerCount})…`
      : `Turn: ${turnPlayer?.name || "?"}${isMyTurn ? " (you)" : ""}`;

  document.getElementById("live-roll-dice").disabled = !isMyTurn;
  document.getElementById("live-end-turn").disabled = !isMyTurn;

  const playersList = document.getElementById("live-players");
  playersList.innerHTML = "";
  liveGameState.players.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = p.name + (p.id === liveGameState.turn ? " ⬅ turn" : "") + (p.id === livePlayerId ? " (you)" : "");
    playersList.appendChild(li);
  });
}

function findCardMeta(theme, category, id) {
  return (theme[category] || []).find((item) => item.id === id);
}

function renderLiveHand() {
  const wrap = document.getElementById("live-hand");
  wrap.innerHTML = "";
  (liveHand || []).forEach((card) => {
    const meta = findCardMeta(currentTheme, card.category, card.id);
    const el = document.createElement("div");
    el.className = "sheet-item";
    el.innerHTML = `<span>${meta?.icon || ""} ${meta?.name || card.id}</span>`;
    wrap.appendChild(el);
  });
}

function wireLiveGame() {
  document.getElementById("live-create").addEventListener("click", createLiveGame);
  document.getElementById("live-join").addEventListener("click", joinLiveGame);
  document.getElementById("live-disconnect").addEventListener("click", () => liveSocket?.close());
  document.getElementById("live-roll-dice").addEventListener("click", () => {
    liveSocket?.send(JSON.stringify({ type: "roll" }));
  });
  document.getElementById("live-end-turn").addEventListener("click", () => {
    liveSocket?.send(JSON.stringify({ type: "advanceTurn" }));
  });
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

  wireLiveGame();
  await selectTheme(startTheme);
}

init();
