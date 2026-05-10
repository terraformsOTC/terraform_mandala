import { NextResponse } from 'next/server';
import { fetchTokenHTML, extractAnimData } from '@/lib/tokenHTML';
import { getContract } from '@/lib/contract';
import { isUnminted, fetchUnmintedAnimData } from '@/lib/unminted';

export async function GET(_req, { params }) {
  const tokenId = Number(params.tokenId);
  if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > 11104) {
    return NextResponse.json({ error: 'invalid tokenId' }, { status: 400 });
  }
  try {
    if (isUnminted(tokenId)) {
      const data = await fetchUnmintedAnimData(tokenId);
      return NextResponse.json({
        tokenId,
        status: 0,
        owner: null,
        bg: data.bg,
        chars: data.chars,
        hasV2Renderer: false,
        isUnminted: true,
        html: data.html,
      });
    }

    const c = getContract();
    const [html, status, owner] = await Promise.all([
      fetchTokenHTML(tokenId),
      c.tokenToStatus(tokenId).then((s) => Number(s)).catch(() => null),
      c.ownerOf(tokenId).then((a) => String(a)).catch(() => null),
    ]);
    const meta = extractAnimData(html);
    return NextResponse.json({
      tokenId,
      status,
      owner,
      bg: meta.bg,
      chars: meta.chars,
      hasV2Renderer: meta.hasV2Renderer,
      isUnminted: false,
      html,
    });
  } catch (err) {
    console.error('[animdata]', err.message);
    return NextResponse.json({ error: 'failed to fetch parcel data' }, { status: 500 });
  }
}
