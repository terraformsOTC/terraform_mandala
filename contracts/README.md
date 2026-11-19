# TerraformSealReader: the on-chain seal reader

`TerraformSealReader.sol` reads a Terraforms parcel's stored drawing straight from the Terraforms
contract and does everything the site's seal decoder (`src/lib/seal.js`) does, on-chain:

| function | what it does |
|---|---|
| `decode(parcel)` | the seal in the parcel's drawing: layout, kind, payload, an inscription's text |
| `textOf(parcel)` | an inscription's text (inflated if it was compressed) |
| `open(parcel, secret)` | a sealed message, opened with its secret (the 43 characters the site shows) |
| `verifyHash(parcel, text)` / `verifyHashBytes` | does this text (or file) hash to the parcel's plain SHA-256 seal? |
| `verifyCommitment(parcel, text, salt)` / `verifyCommitmentBytes` | does this text and salt open the parcel's salted commitment? |
| `verifyListItem(parcel, token)` | is this revealed `tfs1:` item in the parcel's list commitment? |
| `encodeHash(text, layout)`, `encodeInscription(text, layout)`, `encode(mode, layout, payload)` | the 16 numbers for `commitDreamToCanvas` |
| `canvasOf`, `heightmapOf`, `decodeCanvas`, `spec`, `version` | the raw drawing, decoding any drawing, the format in full |

A parcel that has never been committed has no stored drawing: `decode` says found = false,
`canvasOf` and `heightmapOf` revert with "no stored drawing", and the reveal checks revert with
"not a … seal".

It has no owner, no admin, no proxy, no storage and nothing payable; once deployed nobody can
change or remove it. Its only external call reads Terraforms' `tokenToCanvasData`; SHA-256 is
Ethereum's precompile. Everything is a free read (`eth_call`), so it works from Etherscan's Read
tab or any Ethereum node, with no website. The costliest read is under 8M gas (`open` on the
largest sealed message 7.7M; `textOf` at most about 6M), far below the 50M gas Ethereum nodes
allow a read by default. The date of a seal is its commit transaction's block.

Layouts: 0 eighth, 1 quarter, 2 pinwheel, 3 mirror, 4 rotation, 5 plain.
Texts must be given exactly as sealed (seal.js turns them into Unicode NFC with `\n` line ends).

## Deployed

