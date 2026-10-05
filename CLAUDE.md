# CLAUDE.md

Guidance for Claude Code when working in this repo.

## Commands

```bash
npm run dev      # next dev on :3000
npm run build    # next build
npm start        # next start
```

## Architecture

Single Next.js 15 app (frontend + API routes). Vanilla JS, Tailwind. No separate Express service.

- Browser uses `window.ethereum` (ethers v6 BrowserProvider) for wallet connect.
- Server-side route handlers (`src/app/api/...`) wrap RPC reads (`tokenURI`, `tokenHTML`, `balanceOf`, `tokenOfOwnerByIndex`) so the RPC URL stays out of the client and we cache aggressively.
- Default `RPC_URL = https://ethereum.publicnode.com`. Swap to Alchemy via env var if rate-limits bite.

Terraforms contract: `0x4E1f41613c9084FdB9E34E11fAE9412427480e56`.

## Key files

### Libraries (`src/lib/`)
- `mandala.js` — port of d3l33t's mandala-gen2.js. `generateMandala({ seed, variance, peakHeight, startValue, rotationalOrder })` → `{ heightmap, grid }`. Throws if output isn't fully symmetric. Asserts via `heightmap.js`.
- `heightmap.js` — port of `initial context import files/heightmap_validate.py`. `validate`, `encode` (→ 16 decimal digit strings), `toCanvasUints` (→ BigInt[16] for the contract), `asciiViz`.
- `commit.js` — the one on-chain write: `prepareCommit` (all pre-send checks), `sendCommit`, `verifyCommit`. See "Onchain actions".
- `seedrandom.js` — vendored mulberry32 + FNV-1a string hash. No npm dep.
- `contract.js` — ethers `JsonRpcProvider` singleton, ABI fragments, `statusLabel(n)`. Status enum observed on-chain: `0=Daydreaming, 1=Dreaming, 2=Terraformed, 3=Origin` (status 3 seen on token 83 — special parcel).
- `tokenHTML.js` — server-side LRU cache (200 entries, 60s TTL). `fetchTokenHTML(id)` returns the raw on-chain HTML. `extractAnimData(html)` regexes out `colors`, `chars`, `bg`, `seed`, `resource`, `direction`. The cell substitution itself happens client-side in `ParcelPreview.buildPreviewHtml`.

### API routes (`src/app/api/`)
- `wallet/[address]/route.js` — `balanceOf` + `tokenOfOwnerByIndex` enumeration, capped at 200 parcels. Returns `{ tokenId, status, statusLabel }` per parcel.
- `parcel/[tokenId]/animdata/route.js` — calls `tokenHTML`, runs `extractAnimData`, returns the raw HTML (for iframe srcDoc) plus the parsed metadata.

### Components (`src/components/`)
- `ParcelPreview.js` — renders an `<iframe sandbox="allow-scripts">` with the modified tokenHTML inside. Inherits the parcel's font, palette, and CSS animations exactly. No re-implementation of the on-chain renderer.
- `MandalaDesigner.js` — left panel = controls + inspector; right panel = preview iframe. Recomputes the heightmap synchronously on every params change (1024 cells = no perf concern).
- `MandalaControls.js` — seed text + dice button, sliders for variance/peakHeight/startValue, 4-fold/8-fold toggle.
- `HeightmapInspector.js` — symmetry checks, ASCII viz, copyable `uint256[16]` array + raw 1024-char string.
- `ParcelGrid.js` — owned-parcel grid. Thumbnails come from Estimator's public CDN-cached `/image/:id` endpoint.
- `Header.js`, `ErrorBoundary.js`, `shared.js` — forks/trims of Estimator equivalents.

## State machine (page.js)

```
phase: idle → walletConnected → parcelSelected
walletAddress, parcels, selectedTokenId, animData, params, error
```

Knob changes update `params`, which trigger a memo'd `generateMandala()` and update the URL via `history.replaceState`. URL params: `?token=<id>&seed=<str>&variance=<1-4>&peak=<1-9>&start=<0-9>&order=<4|8>`. Only non-default values are written to the URL.

