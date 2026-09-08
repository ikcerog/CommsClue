# CommsClue Worker (live game server)

One Durable Object per game (`GameRoom`), keyed by the game's slug. Holds
players, whose turn it is, dice history, and board room selection, and
pushes updates to every connected player over WebSocket.

**Not done yet:** per-player secret hands and the solution envelope. This
version proves out join / roll / turn / broadcast first.

## Deploy (run these on your own machine, not in a remote session)

```
cd worker
npm install
npx wrangler login      # opens a browser, authorizes against your CF account
npx wrangler deploy
```

That prints a `*.workers.dev` URL — that's your live game server.

## Try it locally first

```
npx wrangler dev
```

Runs the Worker + Durable Object on your machine at `http://localhost:8787`
so you can test without deploying.

## API (current)

- `POST /game/{gameId}/create` — body `{ "theme": "mystery-manor", "playerCount": 4 }`, creates the room
- `WS /game/{gameId}?name=YourName` — joins the room over WebSocket

WebSocket messages you can send: `{"type":"roll"}`, `{"type":"selectRoom","roomId":"..."}`,
`{"type":"advanceTurn"}`. You'll receive `{"type":"welcome","playerId":...}` once,
then `{"type":"state","game":{...}}` on every change.