Ethereum mainnet: **`0xF0ecd91e78E0042C1b81945BC8FFB3E7D0E3B623`**
([Etherscan](https://etherscan.io/address/0xf0ecd91e78e0042c1b81945bc8ffb3e7d0e3b623)), created
2026-11-19 in block 26,448,487 by terraformsotc.eth (transaction
[`0xedd441cc…dde8`](https://etherscan.io/tx/0xedd441cc3d24f228db37223a49b286867e422bfb56799016785d6220f5aadde8)).
The code there is the build below, byte for byte. The deploy page's post-deploy checks passed, and
so did an independent re-check through a second Ethereum node. Source verified on Etherscan and on
[Sourcify](https://repo.sourcify.dev/1/0xF0ecd91e78E0042C1b81945BC8FFB3E7D0E3B623) (exact match).

## The build

| | |
|---|---|
| compiler | solc 0.8.26 (`0.8.26+commit.8a97fa7a`), optimizer on, runs 1, evmVersion cancun |
| source sha256 | `7b122933a90099c52788d2c0744bfd472cce6513b1f33d96ecd8af23bc71170a` |
| initcode keccak256 | `0x82beedf6a10800a7cf79493dc39d7018848ad1a4a0e5a14605f5ee0e1c1cc8b1` (24,388 bytes) |
| runtime keccak256 | `0x2efb3a894f325c75e2f9fb2caad836200ead09c6e25956246f359a6bf2ff081e` (24,360 bytes; limit 24,576) |
| deployment gas | ~5.32M (about 0.005 ETH at 1 gwei) |

`build/standard-json-input.json` is the exact compiler input (Etherscan verification),
`build/metadata.json` the compiler metadata (Sourcify), `build/TerraformSealReader.json` the ABI,
bytecode, hashes and the post-deploy checks.

Tests (2026-11-18, in the maintainer's ops folder, `mandala-seal/onchain`; 5,188 checks, all
passing): every kind and layout decodes, encodes, opens and verifies exactly as seal.js; AES-256
against FIPS 197 and OpenSSL, HKDF-SHA256 and AES-256-GCM against OpenSSL (tampered tags,
ciphertexts and additional data refused), inflate against zlib at every level and strategy plus
random, truncated and bit-flipped streams (it fails exactly when zlib fails); real mainnet parcels
read "no seal", parcels never committed give the answers above, and a read starved of gas reverts
rather than answer wrongly; the deploy page rehearsed on a mainnet fork as the deploying account.

## Deploying, step by step

Nothing here touches any parcel. The deployment is one transaction from your wallet: a contract
creation with no ETH value, no approvals and no signatures besides the transaction itself.

**1. Prepare (no risk).**
- A desktop browser with your wallet extension (MetaMask or Rabby; a hardware wallet behind it is fine).
- The deploying account needs ~0.01 ETH for gas. Its address becomes the contract's public
  "creator"; it gets no powers over the contract. A fresh account keeps your main one out of it.
- Get this folder onto that computer (`git pull`, or the files themselves).

**2. Open the deploy page locally.** In this folder run
`python3 -m http.server 8000 --bind 127.0.0.1` and open `http://127.0.0.1:8000/deploy.html`.
The page loads nothing from the internet; it talks only to your wallet.
It shows the contract's hashes at the top: compare them with the table above.

**3. Rehearse on Sepolia (optional, free).** Switch the wallet to Sepolia (test ETH from a
faucet) and go through steps 4–6 there. The page says TEST network in green.

**4. Connect and run the pre-flight checks.** On Ethereum mainnet the page says REAL ETH in
yellow. [run the checks] verifies:
- the network;
- the page's bytecode hash, and that a dry run of the creation produces exactly the audited
  runtime code;
- your nonce, and the address the contract will get;
- that nothing is at that address yet;
- the gas, the cost at today's price, and your balance.

Every line must be ✓.

**5. Deploy.** Tick the box, click [deploy]. In the wallet, confirm:
- the network is Ethereum Mainnet;
- the type is a contract deployment, with no recipient;
- the value is 0.

Then sign. The page waits for the transaction to be mined.

**6. Post-deploy checks (automatic).**
- The page checks that the contract landed at the predicted address.
- It checks that the code there hashes to the runtime above.
- It checks that seven calls give the expected answers, such as encoding and decoding
  "Hello World Computer".

You must see `ALL POST-DEPLOY CHECKS PASSED`. Save the log ([copy log]).

**7. Publish the source.**
- **Etherscan:** open the contract, then Contract → Verify and Publish → Solidity (Standard-Json-Input).
  Use compiler v0.8.26+commit.8a97fa7a, license MIT, and upload `build/standard-json-input.json`.
- **Sourcify:** submit `build/metadata.json` with `TerraformSealReader.sol` (sourcify.dev).
- Both should say exact / full match.

**8. Afterwards.** The address goes into the site (/seal shows the contract's own answer) and
CLAUDE.md. Anyone can re-check any deployment with the page's [check this address].

# TerraformGrainReader: seals hidden in a drawing's grain

`TerraformGrainReader.sol` (reader 2) reads seals that are hidden in a glyph's grain instead of
written in the digits: the TFS1 frame (48, 64, 80, 96 or 112 bytes) is carried by which cells of
the grain are odd and which are even, so the drawing stays as drawn and only grain cells move by
one height. The format is `spec()` and the header of `src/lib/seal.js` (GRAIN SEALS); seals in
the digits stay with TerraformSealReader above.

| function | what it does |
|---|---|
| `decode(parcel)` / `decodeCanvas(canvas)` | the grain seal in the parcel's (or any) drawing: size, kind, payload, an inscription's text |
| `textOf(parcel)` | a grain inscription's text |
| `open(parcel, secret)` / `openCanvas(canvas, secret)` | a sealed message, opened with its secret (43 characters) |
| `verifyHash` / `verifyHashBytes`, `verifyCommitment` / `verifyCommitmentBytes`, `verifyListItem` | the same reveal checks as reader 1 |
| `spec`, `version`, `TERRAFORMS` | the format in full, the version, the Terraforms contract it reads |

Kinds: inscription (never compressed), sealed (HKDF-SHA256 keys, a SHA-256 keystream and a
key-committing HMAC-SHA256 tag; the secret is 32 random bytes shown as 43 base64url
characters), salted commitment, plain hash, list. A parcel never committed gives found = false
from `decode` and "not a … " reasons elsewhere. Same guarantees as reader 1: no owner, admin,
proxy, storage or payable; only external call Terraforms' `tokenToCanvasData`; everything is a
free read (the costliest about 2.5M gas).

## Deployed

Ethereum mainnet: **`0xe6A9893749600e26cfEEce10982Cd6ddC0fE93EF`**
([Etherscan](https://etherscan.io/address/0xe6a9893749600e26cfeece10982cd6ddc0fe93ef)), created
2026-11-19 in block 26,449,502 by terraformsotc.eth (transaction
[`0xcfcb3fb7…4b1f`](https://etherscan.io/tx/0xcfcb3fb7b5971c691a006e95fea15e360c770444ed12873194bb0aaf569d4b1f)),
through `deploy-grain.html`. The code there is the build below, byte for byte. The deploy page's
post-deploy checks passed, and so did an independent re-check through a second Ethereum node
(fresh inscription and sealed round trips, a wrong secret refused). Source verified on Etherscan and on
[Sourcify](https://repo.sourcify.dev/1/0xe6A9893749600e26cfEEce10982Cd6ddC0fE93EF) (exact match).

## The build

| | |
|---|---|
| compiler | solc 0.8.26 (`0.8.26+commit.8a97fa7a`), optimizer on, runs 1, evmVersion cancun |
| source sha256 | `7db098f812410a4e44cc482825a451b323327e30ed72250245a7f2a6889fd516` |
| initcode keccak256 | `0x6405e43b43ad15c8f653b10ef0a85820f5b1ed491d930fe0d72e27ce33774dff` (16,654 bytes) |
| runtime keccak256 | `0xc945d8af2f790ed5765223d226f272c6ba855a1eaf7724453f1df3df0d5d23ec` (16,626 bytes) |
| deployment gas | 3,645,755 |

`build/TerraformGrainReader.standard-json-input.json` is the exact compiler input (Etherscan:
Standard-Json-Input, v0.8.26+commit.8a97fa7a, MIT), `build/TerraformGrainReader.metadata.json` the
compiler metadata (Sourcify), `build/TerraformGrainReader.json` the ABI, bytecode, hashes and the
post-deploy checks. It was deployed exactly like reader 1 (the steps above, with `deploy-grain.html`).

Tests (2026-11-19, in the maintainer's ops folder, `mandala-seal/grain`; 770 checks, all passing):
the cell order, the trellis and the frame map for every size against seal.js; HKDF, HMAC and
opening against Node's crypto (flipped bits and near-miss secrets refused); every kind on every
cover (the #6454 flower, the mini flower, Horus, Ra, the ankh, the moon god, the frog); crafted
and random drawings, digit seals and real mainnet parcels read "no grain seal"; the deploy page
rehearsed on a mainnet fork as the deploying account.
