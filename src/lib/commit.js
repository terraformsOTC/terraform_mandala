// Commit a mandala heightmap on-chain with Terraforms.commitDreamToCanvas, and
// (if needed first) move the parcel to the v2 renderer with setTokenURIAddress.
//
// These are the only code paths on the site that write to Ethereum, so every
// step is checked against the chain itself rather than assumed:
//
//   1. the wallet is on mainnet and is the account the user connected;
//   2. that account owns the parcel (or is its authorized dreamer) and the
//      parcel is dreaming (status 1 or 3) — the contract's own require();
//   3. the encoded uint256[16] decodes back to the exact heightmap through BOTH
//      on-chain renderers' tokenHeightmapIndices (a free view call);
//   4. the exact transaction is simulated from the user's address (eth_call);
//   5. the transaction handed to the wallet is checked byte for byte
//      (assertCommitTransaction) — Terraforms' payable fallback() means a wrong
//      selector would silently succeed rather than revert;
//   6. after mining, the stored canvas and new status are read back.
//
// The commit also requires the parcel to render with v2 (renderer index 2);
// otherwise the mandala would show in the older v0 style. Migration is its own
// transaction with the same layers — see prepareMigrate below.
//
// Contract facts below are from the verified source on Sourcify
// (contracts/Terraforms.sol, TerraformsDreaming.sol): selectors 0x502f260c
// (commitDreamToCanvas) and 0x29fdf854 (setTokenURIAddress) are present in the
// deployed bytecode (checked 2026-10-04 / 2026-10-05).

import { AbiCoder, BrowserProvider, Contract, keccak256 } from 'ethers';
import { TERRAFORMS_ADDRESS, V0_RENDERER_ADDRESS, V2_RENDERER_ADDRESS } from './contract';
import { toCanvasUints, validate, TOTAL } from './heightmap';

const MAINNET = 1n;

const TERRAFORMS_ABI = [
  'function commitDreamToCanvas(uint256 tokenId, uint256[16] dream)',
  'function setTokenURIAddress(uint256[] tokens, uint256 index)',
  'function tokenURIAddresses(uint256 index) view returns (address)',
  'function tokenHTML(uint256 tokenId) view returns (string)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenToStatus(uint256 tokenId) view returns (uint8)',
  'function tokenToAuthorizedDreamer(uint256 tokenId) view returns (address)',
  'function tokenToPlacement(uint256 tokenId) view returns (uint256)',
  'function tokenToCanvasData(uint256 tokenId, uint256 index) view returns (uint256)',
  'function seed() view returns (uint256)',
];

const RENDERER_ABI = [
  'function tokenHeightmapIndices(uint256 status, uint256 placement, uint256 seed, uint256 yearsOfDecay, uint256[] canvasData) view returns (uint256[32][32])',
  'function tokenHTML(uint256 status, uint256 placement, uint256 seed, uint256 yearsOfDecay, uint256[] canvasData) view returns (string)',
];

// The renderer a parcel uses is tokenURIAddresses[tokenToURIAddressIndex[id]].
// The mapping is private, so it is read from storage: slot 11128 (large fixed
// arrays earlier in the contract push it out). Verified 2026-10-05 on six
// parcels against which renderer reproduces the contract's own tokenHTML.
const RENDERER_INDEX_SLOT = 11128n;
export const V2_INDEX = 2n;

// Read through the wallet's own connection first; some wallets do not serve
// eth_getStorageAt, so fall back to the site's server-side read of the same slot.
async function readRendererIndex(provider, id, blockTag = 'latest') {
  const slot = keccak256(AbiCoder.defaultAbiCoder().encode(['uint256', 'uint256'], [id, RENDERER_INDEX_SLOT]));
  try {
    return BigInt(await provider.getStorage(TERRAFORMS_ADDRESS, slot, blockTag));
  } catch {
    try {
      const block = typeof blockTag === 'number' ? `?block=${blockTag}` : '';
      const res = await fetch(`/api/parcel/${id}/renderer${block}`, { cache: 'no-store' });
      const body = await res.json();
      if (res.ok && /^\d+$/.test(String(body.index))) return BigInt(body.index);
    } catch {
      // fall through to the error below
    }
    throw new CommitError(`Could not read which renderer parcel #${id} uses. Try again in a moment.`);
  }
}

