import { NextResponse } from 'next/server';
import { fetchV0TokenHTML, fetchV2TokenHTML, extractAnimData } from '@/lib/tokenHTML';
import { getContract } from '@/lib/contract';
import { isUnminted, fetchUnmintedAnimData } from '@/lib/unminted';

export async function GET(req, { params }) {
  const tokenId = Number(params.tokenId);
  if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > 11104) {
    return NextResponse.json({ error: 'invalid tokenId' }, { status: 400 });
  }
  // ?renderer=v0|v2. Default v2. Both minted and unminted parcels support both.
  const rendererParam = new URL(req.url).searchParams.get('renderer');
  const requested = rendererParam === 'v0' ? 'v0' : 'v2';

  try {
    if (isUnminted(tokenId)) {
      const data = await fetchUnmintedAnimData(tokenId, { renderer: requested });
      // For v2 unminted, the patched template carries bladeRailSequencer plus
      // our patched SEED/BIOME/BIOMECODE, so extractAnimData computes blade +
      // biomecode correctly. For v0 unminted, the patched template has none
      // of those — meta.biome/zone/chroma/biomecode/blade all come back null,
      // which matches the v0-minted path and the meta panel hides them.
      const meta = extractAnimData(data.html);
      return NextResponse.json({
        tokenId,
        status: 0,
        owner: null,
        bg: data.bg,
        chars: data.chars,
        colors: data.colors,
        direction: data.direction,
        renderer: requested,
        seed: data.traits?.seed ?? meta.seed,
        biome: requested === 'v0' ? null : (data.traits?.biome ?? meta.biome),
        zone: requested === 'v0' ? null : (data.traits?.zone ?? meta.zone),
        chroma: requested === 'v0' ? null : (data.traits?.chroma ?? meta.chroma),
        biomecode: requested === 'v0' ? null : meta.biomecode,
        blade: requested === 'v0' ? null : meta.blade,
        isUnminted: true,
        html: data.html,
      });
    }

    const c = getContract();
    const [previewHtml, status, owner] = await Promise.all([
      requested === 'v0' ? fetchV0TokenHTML(tokenId) : fetchV2TokenHTML(tokenId),
      c.tokenToStatus(tokenId).then((s) => Number(s)).catch(() => null),
      c.ownerOf(tokenId).then((a) => String(a)).catch(() => null),
    ]);
    const meta = extractAnimData(previewHtml);

    return NextResponse.json({
      tokenId,
      status,
      owner,
      bg: meta.bg,
      chars: meta.chars,
      colors: meta.colors,
      direction: meta.direction,
      renderer: requested,
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
