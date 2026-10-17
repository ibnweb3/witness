# Friction report — WitNess

Versions: `@arkiv-network/sdk` 0.8.1, `viem` (see package.json), Node 24, Windows 11. Network: Tiramisu (7738577).
Entries are written as I build. Each says what I expected, what happened, and how to reproduce.

## F1. Faucet requires a wallet sign-in; no way to fund a scripted wallet directly
- Expected: paste an address, receive test GLM (typical faucet).
- Actual: https://hub.arkiv.network/faucet shows "Connect wallet" and "Sign in with your wallet to claim"; the funded wallet is the signed-in one, so a freshly generated server-side key has to be funded by an on-chain transfer from that wallet.
- Repro: open the faucet in a browser with no wallet extension; the page shows only "Connect wallet".
- Suggestion: also accept a plain address + captcha for CI/agent-built projects, or document the "claim then transfer" path.

## F2. Live Events docs describe polling; the challenge AGENTS.md says a WebSocket transport gives a real socket
- Expected: one consistent description of how `watchEntityEvents` receives events.
- Actual: docs.arkiv.network/typescript-sdk/live-events says the method "polls the chain for new events" and documents `pollingInterval`, with no mention of a WebSocket transport. The challenge AGENTS.md says it opens a real socket only with a WebSocket transport and no `fromBlock`.
- What I tested (SDK 0.8.1, viem `webSocket()` transport, no `fromBlock`): events arrived within 8 s in Node and in the browser. I did NOT measure whether delivery is push or polling, so I make no claim either way.
- Repro: `createPublicClient({ chain: tiramisu, transport: webSocket() }).watchEntityEvents({ onEvent })`, wait a few seconds.
- Suggestion: state on the Live Events page which transports push and which poll.

## F3. Entity events are chain-wide and carry no attributes, so the obvious live-feed design hits the public RPC rate limit (HTTP 429)
- Expected: a way to subscribe only to my app's entities (by `project` attribute or creator), or events that include attributes.
- Actual: `watchEntityEvents` delivers events for every Arkiv app on the chain (about one per second during my tests). An `EntityCreated` event carries `entityKey`, `owner`, `expiresAt` and flags, but no attributes (docs: Live Events). To tell whether an event is mine I first called `getEntity(key)` per event. Within minutes the browser console filled with `429` responses and my normal queries started failing, so the feed stuck on its loading state. The docs do warn the public RPC is "heavily rate limited", so part of this is my design; the friction is that the natural implementation is also the one that floods it.
- Versions: `@arkiv-network/sdk` 0.8.1, public Tiramisu RPC, Chrome (Claude desktop browser pane).
- Repro: subscribe with `watchEntityEvents({ onEntityCreated: e => publicClient.getEntity(e.entityKey) })` on a page and watch the network tab for 429s.
- Workaround used: treat any event as a hint, then at most once every 10 s run one `select({ key: true })` for my own `project` and diff against known keys (`src/main.ts` `startLive`).
- Suggestion: allow filtering the event subscription by attribute or creator/owner, or include indexed attributes in the event.

## F4. `arkiv_query` has a separate, cost-based anonymous budget that the docs do not describe
- Expected: the "heavily rate limited" public RPC (docs, Querying Data) to behave like a per-second request limit, as the `ratelimit: limit=600` header on other methods suggests.
- Actual: ordinary methods (`eth_blockNumber`, `arkiv_getEntityCount`) answered 200 with `ratelimit: limit=600, remaining=…, reset=…`, while every `arkiv_query` answered 429 with `ratelimit: limit=10000, remaining=0, reset=1972`, `retry-after: 1972` and this body: `{"error":"ANON_COST_LIMITED","message":"unauthenticated query budget exhausted; get an API key at https://hub.arkiv.network for a monthly quota"}`. So there is a cost budget (10000 units, window of roughly half an hour to an hour) that only queries spend. The docs do not state the budget, the window, or how cost is computed.
- How I hit it: a live-event handler that called `getEntity` for every chain-wide event (see F3), plus repeated page reloads while testing, spent the budget; the site then showed only a loading state until it reset.
- Versions: `@arkiv-network/sdk` 0.8.1, public Tiramisu RPC, queried from a browser and from Node (same result in both).
- Repro: send `arkiv_query` requests in a loop from one IP until the response changes to 429, then read the `ratelimit` and `retry-after` headers; confirm `eth_blockNumber` still returns 200.
- What I changed: reads go through a 30 to 45 s cache; retries cut from 3 to 1 (a 429 is instant, retries only delay the error); the UI explains the limit and offers retry instead of showing a generic failure; an optional second RPC can be configured for use only after a 429.
- Suggestions: document the budget and the per-query cost; return the remaining budget in the headers of successful `arkiv_query` responses so apps can degrade gracefully; make the SDK throw a typed error for `ANON_COST_LIMITED`.

## F5. A fully static dApp cannot get reliable reads without exposing an access key in the browser
- Expected: a way to ship a static site, with no backend of ours, that still reads reliably.
- Actual: the anonymous query budget (F4) refills on clock-aligned hourly windows (about xx:29:45). In one test, a window opened at 03:29:42 and the first two small queries succeeded, but a third in the same second was rejected with `remaining=40` of `limit=10000`, `reset=3599`. I cannot prove why, but that is hard to explain with only my own traffic and suggests the anonymous pool is shared by everyone using the public RPC (my inference, not confirmed). Over several hours my polling found the budget empty or at 40 almost every time.
- The fix the docs offer is an access key (Hub, `/api-keys`), which has its own monthly quota. The docs also say "Keep the key out of the browser: anyone can read a key from the network requests of your website and use it to spend your quota. For production, call the Arkiv RPC from your backend." A static, backend-free site therefore has two options: share the anonymous pool, or expose a key.
- What I did: the site uses an access key as its primary RPC, restricted to the site's origin in the Hub (the docs call this attribution, not access control), and falls back to the anonymous public RPC. The key is visible in the page's network requests, so the worst case is someone spending the quota. Testnet keys cannot move funds.
- With the key, every response carried `arkiv-quota-used-percent` and `ratelimit: limit=9999, remaining=…`, which made it easy to see usage; the anonymous responses showed only `limit=600` on success.
- Versions: `@arkiv-network/sdk` 0.8.1, public and keyed Tiramisu RPC.
- Repro: poll an anonymous `arkiv_query` once per second starting a few seconds before the `reset` value returned in a 429 reaches 0, and log the `ratelimit` header on the first rejection.
- Suggestions: enforce Origin-restricted keys for browser use (or issue browser-scoped keys with a lower cost ceiling), publish the anonymous budget and whether it is shared per IP or globally, and show remaining anonymous budget in response headers.
