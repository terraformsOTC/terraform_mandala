import { NextResponse } from 'next/server';
import { getContract, statusLabel } from '@/lib/contract';
import { enforce } from '@/lib/rateLimit';
import { mapInBatches } from '@/lib/batch';

const MAX_PARCELS = 200;
// Enumeration + status fan out to 2 RPC calls per parcel; cap concurrency so a
// large wallet doesn't fire hundreds of simultaneous calls at the public RPC.
const RPC_BATCH = 20;

export async function GET(req, { params }) {
  const { address } = await params;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: 'invalid address' }, { status: 400 });
  }
  // Heaviest route (up to 400 RPC calls cold) — keep the per-instance limit tight.
  const blocked = enforce(req, 'wallet', { max: 10, windowMs: 60_000 });
  if (blocked) return blocked;
  try {
    const c = getContract();
    const balance = Number(await c.balanceOf(address));
    if (balance === 0) {
      return NextResponse.json({ address, totalParcels: 0, parcels: [] });
    }
    const fetchCount = Math.min(balance, MAX_PARCELS);

    const indices = Array.from({ length: fetchCount }, (_, i) => i);
    const tokenIds = await mapInBatches(indices, RPC_BATCH, (i) =>
      c.tokenOfOwnerByIndex(address, i).then((b) => Number(b)),
    );
    const statuses = await mapInBatches(tokenIds, RPC_BATCH, (id) =>
      c.tokenToStatus(id).then((s) => Number(s)).catch(() => null),
    );

    const parcels = tokenIds.map((tokenId, i) => ({
      tokenId,
      status: statuses[i],
      statusLabel: statuses[i] != null ? statusLabel(statuses[i]) : null,
    })).sort((a, b) => a.tokenId - b.tokenId);

    return NextResponse.json({
      address,
      totalParcels: balance,
      fetchedParcels: parcels.length,
      parcels,
    });
  } catch (err) {
    console.error('[wallet]', err.message);
    return NextResponse.json({ error: 'failed to fetch wallet parcels' }, { status: 500 });
  }
}
