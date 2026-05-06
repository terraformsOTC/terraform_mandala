import { JsonRpcProvider, Contract } from 'ethers';

export const TERRAFORMS_ADDRESS = '0x4E1f41613c9084FdB9E34E11fAE9412427480e56';

export const ABI = [
  'function tokenURI(uint256) view returns (string)',
  'function tokenHTML(uint256) view returns (string)',
  'function tokenToStatus(uint256) view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function tokenOfOwnerByIndex(address, uint256) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
];

// Mapping confirmed against on-chain observation:
//  - tokens 7173, 9686 (status 0) display as Terrain on terraforms.xyz
//  - token 871 (status 2) was committed via commitDreamToCanvas → Terraformed
//  - token 83 (status 3) is a genesis/1-of-1 → Origin
// Status 1 ("Daydream") covers tokens that have called enterDream and are in
// the editable pre-commit state. Confirmed by project context.
const STATUS_LABELS = {
  0: 'Terrain',
  1: 'Daydream',
  2: 'Terraformed',
  3: 'Origin',
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
