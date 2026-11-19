import { NextResponse } from 'next/server';
import { getContract } from '@/lib/contract';
import { enforce } from '@/lib/rateLimit';

// The canvas a parcel stores (tokenToCanvasData, 16 uint256) and its status, for the
// seal decoder (/seal). Read-only. A parcel that never committed stores nothing: the
// public getter reverts past the end of the array, so reading stops at the first revert.
export async function GET(req, { params }) {
  const { tokenId: raw } = await params;
  const tokenId = Number(raw);
  if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > 9911) {
    return NextResponse.json({ error: 'invalid tokenId' }, { status: 400 });
  }
  const blocked = enforce(req, 'canvas', { max: 20, windowMs: 60_000 });
  if (blocked) return blocked;
  try {
    const c = getContract();
    // The 16 slots in parallel; the canvas is the run before the first revert.
    const [status, ...slots] = await Promise.allSettled([
      c.tokenToStatus(tokenId),
      ...Array.from({ length: 16 }, (_, i) => c.tokenToCanvasData(tokenId, i)),
    ]);
    if (status.status !== 'fulfilled') throw status.reason;
    const canvas = [];
    for (const s of slots) {
      if (s.status !== 'fulfilled') break;
      canvas.push(s.value.toString());
    }
    return NextResponse.json({ tokenId, status: Number(status.value), canvas }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'failed to read the canvas' }, { status: 502 });
  }
}
