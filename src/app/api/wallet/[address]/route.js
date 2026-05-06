import { NextResponse } from 'next/server';
import { getContract, statusLabel } from '@/lib/contract';

const MAX_PARCELS = 200;

export async function GET(_req, { params }) {
  const { address } = params;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: 'invalid address' }, { status: 400 });
  }
  try {
    const c = getContract();
    const balance = Number(await c.balanceOf(address));
    if (balance === 0) {
      return NextResponse.json({ address, totalParcels: 0, parcels: [] });
    }
    const fetchCount = Math.min(balance, MAX_PARCELS);

    const indices = Array.from({ length: fetchCount }, (_, i) => i);
    const tokenIds = await Promise.all(
      indices.map((i) => c.tokenOfOwnerByIndex(address, i).then((b) => Number(b))),
    );
    const statuses = await Promise.all(
      tokenIds.map((id) => c.tokenToStatus(id).then((s) => Number(s)).catch(() => null)),
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
