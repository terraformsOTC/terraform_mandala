# CLAUDE.md

Guidance for Claude Code when working in this repo.

## Commands

```bash
npm run dev      # next dev on :3000
npm run build    # next build
npm start        # next start
```

## Architecture

Single Next.js 14 app (frontend + API routes). Vanilla JS, Tailwind. No separate Express service.

- Browser uses `window.ethereum` (ethers v6 BrowserProvider) for wallet connect.
- Server-side route handlers (`src/app/api/...`) wrap RPC reads (`tokenURI`, `tokenHTML`, `balanceOf`, `tokenOfOwnerByIndex`) so the RPC URL stays out of the client and we cache aggressively.
- Default `RPC_URL = https://ethereum.publicnode.com`. Swap to Alchemy via env var if rate-limits bite.

Terraforms contract: `0x4E1f41613c9084FdB9E34E11fAE9412427480e56`.

## Key files

### Libraries (`src/lib/`)
- `mandala.js` — port of d3l33t's mandala-gen2.js. `generateMandala({ seed, variance, peakHeight, startValue, rotationalOrder })` → `{ heightmap, grid }`. Throws if output isn't fully symmetric. Asserts via `heightmap.js`.
- `heightmap.js` — port of `initial context import files/heightmap_validate.py`. `validate`, `encode` (→ `uint256[16]` hex strings, always 0x-prefixed), `asciiViz`.
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

Heightmap is 1024 chars (digits 0–9), arranged as 32 rows × 32 cols (row-major). Each `uint256` covers 2 consecutive rows = 64 nibbles = 256 bits. Each height digit IS its hex nibble. `encode()` chunks the string into 16 groups of 64 and prefixes `0x`. **Never** use decimal — wallet form fields silently truncate large decimals.

## TODO

(currently empty)

## Onchain actions (v2)

- `DreamActions.js` gates buttons on (wallet connected) + (owner === connected) + status:
  - status 0 (Terrain) → `[enter daydream mode]` calls `enterDream`
  - status 1 (Daydream) → `[commit dream to canvas]` calls `commitDreamToCanvas` with the encoded `uint256[16]`
  - status 2 (Terraformed) → `[erase drawing]` re-calls `enterDream`
  - status 3 (Origin) and unminted parcels are hard-locked
- `src/lib/wallet.js` wraps the writes via ethers v6 `BrowserProvider` + signer, asserts mainnet (chainId 1n) before signing.
- `src/app/api/parcel/[tokenId]/animdata` returns `owner` (null for unminted) for the ownership gate.
- After tx confirms (`tx.wait(1)`), `page.js` bumps `animRefreshKey` and the animdata refetches. Server-side `tokenHTML` cache (60s TTL) may briefly serve stale rendered HTML; status flips immediately because that fetch isn't cached.

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
