import { NextResponse } from 'next/server';
import { fetchTokenHTML, fetchV2TokenHTML, extractAnimData } from '@/lib/tokenHTML';
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
        colors: data.colors,
        direction: data.direction,
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
    let meta = extractAnimData(html);
    let previewHtml = html;

    // For v0 parcels: fetch directly from the v2 renderer contract so the
    // preview shows the full v2 daydream animation with blade + chroma data.
    if (!meta.hasV2Renderer) {
      previewHtml = await fetchV2TokenHTML(tokenId);
      meta = extractAnimData(previewHtml);
    }

    return NextResponse.json({
      tokenId,
      status,
      owner,
      bg: meta.bg,
      chars: meta.chars,
      colors: meta.colors,
      direction: meta.direction,
      hasV2Renderer: true,
      seed: meta.seed,
      biome: meta.biome,
      zone: meta.zone,
      biomecode: meta.biomecode,
      blade: meta.blade,
      chroma: meta.chroma,
      isUnminted: false,
      html: previewHtml,
    });
  } catch (err) {
    console.error('[animdata]', err.message);
    return NextResponse.json({ error: 'failed to fetch parcel data' }, { status: 500 });
  }
}