export const STATUS_NAMES = ['Terrain', 'Daydream', 'Terraformed', 'Origin Daydream', 'Origin Terraformed'];

// The contract's gate: commitDreamToCanvas requires status % 2 == 1.
export const isDreamingStatus = (status) => Number(status) % 2 === 1;

export class CommitError extends Error {
  constructor(message, { needsV2 = false } = {}) {
    super(message);
    // The commit check stopped only because the parcel is not on v2 yet; the
    // panel offers the migration instead of a dead end.
    this.needsV2 = needsV2;
  }
}

function walletProvider() {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new CommitError('No wallet found. Install a browser wallet such as MetaMask.');
  }
  return new BrowserProvider(window.ethereum);
}

async function requireMainnet(provider) {
  const { chainId } = await provider.getNetwork();
  if (chainId !== MAINNET) {
    throw new CommitError('Your wallet is not on Ethereum mainnet. Switch networks and try again.');
  }
}

/**
 * Everything short of signing. Returns a summary for the confirmation step, or
 * throws CommitError with the reason the commit cannot go ahead.
 * `onStep(label)` reports progress through the checks.
 */
export async function prepareCommit({ tokenId, heightmap, account, onStep = () => {}, provider: injected }) {
  const id = BigInt(tokenId);
  if (id < 1n || id > 9911n) throw new CommitError('Only minted parcels (#1–#9911) can be committed.');

  onStep('heightmap is 1,024 digits');
  const check = validate(heightmap);
  if (!check.lengthOk || !check.allDigits) {
    throw new CommitError(`The heightmap must be ${TOTAL} digits 0–9.`);
  }
  const dream = toCanvasUints(heightmap);

  // `provider` is injectable so the checks can be exercised outside a browser.
  const provider = injected ?? walletProvider();
  onStep('wallet is on Ethereum mainnet');
  await requireMainnet(provider);

  const tf = new Contract(TERRAFORMS_ADDRESS, TERRAFORMS_ABI, provider);

  onStep(`you own parcel #${tokenId}`);
  const [owner, authorized, statusRaw] = await Promise.all([
    tf.ownerOf(id),
    tf.tokenToAuthorizedDreamer(id),
    tf.tokenToStatus(id),
  ]);
  const me = account.toLowerCase();
  if (owner.toLowerCase() !== me && authorized.toLowerCase() !== me) {
    throw new CommitError(`Parcel #${tokenId} is owned by ${owner}, not the connected wallet.`);
  }

  // Before the status gate, so an already-committed v0 parcel is still offered
  // the migration.
  onStep(`parcel #${tokenId} renders with v2`);
  const rendererIndex = await readRendererIndex(provider, id);
  if (rendererIndex !== V2_INDEX) {
    throw new CommitError(
      `Parcel #${tokenId} still uses the older v0 renderer, so a mandala would show in the v0 style. Migrate it to v2 first.`,
      { needsV2: true },
    );
  }

  const status = Number(statusRaw);
  onStep(`parcel #${tokenId} is dreaming`);
  if (!isDreamingStatus(status)) {
    throw new CommitError(
      status === 0
        ? `Parcel #${tokenId} is in Terrain mode. It has to enter daydream mode before a heightmap can be committed.`
        : `Parcel #${tokenId} is already ${STATUS_NAMES[status]}. It has to enter daydream mode again before a new heightmap can be committed.`,
    );
  }
  const newStatus = status + 1;

  onStep('the on-chain renderers decode it to this exact mandala');
  const [placement, seed] = await Promise.all([tf.tokenToPlacement(id), tf.seed()]);
  for (const [name, address] of [['v0', V0_RENDERER_ADDRESS], ['v2', V2_RENDERER_ADDRESS]]) {
    const renderer = new Contract(address, RENDERER_ABI, provider);
    // yearsOfDecay is 0: the contract stops decay once 500+ parcels dream.
    const grid = await renderer.tokenHeightmapIndices(newStatus, placement, seed, 0, dream);
    const decoded = grid.map((row) => row.map((v) => String(Number(v))).join('')).join('');
    if (decoded !== String(heightmap).replace(/\s+/g, '')) {
      throw new CommitError(`Safety check failed: the ${name} renderer decodes this data to a different heightmap. Nothing was sent.`);
    }
  }

  onStep('the transaction simulates successfully');
  try {
    await tf.commitDreamToCanvas.staticCall(id, dream, { from: account });
  } catch (err) {
    throw new CommitError(`The contract would reject this transaction (${err.shortMessage || err.message}). Nothing was sent.`);
  }
  const gas = await tf.commitDreamToCanvas.estimateGas(id, dream, { from: account });

  return { tokenId: Number(id), dream, status, newStatus, owner, gas };
}

