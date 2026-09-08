// CommsClue live game server — one Durable Object instance per game room.
// Holds the authoritative state (players, turn, dice, board selection,
// dealt hands, and the solution envelope) and fans out updates to every
// connected player over WebSocket. Public state broadcasts strip hands and
// the solution; each player's own hand is sent only to their own socket.

export class GameRoom {
  constructor(state) {
    this.state = state;
    this.sessions = new Map(); // WebSocket -> playerId
    this.game = null;
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(request);
    }

    const url = new URL(request.url);
    if (url.pathname.endsWith("/create") && request.method === "POST") {
      return this.handleCreate(request);
    }

    return new Response("Not found", { status: 404 });
  }

  async loadGame() {
    if (!this.game) {
      this.game = (await this.state.storage.get("game")) || null;
    }
    return this.game;
  }

  async saveGame() {
    await this.state.storage.put("game", this.game);
  }

  // body: { theme, playerCount, categories: { suspects: [ids], weapons: [ids], rooms: [ids] } }
  // The Worker doesn't know theme names/icons, only category id lists — that
  // keeps it decoupled from the frontend's theme JSON.
  async handleCreate(request) {
    const body = await request.json();
    this.game = {
      theme: body.theme,
      playerCount: body.playerCount,
      categories: body.categories,
      status: "waiting", // waiting -> in-progress
      players: [],
      turn: null,
      diceHistory: [],
      selectedRoom: null,
      hands: {}, // playerId -> [{category, id}], never broadcast publicly
      solution: null, // {suspect, weapon, room}, never broadcast publicly
      createdAt: Date.now(),
    };
    await this.saveGame();
    return Response.json({ ok: true });
  }

  async handleWebSocket(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    await this.loadGame();
    if (!this.game) {
      server.send(JSON.stringify({ type: "error", message: "Game not found. Create it first." }));
      server.close(1008, "Game not found");
      return new Response(null, { status: 101, webSocket: client });
    }

    const url = new URL(request.url);
    const playerName = url.searchParams.get("name") || "Player";
    const playerId = crypto.randomUUID();

    this.game.players.push({ id: playerId, name: playerName });
    if (!this.game.turn) this.game.turn = playerId;

    this.sessions.set(server, playerId);
    server.send(JSON.stringify({ type: "welcome", playerId }));

    if (this.game.status === "waiting" && this.game.players.length >= this.game.playerCount) {
      this.dealCards();
    }

    await this.saveGame();

    server.addEventListener("message", (event) => {
      this.handleMessage(playerId, event.data);
    });

    server.addEventListener("close", () => {
      this.sessions.delete(server);
    });

    this.broadcast({ type: "state", game: this.publicGame() });
    if (this.game.hands[playerId]) {
      this.sendToPlayer(playerId, { type: "hand", cards: this.game.hands[playerId] });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // Classic Clue dealing: one random card per category goes into the
  // solution envelope, the rest are shuffled together (not kept separate by
  // category) and dealt round-robin as evenly as possible.
  dealCards() {
    const categories = this.game.categories;
    const solution = {};
    const deck = [];

    for (const [category, ids] of Object.entries(categories)) {
      const shuffled = shuffle(ids);
      const singular = category.endsWith("s") ? category.slice(0, -1) : category;
      solution[singular] = shuffled[0];
      for (const id of shuffled.slice(1)) {
        deck.push({ category, id });
      }
    }

    shuffle(deck);

    const players = this.game.players;
    const hands = {};
    players.forEach((p) => (hands[p.id] = []));
    deck.forEach((card, i) => {
      hands[players[i % players.length].id].push(card);
    });

    this.game.solution = solution;
    this.game.hands = hands;
    this.game.status = "in-progress";
  }

  async handleMessage(playerId, raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "requestHand") {
      this.sendToPlayer(playerId, { type: "hand", cards: this.game.hands[playerId] || [] });
      return;
    }

    if (msg.type === "roll" && this.game.turn === playerId) {
      const roll = Math.floor(Math.random() * 6) + 1;
      this.game.diceHistory = [...(this.game.diceHistory || []).slice(-5), roll];
    } else if (msg.type === "selectRoom") {
      this.game.selectedRoom = msg.roomId;
    } else if (msg.type === "advanceTurn" && this.game.turn === playerId) {
      const idx = this.game.players.findIndex((p) => p.id === this.game.turn);
      const next = this.game.players[(idx + 1) % this.game.players.length];
      this.game.turn = next?.id || this.game.turn;
    } else {
      return;
    }

    await this.saveGame();
    this.broadcast({ type: "state", game: this.publicGame() });
  }

  // Strips hands and the solution — the only things in `game` that must
  // never reach every player, just their owner (hands) or nobody (solution)
  // until the game ends.
  publicGame() {
    const { hands, solution, ...safe } = this.game;
    return safe;
  }

  sendToPlayer(playerId, message) {
    const data = JSON.stringify(message);
    for (const [ws, id] of this.sessions.entries()) {
      if (id === playerId) {
        try {
          ws.send(data);
        } catch {
          // dead socket, will be cleaned up by its own close event
        }
      }
    }
  }

  broadcast(message) {
    const data = JSON.stringify(message);
    for (const ws of this.sessions.keys()) {
      try {
        ws.send(data);
      } catch {
        // dead socket, will be cleaned up by its own close event
      }
    }
  }
}

function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/game\/([a-zA-Z0-9_-]+)/);

    if (!match) {
      return new Response("CommsClue game server is running.", { status: 200 });
    }

    const gameId = match[1];
    const id = env.GAME_ROOM.idFromName(gameId);
    const stub = env.GAME_ROOM.get(id);
    return stub.fetch(request);
  },
};
