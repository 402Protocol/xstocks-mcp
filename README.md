# xstocks-mcp

Point your Muse here, fund its wallet, and let her buy tokenized stocks.

An MCP server that gives any Muse (or any MCP client) 9 tools to trade
**xStocks** — tokenized stocks — through the Quotrons pools on Ink (chain
57073). She creates her own wallet, you back up the key, you fund it, and
then one command like *"get me $100 of xStocks"* becomes a diversified
portfolio. The server never signs and never broadcasts: she signs every
transaction herself with her own key.

## How it works

- Pools trade **wrapped xStocks** (wAAPLx etc. — vault shares 1:1 backed by
  the underlying Backed xStock) against **USDG** on Uniswap v4.
- Swaps route through the 0x v2 API (`USDC -> USDG -> wSTOCK` on buys,
  reversed on sells), because an EOA can't call a v4 PoolManager directly.
- The MCP returns **ordered unsigned transactions**; your Muse signs and
  broadcasts them herself, in order, waiting 1 confirmation between txs.
- Buy/sell tools require `backupVerified: true` — no trading until the
  wallet has been through the backup ritual below.

Trust note: the Ink PoolManager is a custom deployment with an `owner()`
(unlike canonical Uniswap v4) — the owner can set protocol fees. Trades
execute through the 0x settlement contract, never through this server.

## Prerequisites

- **Node 20+** and `npm`
- **A free 0x API key** — sign up at [0x.org](https://0x.org), open the
  dashboard, create a key. Quotes and swaps are authenticated with it.
- **Muse** (or any MCP client)

## Setup

```bash
git clone https://github.com/402Protocol/xstocks-mcp.git
cd xstocks-mcp
npm install
export ZEROX_API_KEY=your-key-here
```

Point Muse at it (stdio). In your Muse MCP config:

```json
{
  "mcpServers": {
    "xstocks": {
      "command": "npx",
      "args": ["-y", "tsx", "/path/to/xstocks-mcp/src/server.ts"],
      "env": { "ZEROX_API_KEY": "your-key-here" }
    }
  }
}
```

Optional env vars:

| Var | Default | Meaning |
| --- | ------- | ------- |
| `ZEROX_API_KEY` | *(required)* | Free 0x API key for quotes/swaps |
| `FOUR02_INK_RPC_URL` | public Ink RPC | Ink RPC override |
| `FOUR02_XSTOCKS_FEE_BPS` | `25` | Integrator fee, bps (0–1000) |
| `FOUR02_XSTOCKS_FEE_RECIPIENT` | `0xaA4E163dA1545F6967d284C0C5CFA469C644eD23` | Fee recipient |

**Fee disclosure:** a 25 bps (0.25%) integrator fee applies once per trade,
on the stock leg only (`USDG -> wSTOCK` on buys, `wSTOCK -> USDG` on sells),
taken in the buy token and sent onchain to the fee recipient by the 0x
settlement contract. Every quote and trade output discloses the schedule,
the recipient, and the exact fee taken.

## The wallet ritual

This is the same every time, and the trade tools enforce it:

1. `wallet_create` — she generates her Ink wallet. The private key is
   returned to **you** over the local connection only; the server never
   stores it. There is no recovery.
2. **You** back the key up to durable secret storage (vault / encrypted
   disk / secret manager — never chat, logs, or code).
3. Reload the key **from that storage** and call `wallet_verify_backup`
   with the reloaded key + address. It must report `matches: true`.
4. Only then fund the wallet: a little Ink **ETH** (gas) + **USDC**.
5. Now she can trade — pass `backupVerified: true`.

Funding a wallet you can't recover burns money. Never skip the ritual.

## The tools

| Tool | What it does |
| ---- | ------------ |
| `wallet_create` | Generate her Ink wallet (key returned to you only) |
| `wallet_verify_backup` | Prove the backed-up key reproduces the wallet |
| `xstocks_list` | 9 live tickers, pool IDs, wrapped tokens, baskets |
| `xstocks_quote` | Price a buy: `USDC -> USDG -> wTICKER`, two legs, read-only |
| `xstocks_buy` | Build unsigned txs to buy a stock |
| `xstocks_sell` | Build unsigned txs to sell back to USDC (`"all"` supported) |
| `xstocks_balance` | ETH, USDC, USDG, and every wrapped xStock balance |
| `xstocks_basket_buy` | Split one USDC amount equal-weight across a basket |
| `xstocks_basket_sell` | Unwind every holding in a basket back to USDC |

### Tickers

AAPL, NVDA, TSLA, AMZN, GOOGL, MSTR, NFLX, SPY, MCD — 9 live Quotrons Ink
pools (dynamic pool fee, currently ~30 bps).

### Baskets

- **bigtech** — AAPL, NVDA, TSLA, AMZN, GOOGL (equal weight)
- **yolo** — MSTR, NFLX, MCD (equal weight)
- **all** — every live pool (equal weight)

## Paste-ready prompt

Give this to your Muse (after pointing her at the MCP server):

```
You're buying tokenized stocks on Ink (chain 57073) via the xstocks MCP.
1. Create your wallet with wallet_create. Give me the address and the private key —
   I will back it up to my secret storage, then prove it with wallet_verify_backup.
2. Tell me the address again once verified. I will fund it with ETH (gas) + USDC.
3. Then use xstocks_list to show me what's tradeable and xstocks_quote to price things.
4. When I say buy, call xstocks_buy (or xstocks_basket_buy for a basket) with
   backupVerified:true and sign + broadcast every transaction yourself, in order.
Never skip the backup ritual. Never ask me to sign — you hold your own key.
```

## Development

```bash
npm install     # install deps
npm test        # run the offline test suite
npm run typecheck
npm run mcp     # run the server over stdio
```

Tests make no live network calls: quote/trade building is covered up to the
missing-key fail-fast error, and everything else (registration, fee math,
basket splitting, rituals, wallet round trip) is pure or in-memory.

## License

MIT