`accountsChanged` listener mirrors the Estimator's pattern.

## Encoding (the load-bearing technical detail)

Heightmap is 1024 chars (digits 0–9), arranged as 32 rows × 32 cols (row-major). Each `uint256` covers 2 consecutive rows, read as one **64-digit DECIMAL number**, top-left first; the renderer recovers cells by repeated mod 10 over the zero-padded digits, so leading zeros may vanish from the number harmlessly. `encode()` returns the 16 digit strings; `toCanvasUints()` turns them into BigInts.

**Not hex.** An earlier version of this file said each digit was a hex nibble and to prefix `0x`; that is wrong and decodes to a different heightmap. Verified 2026-10-04 three ways: the contract source comment (`TerraformsDreaming.sol`), the stored canvas of committed parcels #117/#871 (clean digit rows in decimal, noise in hex), and a round trip of a random asymmetric heightmap through both renderers' `tokenHeightmapIndices` (1024/1024 cells; the hex form fails). The copy box was always correct because it shows the bare digits, which Etherscan reads as decimal.

## TODO

(currently empty)

## Onchain actions

Exactly one, added 2026-10-04 at James's explicit request: committing the current mandala with `Terraforms.commitDreamToCanvas(uint256 tokenId, uint256[16] dream)` (selector `0x502f260c`, from the verified source on Sourcify) via `src/lib/commit.js` and `CommitPanel.js`. The site was read-only before this because of the blast radius if it were ever compromised; this path is kept narrow for that reason — no value is sent, no approvals, nothing that can move a token. Worst case for a compromised site is committing a different heightmap to a parcel the user owns.

Before signing, `prepareCommit` checks: minted id, 1024-digit heightmap, mainnet, owner or authorized dreamer, status % 2 == 1 (the contract's require), that BOTH renderers decode the uints back to the exact heightmap, and a simulated `eth_call` from the user's address. `sendCommit` re-checks chain and signer right before signing, then `assertCommitTransaction` checks the exact transaction handed to the wallet: Terraforms address, selector `0x502f260c`, 548 calldata bytes, no ETH, and arguments that decode to the checked tokenId and uints. That last check matters because Terraforms has a payable `fallback()`: a wrong selector would silently succeed and do nothing, and so would its simulation. `verifyCommit` reads back status and all 16 stored uints.

Audit (2026-10-05): the Sourcify source is an exact creation + runtime match, the contract is not a proxy (EIP-1967 slots empty, no delegatecall), and admin functions (pause, early, mintpass, withdraw) cannot touch commits. commitDreamToCanvas writes only `tokenToDreamer`, `tokenToStatus` (+1) and `tokenToCanvasData`, and emits `Terraformed` — no external calls, no ETH, no transfers, no other token affected. Do not add other write paths (enterDream, antenna, transfers) without an explicit ask; the antenna page still links to Etherscan.

## SEO / OpenGraph

- `src/app/opengraph-image.js` renders a 1200×630 PNG via `next/og` ImageResponse — left side is a static rings mandala in ASCII ramp, right side is the title + tagline. Twitter image re-exports it.
- `src/app/apple-icon.js` renders a 180×180 "TM" mark. `app/icon.svg` is the favicon.
- `src/app/sitemap.js` and `src/app/robots.js` implement Next 14 metadata routes.
- vercel/og constraint: every `<div>` with multiple children needs explicit `display: flex` (or none). Unicode glyphs trigger Google Font fetches that fail in the build sandbox — stick to ASCII inside ImageResponse.

## Out of scope (parking lot)

- Interactive 32×32 grid painter (mirror brush).
- Curated mandala template library (incl. user's existing Heightmap A and B).
- Mode-switching UI beyond a read-only status badge.
- Mobile designer layout.

## Deployment

Single Vercel deploy. Set `RPC_URL` in Vercel env. No separate backend.
