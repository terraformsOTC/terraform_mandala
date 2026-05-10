'use client';

import { BrowserProvider, Contract } from 'ethers';
import { ABI, TERRAFORMS_ADDRESS, MAINNET_CHAIN_ID } from './contract';

// Client-side helpers for write transactions. Uses window.ethereum via ethers
// v6 BrowserProvider. The read-side getContract() in contract.js stays
// JsonRpcProvider-backed and server-only — we never expose RPC URL to the
// client.

async function getSignedContract() {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('No wallet detected.');
  }
  const provider = new BrowserProvider(window.ethereum);
  const network = await provider.getNetwork();
  if (network.chainId !== MAINNET_CHAIN_ID) {
    throw new Error(
      `Wrong network — switch your wallet to Ethereum mainnet (current: chainId ${network.chainId}).`,
    );
  }
  const signer = await provider.getSigner();
  return { contract: new Contract(TERRAFORMS_ADDRESS, ABI, signer), signer };
}

export async function sendEnterDream(tokenId) {
  const { contract } = await getSignedContract();
  return contract.enterDream(tokenId);
}

export async function sendCommitDream(tokenId, encodedArray) {
  if (!Array.isArray(encodedArray) || encodedArray.length !== 16) {
    throw new Error('commitDreamToCanvas expects exactly 16 uint256 hex strings.');
  }
  const { contract } = await getSignedContract();
  return contract.commitDreamToCanvas(tokenId, encodedArray);
}
