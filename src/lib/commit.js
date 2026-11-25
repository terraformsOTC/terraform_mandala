// Commit a mandala heightmap on-chain with Terraforms.commitDreamToCanvas, and
// (if needed first) move the parcel to the v2 renderer, or back to v0, with
// setTokenURIAddress, or return an already-terraformed parcel to daydream mode
// with enterDream. Since 2026-11-25 also a parcel's attunement, set on the v2
// metadata contract from the unlinked /attune page (setAttunement, at the end).
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
// The commit also requires the parcel to render with the renderer the preview
// showed — v0 (index 0) or v2 (index 2) — so the mandala looks on-chain as it did
// on the site. Until 2026-11-17 only v2 was allowed; James: some owners want to
// keep creating in the v0 style. A parcel on another renderer than the preview's
// is offered the switch to it — the migration to v2, or since 2026-11-17 the switch
// back to v0 (v1, which the site cannot preview, gets either): its own transaction
// with the same layers — see prepareMigrate below. So is the return to daydream for
// a parcel that is already terraformed — prepareDream.
//
// Contract facts below are from the verified source on Sourcify
// (contracts/Terraforms.sol, TerraformsDreaming.sol): selectors 0x502f260c
// (commitDreamToCanvas), 0x29fdf854 (setTokenURIAddress) and 0xd359fc19
// (enterDream) are present in the deployed bytecode (checked 2026-10-04,
// 2026-10-05 and 2026-11-10).

import { AbiCoder, BrowserProvider, Contract, keccak256 } from 'ethers';
import { TERRAFORMS_ADDRESS, V0_RENDERER_ADDRESS, V2_RENDERER_ADDRESS, TOKEN_URI_V2_ADDRESS } from './addresses';
import { STATUS_NAMES, isDreamingStatus, isTerraformedStatus, CommitError } from './commitShared';
import { toCanvasUints, validate, TOTAL } from './heightmap';

const MAINNET = 1n;