/**
 * Sends the prepared commit. Re-checks network and signer immediately before
 * signing, since either can change while the confirmation is on screen.
 */
export async function sendCommit(prepared, account) {
  const provider = walletProvider();
  await requireMainnet(provider);
  const signer = await provider.getSigner();
  const signerAddress = await signer.getAddress();
  if (signerAddress.toLowerCase() !== account.toLowerCase()) {
    throw new CommitError('The wallet account changed. Reconnect and try again.');
  }
  const tf = new Contract(TERRAFORMS_ADDRESS, TERRAFORMS_ABI, signer);
  // 20% headroom over the estimate; unused gas is not charged.
  const gasLimit = (prepared.gas * 120n) / 100n;
  const tx = await tf.commitDreamToCanvas.populateTransaction(BigInt(prepared.tokenId), prepared.dream, { gasLimit });
  assertCommitTransaction(tx, prepared);
  return signer.sendTransaction(tx);
}

// Terraforms has a payable fallback(), so a call with the wrong selector would
// not revert — it would "succeed" and do nothing, and so would its simulation.
// The transaction handed to the wallet is therefore checked byte for byte:
// right contract, commitDreamToCanvas's selector, exactly one tokenId plus 16
// uints of calldata, no ETH, and arguments that decode back to what was checked.
const COMMIT_SELECTOR = '0x502f260c';
const COMMIT_CALLDATA_BYTES = 4 + 32 + 16 * 32;

export function assertCommitTransaction(tx, prepared) {
  const fail = (why) => {
    throw new CommitError(`Safety check failed: ${why}. Nothing was sent.`);
  };
  if (!tx.to || tx.to.toLowerCase() !== TERRAFORMS_ADDRESS.toLowerCase()) fail('the transaction is not addressed to the Terraforms contract');
  if (tx.value != null && BigInt(tx.value) !== 0n) fail('the transaction would send ETH');
  if (!tx.data?.startsWith(COMMIT_SELECTOR)) fail('the transaction does not call commitDreamToCanvas');
  if ((tx.data.length - 2) / 2 !== COMMIT_CALLDATA_BYTES) fail('the transaction data is not the expected size');
  const [tokenId, dream] = new Contract(TERRAFORMS_ADDRESS, TERRAFORMS_ABI).interface
    .decodeFunctionData('commitDreamToCanvas', tx.data);
  if (tokenId !== BigInt(prepared.tokenId)) fail('the transaction targets a different parcel');
  if (dream.length !== 16 || dream.some((v, i) => v !== prepared.dream[i])) fail('the transaction carries a different heightmap');
}

