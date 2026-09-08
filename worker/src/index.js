// CommsClue live game server — one Durable Object instance per game room.
// Holds the authoritative state (players, turn, dice, board selection) and
// fans out updates to every connected player over WebSocket. Per-player
// secret hands and the solution envelope aren't wired in yet (that's the
// next step after this base room is working) — this version proves out the
// join/roll/turn/broadcast loop first.

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

  async handleCreate(request) {
    const body = await request.json(); // { theme, playerCount }
    this.game = {
      theme: body.theme,
      playerCount: body.playerCount,
      status: "waiting",
      players: [],
      turn: null,
      diceHistory: [],
      selectedRoom: null,
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
    await this.saveGame();

    this.sessions.set(server, playerId);
    server.send(JSON.stringify({ type: "welcome", playerId }));

    server.addEventListener("message", (event) => {
      this.handleMessage(playerId, event.data);
    });

    server.addEventListener("close", () => {
      this.sessions.delete(server);
    });

    this.broadcast({ type: "state", game: this.game });

    return new Response(null, { status: 101, webSocket: client });
  }

  async handleMessage(playerId, raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
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
    this.broadcast({ type: "state", game: this.game });
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
