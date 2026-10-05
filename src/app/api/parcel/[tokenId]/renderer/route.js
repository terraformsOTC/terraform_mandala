import { NextResponse } from 'next/server';
import { AbiCoder, keccak256 } from 'ethers';
import { getProvider, TERRAFORMS_ADDRESS } from '@/lib/contract';
import { enforce } from '@/lib/rateLimit';

// The parcel's renderer index (tokenToURIAddressIndex, a private mapping at
// storage slot 11128 — see src/lib/commit.js). The commit panel reads it through
// the user's wallet first; this is the fallback for wallets whose connection
// does not serve eth_getStorageAt.
export async function GET(req, { params }) {
  const { tokenId: raw } = await params;
  const tokenId = Number(raw);
  if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > 9911) {
    return NextResponse.json({ error: 'invalid tokenId' }, { status: 400 });
  }
  const blocked = enforce(req, 'renderer', { max: 30, windowMs: 60_000 });
  if (blocked) return blocked;
  try {
    const slot = keccak256(AbiCoder.defaultAbiCoder().encode(['uint256', 'uint256'], [tokenId, 11128]));
    const index = BigInt(await getProvider().getStorage(TERRAFORMS_ADDRESS, slot));
    return NextResponse.json({ tokenId, index: index.toString() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'failed to read renderer' }, { status: 502 });
  }
}