/** Reads the parcel back after mining: new status and all 16 stored uints. */
// Read-backs are pinned to the block the transaction was mined in. Reading
// "latest" straight after mining can hit a wallet node that is a block behind and
// report a successful transaction as failed. Waits (briefly) for the node to have
// that block first.
async function blockReady(provider, blockNumber) {
  for (let i = 0; i < 20; i++) {
    if ((await provider.getBlockNumber()) >= blockNumber) return blockNumber;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new CommitError('The transaction was mined, but your wallet\'s connection has not caught up yet. Check the parcel on Etherscan.');
}

export async function verifyCommit(prepared, blockNumber) {
  const provider = walletProvider();
  const blockTag = await blockReady(provider, blockNumber);
  const tf = new Contract(TERRAFORMS_ADDRESS, TERRAFORMS_ABI, provider);
  const id = BigInt(prepared.tokenId);
  const status = Number(await tf.tokenToStatus(id, { blockTag }));
  const stored = await Promise.all(prepared.dream.map((_, i) => tf.tokenToCanvasData(id, i, { blockTag })));
  const canvasOk = stored.every((v, i) => v === prepared.dream[i]);
  return { ok: canvasOk && status === prepared.newStatus, status, canvasOk };
}

// --- Migration to the v2 renderer --------------------------------------------
//
// setTokenURIAddress(uint256[] tokens, uint256 index) writes only the parcel's
// renderer index; it requires msg.sender to OWN every listed token (an
// authorized dreamer is not enough) and index < tokenURIAddresses.length. No
// ETH, no transfers, no events, and it is reversible. The site only ever sends
// it for ONE parcel and index 2, and checks that index 2 still points at the v2
// renderer, since the contract owner can append renderers.

const MIGRATE_SELECTOR = '0x29fdf854';
const MIGRATE_CALLDATA_BYTES = 4 + 32 * 4; // offset, index, length 1, tokenId

export async function prepareMigrate({ tokenId, account, onStep = () => {}, provider: injected }) {
  const id = BigInt(tokenId);
  if (id < 1n || id > 9911n) throw new CommitError('Only minted parcels (#1–#9911) can be migrated.');
  const provider = injected ?? walletProvider();
  onStep('wallet is on Ethereum mainnet');
  await requireMainnet(provider);
  const tf = new Contract(TERRAFORMS_ADDRESS, TERRAFORMS_ABI, provider);

  onStep(`you own parcel #${tokenId}`);
  const owner = await tf.ownerOf(id);
  if (owner.toLowerCase() !== account.toLowerCase()) {
    throw new CommitError(`Only the owner can change a parcel's renderer. Parcel #${tokenId} is owned by ${owner}.`);
  }

  onStep('renderer slot 2 is the v2 renderer');
  const v2 = await tf.tokenURIAddresses(V2_INDEX);
  if (v2.toLowerCase() !== V2_RENDERER_ADDRESS.toLowerCase()) {
    throw new CommitError(`Safety check failed: renderer slot 2 is ${v2}, not the expected v2 renderer. Nothing was sent.`);
  }

  onStep(`parcel #${tokenId} is not on v2 yet`);
  const current = await readRendererIndex(provider, id);
  if (current === V2_INDEX) throw new CommitError(`Parcel #${tokenId} already renders with v2.`);

  onStep('the transaction simulates successfully');
  try {
    await tf.setTokenURIAddress.staticCall([id], V2_INDEX, { from: account });
  } catch (err) {
    throw new CommitError(`The contract would reject this transaction (${err.shortMessage || err.message}). Nothing was sent.`);
  }
  const gas = await tf.setTokenURIAddress.estimateGas([id], V2_INDEX, { from: account });
  return { tokenId: Number(id), from: current, gas };
}

export async function sendMigrate(prepared, account) {
  const provider = walletProvider();
  await requireMainnet(provider);
  const signer = await provider.getSigner();
  if ((await signer.getAddress()).toLowerCase() !== account.toLowerCase()) {
    throw new CommitError('The wallet account changed. Reconnect and try again.');
  }
  const tf = new Contract(TERRAFORMS_ADDRESS, TERRAFORMS_ABI, signer);
  const gasLimit = (prepared.gas * 120n) / 100n;
  const tx = await tf.setTokenURIAddress.populateTransaction([BigInt(prepared.tokenId)], V2_INDEX, { gasLimit });
  assertMigrateTransaction(tx, prepared);
  return signer.sendTransaction(tx);
}

// Byte-level check of the migration handed to the wallet, for the same
// fallback() reason as the commit: right contract, setTokenURIAddress, exactly
// one tokenId, index 2, no ETH.
export function assertMigrateTransaction(tx, prepared) {
  const fail = (why) => {
    throw new CommitError(`Safety check failed: ${why}. Nothing was sent.`);
  };
  if (!tx.to || tx.to.toLowerCase() !== TERRAFORMS_ADDRESS.toLowerCase()) fail('the transaction is not addressed to the Terraforms contract');
  if (tx.value != null && BigInt(tx.value) !== 0n) fail('the transaction would send ETH');
  if (!tx.data?.startsWith(MIGRATE_SELECTOR)) fail('the transaction does not call setTokenURIAddress');
  if ((tx.data.length - 2) / 2 !== MIGRATE_CALLDATA_BYTES) fail('the transaction data is not the expected size');
  const [tokens, index] = new Contract(TERRAFORMS_ADDRESS, TERRAFORMS_ABI).interface
    .decodeFunctionData('setTokenURIAddress', tx.data);
  if (tokens.length !== 1 || tokens[0] !== BigInt(prepared.tokenId)) fail('the transaction would change a different set of parcels');
  if (index !== V2_INDEX) fail('the transaction would select a renderer other than v2');
}

/**
 * After mining: the parcel's stored renderer index at the mined block is 2. That
 * is the decisive check — the contract routes tokenHTML by exactly this value.
 *
 * Comparing the parcel's tokenHTML with the v2 renderer's output is kept as a
 * best-effort extra only: generating a parcel's HTML costs ~9–10M gas for many
 * parcels and over 30M for some (#5257), which many RPC nodes refuse for a read
 * call. A refusal must not make a successful migration look failed — which is
 * what happened on #9230 (2026-10-05). htmlCheck: 'match' | 'mismatch' | 'skipped'.
 */
export async function verifyMigrate(prepared, blockNumber) {
  const provider = walletProvider();
  const blockTag = await blockReady(provider, blockNumber);
  const tf = new Contract(TERRAFORMS_ADDRESS, TERRAFORMS_ABI, provider);
  const id = BigInt(prepared.tokenId);
  const index = await readRendererIndex(provider, id, blockTag);

  let htmlCheck = 'skipped';
  try {
    const [status, placement, seed, html] = await Promise.all([
      tf.tokenToStatus(id, { blockTag }), tf.tokenToPlacement(id, { blockTag }), tf.seed({ blockTag }), tf.tokenHTML(id, { blockTag }),
    ]);
    // The contract passes whatever canvas is stored, whatever the status (a
    // parcel that re-entered dream keeps its old one), so read it as stored: the
    // public getter reverts past the end of the array.
    const canvas = [];
    for (let i = 0; i < 16; i++) {
      try {
        canvas.push(await tf.tokenToCanvasData(id, i, { blockTag }));
      } catch {
        break;
      }
    }
    const v2Html = await new Contract(V2_RENDERER_ADDRESS, RENDERER_ABI, provider)
      .tokenHTML(status, placement, seed, 0, canvas, { blockTag });
    htmlCheck = html === v2Html ? 'match' : 'mismatch';
  } catch {
    // The node would not run the HTML call; the index check above stands.
  }
  return { ok: index === V2_INDEX, index, htmlCheck };
}
