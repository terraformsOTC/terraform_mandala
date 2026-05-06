import { NextResponse } from 'next/server';
import { fetchTokenHTML, extractAnimData } from '@/lib/tokenHTML';
import { getContract } from '@/lib/contract';

export async function GET(_req, { params }) {
  const tokenId = Number(params.tokenId);
  if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > 11104) {
    return NextResponse.json({ error: 'invalid tokenId' }, { status: 400 });
  }
  try {
    const c = getContract();
    const [html, status] = await Promise.all([
      fetchTokenHTML(tokenId),
      c.tokenToStatus(tokenId).then((s) => Number(s)).catch(() => null),
    ]);
    const meta = extractAnimData(html);
    return NextResponse.json({
      tokenId,
      status,
      bg: meta.bg,
      chars: meta.chars,
      html,
    });
  } catch (err) {
    console.error('[animdata]', err.message);
    return NextResponse.json({ error: 'failed to fetch parcel data' }, { status: 500 });
  }
}
