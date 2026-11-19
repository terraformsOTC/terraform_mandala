import { NextResponse } from 'next/server';
import { getProvider, TERRAFORMS_ADDRESS } from '@/lib/contract';
import { enforce } from '@/lib/rateLimit';

// A transaction to the Terraforms contract, for the seal decoder (/seal): its calldata
// and when it was mined. A seal committed with commitDreamToCanvas is timestamped by its
// block, which is what makes a commitment a proof of when. Read-only; anything that is
// not a mined transaction to Terraforms is refused.
export async function GET(req, { params }) {
  const { hash } = await params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash || '')) {
    return NextResponse.json({ error: 'invalid transaction hash' }, { status: 400 });
  }
  const blocked = enforce(req, 'tx', { max: 20, windowMs: 60_000 });
  if (blocked) return blocked;
  try {
    const provider = getProvider();
    const tx = await provider.getTransaction(hash);
    if (!tx) return NextResponse.json({ error: 'transaction not found' }, { status: 404 });
    if (!tx.to || tx.to.toLowerCase() !== TERRAFORMS_ADDRESS.toLowerCase()) {
      return NextResponse.json({ error: 'not a transaction to the Terraforms contract' }, { status: 422 });
    }
    if (tx.blockNumber == null) return NextResponse.json({ error: 'not mined yet' }, { status: 409 });
    const [receipt, block] = await Promise.all([provider.getTransactionReceipt(hash), provider.getBlock(tx.blockNumber)]);
    return NextResponse.json({
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      input: tx.data,
      blockNumber: tx.blockNumber,
      timestamp: block?.timestamp ?? null,
      status: receipt?.status ?? null,
    }, { headers: { 'Cache-Control': 'public, max-age=300' } });
  } catch {
    return NextResponse.json({ error: 'failed to read the transaction' }, { status: 502 });
  }
}