const TERRAFORMS_ABI = [
  'function commitDreamToCanvas(uint256 tokenId, uint256[16] dream)',
  'function setTokenURIAddress(uint256[] tokens, uint256 index)',
  'function enterDream(uint256 tokenId)',
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

// tokenURIAddresses: 0 = v0 (the original renderer), 1 = v1, 2 = v2. The preview
// shows v0 or v2; v1 draws differently from both (checked 2026-11-17).
const RENDERER_NAMES = ['v0', 'v1', 'v2'];
const rendererName = (index) => RENDERER_NAMES[Number(index)] ?? `renderer ${index}`;

// Why a parcel's renderer doesn't match the preview, and what the panel offers:
// the switch to the preview's renderer, and the preview in the parcel's own.
function rendererMismatch(tokenId, has, want) {
  if (has === 'v0') {
    return new CommitError(
      `Parcel #${tokenId} renders with v0, so this mandala would show in the v0 style, not as in the v2 preview. Show the v0 preview to commit it in that style, or migrate the parcel to v2 first.`,
      { migrateTo: 'v2', showRenderer: 'v0' },
    );
  }
  if (has === 'v2') {
    return new CommitError(
      `Parcel #${tokenId} renders with v2, so this mandala would show in the v2 style, not as in the v0 preview. Show the v2 preview to commit it in that style, or switch the parcel back to v0 first.`,
      { migrateTo: 'v0', showRenderer: 'v2' },
    );
  }
  const what = has === 'v1' ? 'the v1 renderer' : has;
  return want === 'v2'
    ? new CommitError(
      `Parcel #${tokenId} uses ${what}, which this site can't preview. Migrate it to v2 first.`,
      { migrateTo: 'v2' },
    )
    : new CommitError(
      `Parcel #${tokenId} uses ${what}, which this site can't preview. Switch it to v0 first to commit in the v0 style, or show the v2 preview to migrate it to v2.`,
      { migrateTo: 'v0', showRenderer: 'v2' },
    );
}

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

// STATUS_NAMES, isDreamingStatus and CommitError live in ./commitShared so the
// panel can use them without loading this module; re-exported for callers here.
export { STATUS_NAMES, isDreamingStatus, isTerraformedStatus, CommitError };

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
 * `renderer` is the preview's ('v0' | 'v2'); the parcel must render with it.
 * `onStep(label)` reports progress through the checks.
 */
export async function prepareCommit({ tokenId, heightmap, account, renderer = 'v2', onStep = () => {}, provider: injected }) {
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

  // Before the status gate, so an already-committed parcel is still offered the
  // migration.
  const want = renderer === 'v0' ? 'v0' : 'v2';
  onStep(`parcel #${tokenId} renders with ${want}, as previewed`);
  const has = rendererName(await readRendererIndex(provider, id));
  if (has !== want) throw rendererMismatch(tokenId, has, want);

  const status = Number(statusRaw);
  onStep(`parcel #${tokenId} is dreaming`);
  if (isTerraformedStatus(status)) {
    // Only the owner can call enterDream; an authorized dreamer cannot.
    const isOwner = owner.toLowerCase() === me;
    throw new CommitError(
      isOwner
        ? `Parcel #${tokenId} is already ${STATUS_NAMES[status]}. It has to go back to daydream mode before a new heightmap can be committed.`
        : `Parcel #${tokenId} is already ${STATUS_NAMES[status]}. Only its owner (${owner}) can return it to daydream mode.`,
      { needsDream: isOwner },
    );
  }
  if (!isDreamingStatus(status)) {
    throw new CommitError(`Parcel #${tokenId} is in Terrain mode. It has to enter daydream mode before a heightmap can be committed.`);
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

  return { tokenId: Number(id), dream, status, newStatus, owner, gas, renderer: want };
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

// --- Switching renderer: the migration to v2, or back to v0 -------------------
//
// setTokenURIAddress(uint256[] tokens, uint256 index) writes only the parcel's
// renderer index; it requires msg.sender to OWN every listed token (an
// authorized dreamer is not enough) and index < tokenURIAddresses.length. No
// ETH, no transfers, no approvals, no events, no external calls, and it is
// reversible. tokenURIAddresses is append-only — pushed by the constructor and
// by the contract owner's addTokenURIAddress; nothing rewrites or removes an
// entry — so slot 0 is v0 for good; both slots are still checked before a send.
//
// The site sends it for ONE parcel and exactly two targets: index 2, the
// migration to v2 (since 2026-10-05), and index 0, the switch back to v0 (since
// 2026-11-17; James: for owners who want to create in the v0 style). On a mainnet
// fork the switch's only state change is that one storage write, traced opcode by
// opcode (~/ops/mandala-tx-tests/test-switch-fork.mjs).

const MIGRATE_SELECTOR = '0x29fdf854';
const MIGRATE_CALLDATA_BYTES = 4 + 32 * 4; // offset, index, length 1, tokenId

// The only renderer switches the site sends, frozen; anything else is refused.
const SWITCH_TARGETS = Object.freeze({
  v0: Object.freeze({ index: 0n, address: V0_RENDERER_ADDRESS }),
  v2: Object.freeze({ index: V2_INDEX, address: V2_RENDERER_ADDRESS }),
});
const switchTarget = (to) => (
  typeof to === 'string' && Object.prototype.hasOwnProperty.call(SWITCH_TARGETS, to) ? SWITCH_TARGETS[to] : null
);

/** Everything short of signing a switch of the parcel's renderer to `to` ('v2' | 'v0'). */
export async function prepareMigrate({ tokenId, account, to = 'v2', onStep = () => {}, provider: injected }) {
  const target = switchTarget(to);
  if (!target) throw new CommitError(`The site switches parcels only to v0 or v2, not ${to}.`);
  const id = BigInt(tokenId);
  if (id < 1n || id > 9911n) throw new CommitError('Only minted parcels (#1–#9911) can switch renderer.');
  const provider = injected ?? walletProvider();
  onStep('wallet is on Ethereum mainnet');
  await requireMainnet(provider);
  const tf = new Contract(TERRAFORMS_ADDRESS, TERRAFORMS_ABI, provider);

  onStep(`you own parcel #${tokenId}`);
  const owner = await tf.ownerOf(id);
  if (owner.toLowerCase() !== account.toLowerCase()) {
    throw new CommitError(`Only the owner can change a parcel's renderer. Parcel #${tokenId} is owned by ${owner}.`);
  }

  onStep(`renderer slot ${target.index} is the ${to} renderer`);
  const slot = await tf.tokenURIAddresses(target.index);
  if (slot.toLowerCase() !== target.address.toLowerCase()) {
    throw new CommitError(`Safety check failed: renderer slot ${target.index} is ${slot}, not the expected ${to} renderer. Nothing was sent.`);
  }

  onStep(`parcel #${tokenId} is not on ${to} yet`);
  const current = await readRendererIndex(provider, id);
  if (current === target.index) throw new CommitError(`Parcel #${tokenId} already renders with ${to}.`);

  onStep('the transaction simulates successfully');
  try {
    await tf.setTokenURIAddress.staticCall([id], target.index, { from: account });
  } catch (err) {
    throw new CommitError(`The contract would reject this transaction (${err.shortMessage || err.message}). Nothing was sent.`);
  }
  const gas = await tf.setTokenURIAddress.estimateGas([id], target.index, { from: account });
  return { tokenId: Number(id), from: current, fromName: rendererName(current), to, index: target.index, gas };
}

export async function sendMigrate(prepared, account) {
  const target = switchTarget(prepared?.to);
  if (!target || prepared.index !== target.index) {
    throw new CommitError('Safety check failed: this is not a renderer switch the site sends. Nothing was sent.');
  }
  const provider = walletProvider();
  await requireMainnet(provider);
  const signer = await provider.getSigner();
  if ((await signer.getAddress()).toLowerCase() !== account.toLowerCase()) {
    throw new CommitError('The wallet account changed. Reconnect and try again.');
  }
  const tf = new Contract(TERRAFORMS_ADDRESS, TERRAFORMS_ABI, signer);
  const gasLimit = (prepared.gas * 120n) / 100n;
  const tx = await tf.setTokenURIAddress.populateTransaction([BigInt(prepared.tokenId)], target.index, { gasLimit });
  assertMigrateTransaction(tx, prepared);
  return signer.sendTransaction(tx);
}

// Byte-level check of the switch handed to the wallet, for the same fallback()
// reason as the commit: right contract, setTokenURIAddress, exactly one tokenId,
// the index of the prepared target — 2 (v2) or 0 (v0), never anything else — and
// no ETH.
export function assertMigrateTransaction(tx, prepared) {
  const fail = (why) => {
    throw new CommitError(`Safety check failed: ${why}. Nothing was sent.`);
  };
  const target = switchTarget(prepared?.to);
  if (!target) fail('the renderer switch is not to v0 or v2');
  if (!tx.to || tx.to.toLowerCase() !== TERRAFORMS_ADDRESS.toLowerCase()) fail('the transaction is not addressed to the Terraforms contract');
  if (tx.value != null && BigInt(tx.value) !== 0n) fail('the transaction would send ETH');
  if (!tx.data?.startsWith(MIGRATE_SELECTOR)) fail('the transaction does not call setTokenURIAddress');
  if ((tx.data.length - 2) / 2 !== MIGRATE_CALLDATA_BYTES) fail('the transaction data is not the expected size');
  const [tokens, index] = new Contract(TERRAFORMS_ADDRESS, TERRAFORMS_ABI).interface
    .decodeFunctionData('setTokenURIAddress', tx.data);
  if (tokens.length !== 1 || tokens[0] !== BigInt(prepared.tokenId)) fail('the transaction would change a different set of parcels');
  if (index !== target.index) fail(`the transaction would select a renderer other than ${prepared.to}`);
}

/**
 * After mining: the parcel's stored renderer index at the mined block is the
 * target's (2 or 0). That is the decisive check — the contract routes tokenHTML
 * by exactly this value.
 *
 * Comparing the parcel's tokenHTML with the target renderer's output is kept as a
 * best-effort extra only: generating a parcel's HTML costs ~9–10M gas for many
 * parcels and over 30M for some (#5257), which many RPC nodes refuse for a read
 * call. A refusal must not make a successful migration look failed — which is
 * what happened on #9230 (2026-10-05). htmlCheck: 'match' | 'mismatch' | 'skipped'.
 */
export async function verifyMigrate(prepared, blockNumber) {
  const target = switchTarget(prepared.to);
  if (!target) throw new CommitError('This is not a renderer switch the site sends.');
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
    const targetHtml = await new Contract(target.address, RENDERER_ABI, provider)
      .tokenHTML(status, placement, seed, 0, canvas, { blockTag });
    htmlCheck = html === targetHtml ? 'match' : 'mismatch';
  } catch {
    // The node would not run the HTML call; the index check above stands.
  }
  return { ok: index === target.index, index, htmlCheck };
}

// --- Return to daydream ------------------------------------------------------
//
// enterDream(uint256 tokenId) requires msg.sender == ownerOf(tokenId) (an
// authorized dreamer is not enough). From Terraformed (2) it sets Daydream (1),
// from Origin Terraformed (4) Origin Daydream (3); it also records the block and
// emits Daydreaming. No ETH, no transfers. The stored canvas stays in storage
// but the renderers ignore it while the parcel dreams (every cell reads 0, a
// blank canvas) until the next commit overwrites it. On a TERRAIN parcel (0) the same call is a
// permanent change of mode, so the site only ever sends it for a parcel that is
// terraformed, and re-reads the status right before signing to be sure.

const DREAM_SELECTOR = '0xd359fc19';
const DREAM_CALLDATA_BYTES = 4 + 32;

export async function prepareDream({ tokenId, account, onStep = () => {}, provider: injected }) {
  const id = BigInt(tokenId);
  if (id < 1n || id > 9911n) throw new CommitError('Only minted parcels (#1–#9911) can enter daydream mode.');
  const provider = injected ?? walletProvider();
  onStep('wallet is on Ethereum mainnet');
  await requireMainnet(provider);
  const tf = new Contract(TERRAFORMS_ADDRESS, TERRAFORMS_ABI, provider);

  onStep(`you own parcel #${tokenId}`);
  const [owner, statusRaw] = await Promise.all([tf.ownerOf(id), tf.tokenToStatus(id)]);
  if (owner.toLowerCase() !== account.toLowerCase()) {
    throw new CommitError(`Only the owner can return a parcel to daydream mode. Parcel #${tokenId} is owned by ${owner}.`);
  }

  const status = Number(statusRaw);
  onStep(`parcel #${tokenId} is terraformed`);
  if (!isTerraformedStatus(status)) {
    throw new CommitError(
      isDreamingStatus(status)
        ? `Parcel #${tokenId} is already ${STATUS_NAMES[status]}; there is nothing to undo.`
        : `Parcel #${tokenId} is in Terrain mode. The site does not change Terrain parcels.`,
    );
  }

  onStep('the transaction simulates successfully');
  try {
    await tf.enterDream.staticCall(id, { from: account });
  } catch (err) {
    throw new CommitError(`The contract would reject this transaction (${err.shortMessage || err.message}). Nothing was sent.`);
  }
  const gas = await tf.enterDream.estimateGas(id, { from: account });
  return { tokenId: Number(id), status, newStatus: status - 1, gas };
}

export async function sendDream(prepared, account) {
  const provider = walletProvider();
  await requireMainnet(provider);
  const signer = await provider.getSigner();
  if ((await signer.getAddress()).toLowerCase() !== account.toLowerCase()) {
    throw new CommitError('The wallet account changed. Reconnect and try again.');
  }
  const tf = new Contract(TERRAFORMS_ADDRESS, TERRAFORMS_ABI, signer);
  // A parcel never returns to Terrain, so this cannot change after the checks;
  // read it anyway, because on Terrain the call is permanent.
  const status = Number(await tf.tokenToStatus(BigInt(prepared.tokenId)));
  if (!isTerraformedStatus(status) || status !== prepared.status) {
    throw new CommitError(`Parcel #${prepared.tokenId} is now ${STATUS_NAMES[status] ?? `status ${status}`}, not ${STATUS_NAMES[prepared.status]}. Nothing was sent.`);
  }
  const gasLimit = (prepared.gas * 120n) / 100n;
  const tx = await tf.enterDream.populateTransaction(BigInt(prepared.tokenId), { gasLimit });
  assertDreamTransaction(tx, prepared);
  return signer.sendTransaction(tx);
}

// Byte-level check, for the same fallback() reason as the commit: right
// contract, enterDream, exactly one tokenId = the parcel, no ETH.
export function assertDreamTransaction(tx, prepared) {
  const fail = (why) => {
    throw new CommitError(`Safety check failed: ${why}. Nothing was sent.`);
  };
  if (!tx.to || tx.to.toLowerCase() !== TERRAFORMS_ADDRESS.toLowerCase()) fail('the transaction is not addressed to the Terraforms contract');
  if (tx.value != null && BigInt(tx.value) !== 0n) fail('the transaction would send ETH');
  if (!tx.data?.startsWith(DREAM_SELECTOR)) fail('the transaction does not call enterDream');
  if ((tx.data.length - 2) / 2 !== DREAM_CALLDATA_BYTES) fail('the transaction data is not the expected size');
  const [tokenId] = new Contract(TERRAFORMS_ADDRESS, TERRAFORMS_ABI).interface.decodeFunctionData('enterDream', tx.data);
  if (tokenId !== BigInt(prepared.tokenId)) fail('the transaction targets a different parcel');
}

/** After mining: the parcel's status at the mined block is the daydream one. */
export async function verifyDream(prepared, blockNumber) {
  const provider = walletProvider();
  const blockTag = await blockReady(provider, blockNumber);
  const tf = new Contract(TERRAFORMS_ADDRESS, TERRAFORMS_ABI, provider);
  const status = Number(await tf.tokenToStatus(BigInt(prepared.tokenId), { blockTag }));
  return { ok: status === prepared.newStatus, status };
}

// --- Attunement --------------------------------------------------------------
//
// Fourth write path, added 2026-11-25 at James's request, to try a function nobody
// had ever called: setAttunement(uint256 tokenId, int256 attunement) on Terraforms'
// v2 metadata contract, TerraformsTokenURI_v2_0 behind its proxy (verified source;
// selector 0xf68a102a, present in the implementation's bytecode, checked 2026-11-25).
// It requires msg.sender == Terraforms.ownerOf(tokenId) (an authorized dreamer is not
// enough), stores the number at tokenPlacementToAttunement[tokenToPlacement(tokenId)]
// and emits AttunementSet(tokenId, attunement). No ETH, no transfers, nothing else
// stored; the number stays with the parcel's slot through a sale. The renderer ignores
// it today: it writes ATTUNEMENT=0 into every parcel's script whatever is stored.
// Mathcastles can upgrade the proxy, so it must still run the implementation that was
// read, or nothing is sent.

const TOKEN_URI_V2_IMPLEMENTATION = '0x0CE833EE4d97CEDc22bBf3B85c04b1fd9Ac5AbDd';
const EIP1967_IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const ATTUNE_SELECTOR = '0xf68a102a';
const ATTUNE_CALLDATA_BYTES = 4 + 32 * 2;
const TOKEN_URI_V2_ABI = [
  'function setAttunement(uint256 tokenId, int256 attunement)',
  'function tokenToAttunement(uint256 tokenId) view returns (int256)',
  'event AttunementSet(uint256 indexed tokenId, int256 attunement)',
];

// The site sends whole numbers no bigger than this either way: the parcel's script
// would read a bigger one inexactly (a JavaScript number), and a small number stays
// safe in whatever maths a later renderer might do with it.
export const ATTUNE_LIMIT = BigInt(Number.MAX_SAFE_INTEGER);

export function parseAttunement(input) {
  const text = String(input ?? '').trim();
  if (!/^-?\d+$/.test(text)) throw new CommitError('An attunement is a whole number, like 42 or -1.');
  const value = BigInt(text);
  if (value > ATTUNE_LIMIT || value < -ATTUNE_LIMIT) {
    throw new CommitError(`Keep the attunement between -${ATTUNE_LIMIT} and ${ATTUNE_LIMIT}.`);
  }
  return value;
}

async function requireAuditedTokenURI(provider) {
  const raw = await provider.getStorage(TOKEN_URI_V2_ADDRESS, EIP1967_IMPLEMENTATION_SLOT);
  const implementation = `0x${raw.slice(-40)}`;
  if (implementation.toLowerCase() !== TOKEN_URI_V2_IMPLEMENTATION.toLowerCase()) {
    throw new CommitError(`Mathcastles has upgraded the v2 metadata contract (it now runs ${implementation}), so this page needs re-checking before it sends anything. Nothing was sent.`);
  }
}

/** A parcel's stored attunement: 0 unless its owner has set one. */
export async function readAttunement(tokenId, { provider: injected, blockTag } = {}) {
  const provider = injected ?? walletProvider();
  const uri = new Contract(TOKEN_URI_V2_ADDRESS, TOKEN_URI_V2_ABI, provider);
  return blockTag == null ? uri.tokenToAttunement(BigInt(tokenId)) : uri.tokenToAttunement(BigInt(tokenId), { blockTag });
}

/** Everything short of signing setAttunement(tokenId, value). */
export async function prepareAttune({ tokenId, value, account, onStep = () => {}, provider: injected }) {
  const id = BigInt(tokenId);
  if (id < 1n || id > 9911n) throw new CommitError('Only minted parcels (#1–#9911) have an attunement.');
  const attunement = parseAttunement(value);
  const provider = injected ?? walletProvider();
  onStep('wallet is on Ethereum mainnet');
  await requireMainnet(provider);

  onStep(`you own parcel #${tokenId}`);
  const owner = await new Contract(TERRAFORMS_ADDRESS, TERRAFORMS_ABI, provider).ownerOf(id);
  if (owner.toLowerCase() !== account.toLowerCase()) {
    throw new CommitError(`Only the owner can set a parcel's attunement. Parcel #${tokenId} is owned by ${owner}.`);
  }

  onStep('the v2 metadata contract runs the code this page was checked against');
  await requireAuditedTokenURI(provider);

  onStep(`parcel #${tokenId}'s attunement is read`);
  const uri = new Contract(TOKEN_URI_V2_ADDRESS, TOKEN_URI_V2_ABI, provider);
  const current = await uri.tokenToAttunement(id);

  onStep('the transaction simulates successfully');
  try {
    await uri.setAttunement.staticCall(id, attunement, { from: account });
  } catch (err) {
    throw new CommitError(`The contract would reject this transaction (${err.shortMessage || err.message}). Nothing was sent.`);
  }
  const gas = await uri.setAttunement.estimateGas(id, attunement, { from: account });
  return { tokenId: Number(id), attunement, current, gas };
}

export async function sendAttune(prepared, account) {
  if (typeof prepared?.attunement !== 'bigint') {
    throw new CommitError('Safety check failed: the prepared attunement is not a whole number. Nothing was sent.');
  }
  const provider = walletProvider();
  await requireMainnet(provider);
  const signer = await provider.getSigner();
  if ((await signer.getAddress()).toLowerCase() !== account.toLowerCase()) {
    throw new CommitError('The wallet account changed. Reconnect and try again.');
  }
  await requireAuditedTokenURI(provider);
  const uri = new Contract(TOKEN_URI_V2_ADDRESS, TOKEN_URI_V2_ABI, signer);
  const gasLimit = (prepared.gas * 120n) / 100n;
  const tx = await uri.setAttunement.populateTransaction(BigInt(prepared.tokenId), prepared.attunement, { gasLimit });
  assertAttuneTransaction(tx, prepared);
  return signer.sendTransaction(tx);
}

// Byte-level check of the transaction handed to the wallet: the v2 metadata
// contract, setAttunement, exactly one tokenId and one number, both as prepared, the
// number within the limit, and no ETH.
export function assertAttuneTransaction(tx, prepared) {
  const fail = (why) => {
    throw new CommitError(`Safety check failed: ${why}. Nothing was sent.`);
  };
  if (!tx.to || tx.to.toLowerCase() !== TOKEN_URI_V2_ADDRESS.toLowerCase()) fail('the transaction is not addressed to the v2 metadata contract');
  if (tx.value != null && BigInt(tx.value) !== 0n) fail('the transaction would send ETH');
  if (!tx.data?.startsWith(ATTUNE_SELECTOR)) fail('the transaction does not call setAttunement');
  if ((tx.data.length - 2) / 2 !== ATTUNE_CALLDATA_BYTES) fail('the transaction data is not the expected size');
  const [tokenId, attunement] = new Contract(TOKEN_URI_V2_ADDRESS, TOKEN_URI_V2_ABI).interface
    .decodeFunctionData('setAttunement', tx.data);
  if (tokenId !== BigInt(prepared.tokenId)) fail('the transaction targets a different parcel');
  if (attunement !== prepared.attunement) fail('the transaction carries a different number');
  if (attunement > ATTUNE_LIMIT || attunement < -ATTUNE_LIMIT) fail('the number is out of range');
}

/** After mining: the stored number at the mined block, and the receipt's AttunementSet event. */
export async function verifyAttune(prepared, receipt) {
  const provider = walletProvider();
  const blockTag = await blockReady(provider, receipt.blockNumber);
  const stored = await readAttunement(prepared.tokenId, { provider, blockTag });
  const iface = new Contract(TOKEN_URI_V2_ADDRESS, TOKEN_URI_V2_ABI).interface;
  const logged = (receipt.logs || []).some((log) => {
    if (log.address?.toLowerCase() !== TOKEN_URI_V2_ADDRESS.toLowerCase()) return false;
    try {
      const event = iface.parseLog({ topics: [...log.topics], data: log.data });
      return event?.name === 'AttunementSet' && event.args.tokenId === BigInt(prepared.tokenId) && event.args.attunement === prepared.attunement;
    } catch {
      return false;
    }
  });
  return { ok: stored === prepared.attunement && logged, stored, logged };
}
