import { JsonRpcProvider, Contract } from 'ethers';
import { TERRAFORMS_ADDRESS, V2_RENDERER_ADDRESS, V0_RENDERER_ADDRESS } from './addresses';

// Re-exported for server code. Client components import from ./addresses so the
// constants don't drag ethers into their bundle.
export { TERRAFORMS_ADDRESS, V2_RENDERER_ADDRESS, V0_RENDERER_ADDRESS };

const ABI = [
  'function tokenURI(uint256) view returns (string)',
  'function tokenHTML(uint256) view returns (string)',
  'function tokenToStatus(uint256) view returns (uint8)',
  'function tokenToPlacement(uint256) view returns (uint256)',
  'function seed() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function tokenOfOwnerByIndex(address, uint256) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
];

// Both v0 and v2 renderers expose the same tokenHTML signature, so we share
// one ABI fragment between them.
const RENDERER_ABI = [
  'function tokenHTML(uint256 status, uint256 placement, uint256 seed, uint256 yearsOfDecay, uint256[] calldata canvasData) view returns (string)',
];

// Mapping confirmed against on-chain observation:
//  - tokens 7173, 9686 (status 0) display as Terrain on terraforms.xyz
//  - token 871 (status 2) was committed via commitDreamToCanvas → Terraformed
//  - token 83 (status 3) is a genesis/1-of-1 origin parcel, pre-commit → Origin
//  - token 117 (status 4) is an origin parcel that has been terraformed → Origin
// Status 1 ("Daydream") covers tokens that have called enterDream and are in
// the editable pre-commit state. Origin parcels split into daydream (3) and
// terraformed (4) the same way regular parcels split into 1 and 2; both render
// the seed-derived glyph set instead of the blade (see originGlyphs.js).
// Confirmed by project context.
const STATUS_LABELS = {
  0: 'Terrain',
  1: 'Daydream',
  2: 'Terraformed',
  3: 'Origin',
  4: 'Origin',
};

export function statusLabel(status) {
  const n = Number(status);
  return STATUS_LABELS[n] || `Status ${n}`;
}

let _provider = null;
export function getProvider() {
  if (_provider) return _provider;
  const url = process.env.RPC_URL || 'https://ethereum.publicnode.com';
  _provider = new JsonRpcProvider(url);
  return _provider;
}

export function getContract() {
  return new Contract(TERRAFORMS_ADDRESS, ABI, getProvider());
}

export function getV2RendererContract() {
  return new Contract(V2_RENDERER_ADDRESS, RENDERER_ABI, getProvider());
}

export function getV0RendererContract() {
  return new Contract(V0_RENDERER_ADDRESS, RENDERER_ABI, getProvider());
}
