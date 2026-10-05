// Commit a mandala heightmap on-chain with Terraforms.commitDreamToCanvas.
//
// This is the only code path on the site that writes to Ethereum, so every
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
// Contract facts below are from the verified source on Sourcify
// (contracts/TerraformsDreaming.sol), checked 2026-10-04: selector 0x502f260c
// is present in the deployed bytecode.

import { BrowserProvider, Contract } from 'ethers';
import { TERRAFORMS_ADDRESS, V0_RENDERER_ADDRESS, V2_RENDERER_ADDRESS } from './contract';
import { toCanvasUints, validate, TOTAL } from './heightmap';

const MAINNET = 1n;

const TERRAFORMS_ABI = [
  'function commitDreamToCanvas(uint256 tokenId, uint256[16] dream)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenToStatus(uint256 tokenId) view returns (uint8)',
  'function tokenToAuthorizedDreamer(uint256 tokenId) view returns (address)',
  'function tokenToPlacement(uint256 tokenId) view returns (uint256)',
  'function tokenToCanvasData(uint256 tokenId, uint256 index) view returns (uint256)',
  'function seed() view returns (uint256)',
];

const RENDERER_ABI = [
  'function tokenHeightmapIndices(uint256 status, uint256 placement, uint256 seed, uint256 yearsOfDecay, uint256[] canvasData) view returns (uint256[32][32])',
];

export const STATUS_NAMES = ['Terrain', 'Daydream', 'Terraformed', 'Origin Daydream', 'Origin Terraformed'];

// The contract's gate: commitDreamToCanvas requires status % 2 == 1.
export const isDreamingStatus = (status) => Number(status) % 2 === 1;

export class CommitError extends Error {}

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
export async function verifyCommit(prepared) {
  const provider = walletProvider();
  const tf = new Contract(TERRAFORMS_ADDRESS, TERRAFORMS_ABI, provider);
  const id = BigInt(prepared.tokenId);
  const status = Number(await tf.tokenToStatus(id));
  const stored = await Promise.all(prepared.dream.map((_, i) => tf.tokenToCanvasData(id, i)));
  const canvasOk = stored.every((v, i) => v === prepared.dream[i]);
  return { ok: canvasOk && status === prepared.newStatus, status, canvasOk };
}
