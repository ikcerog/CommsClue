# CommsClue Worker (live game server)

One Durable Object per game (`GameRoom`), keyed by the game's slug. Holds
players, whose turn it is, dice history, board room selection, per-player
secret hands, and the solution envelope, and pushes updates to every
connected player over WebSocket.

Dealing happens automatically the moment the last expected player joins:
one random card per category goes into the solution envelope, the rest are
shuffled together and dealt round-robin. Hands and the solution are stripped
from the broadcast `state` message — each player's hand is sent only to
their own socket as a separate `hand` message.

**Not done yet:** the frontend isn't wired to this server, accusation/guess
resolution (checking hands to disprove a guess), and reconnect-with-same-hand
(each new WebSocket connection is currently treated as a brand new player).

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

- `POST /game/{gameId}/create` — body:
  ```json
  {
    "theme": "mystery-manor",
    "playerCount": 4,
    "categories": {
      "suspects": ["scarlett", "mustard", "..."],
      "weapons": ["candlestick", "knife", "..."],
      "rooms": ["study", "hall", "..."]
    }
  }
  ```
  Category ids should match the theme JSON's own room/weapon/suspect ids.
- `WS /game/{gameId}?name=YourName` — joins the room over WebSocket. Dealing
  triggers automatically once `playerCount` players have joined.

WebSocket messages you can send: `{"type":"roll"}`, `{"type":"selectRoom","roomId":"..."}`,
`{"type":"advanceTurn"}`, `{"type":"requestHand"}` (re-fetch your own hand).

Messages you'll receive: `{"type":"welcome","playerId":...}` once,
`{"type":"state","game":{...}}` on every change (no hands or solution in
here), and `{"type":"hand","cards":[{"category":"weapons","id":"knife"},...]}`
sent only to you, once your hand is dealt.
