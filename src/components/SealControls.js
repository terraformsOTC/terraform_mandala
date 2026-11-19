'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { SEAL_DEMO_TEXT } from '@/lib/sealDemos';
import { SEAL_COVERS, coverForMode, grainCover, coverTops } from '@/lib/sealCovers';

// Seals (James, 2026-11-17): write a commitment, a plain hash, a sealed message, an
// inscription or a committed list into the heightmap; the commit panel then puts it on-chain
// like any other drawing. Everything happens in this tab: the text, file, secret and salts are
// never sent anywhere (not in the URL, not in any request; the site's CSP allows no other
// origin) and nothing is stored — the reveal shown here, and its file, are the only copy.
// The flower layout (James, 2026-11-19: "We are only going with messages encoded in grain") hides
// the seal in the grain of #6454's flower instead of writing it into the digits: the flower as
// dreamt for anything readable or fixed-size, the smaller flower for a sealed message
// (sealCovers.js), each with a fresh speckle for every seal.
const loadSeal = () => import('@/lib/seal');

export const SEAL_MODE_LABELS = { commitment: 'commitment', sealed: 'sealed message', inscription: 'inscription', list: 'list commitment' };
export const SEAL_LAYOUT_LABELS = { flower: 'flower', eighth: 'eight-fold', quarter: 'four-fold', pinwheel: 'pinwheel', mirror: 'mirror', rotation: 'half-turn', plain: 'none' };
// A sealed message goes into the sunflower (James, 2026-11-19: "change the name to sunflower").
export const sealLayoutLabel = (layout, mode) => (layout === 'flower' && mode === 'sealed' ? 'sunflower' : SEAL_LAYOUT_LABELS[layout]);
const COVER_TRIES = 8;   // fresh speckles to try before a grain seal gives up (every kind fitted 30/30 at the first)
const MAX_FILE = 256 * 1024 * 1024;
const BOX = { border: '1px solid rgba(232,232,232,0.15)' };

const HELP = {
  commitment: 'Only a fingerprint (SHA-256) of your text or file goes on-chain, with a random salt mixed in so nobody can test guesses. Later, publish the content and the salt: anyone can check they match, and the commit transaction proves you had it then.',
  hash: 'A plain SHA-256 of your text or file — what sha256sum prints — or a digest you made elsewhere. No salt: anyone can test guesses against it, so use it for content nobody could guess (a file, a long text).',
  sealed: 'Your text goes on-chain encrypted (AES-256-GCM), padded so even its length is hidden. Publish the secret whenever you like and anyone can open it straight from the chain. The seal opens with that one secret only.',
  inscription: 'Your text goes on-chain as it is, hidden in plain sight: it looks like noise, but anyone with the decoder can read it.',
  list: 'One secret per line, each with its own salt, committed as one fingerprint (a Merkle root). Reveal any line on its own, whenever you like; the others stay hidden.',
};
// In the flower's grain the sealed message is the grain's own, more compact kind, and texts are stored as they are.
const GRAIN_HELP = {
  sealed: 'Your text goes on-chain encrypted (a SHA-256 keystream, sealed by an HMAC-SHA256 tag), padded so even its length is hidden. Publish the secret whenever you like and anyone can open it straight from the chain. The seal opens with that one secret only.',
  inscription: 'Your text goes on-chain as it is, hidden in plain sight: the flower looks as dreamt, but anyone with the decoder can read it.',
};
const GRAIN_NOTE = {
  flower: 'Hidden in the grain: the flower stays exactly as dreamt (#6454); only speckles of its field move, by one height.',
  miniflower: 'Hidden in the grain of the sunflower, whose wider field holds an encrypted message. Its petals are drawn a little differently for every seal, so each one is unique; only speckles move, by one height, and the speckle stays as dense whatever the message\'s length.',
};

export default function SealControls({ params, update, lastCommit }) {
  const mode = params.sealMode;
  const salted = params.sealSalt !== 0;
  const kind = mode === 'commitment' && !salted ? 'hash' : mode;   // seal.js's mode
  const layout = params.sealLayout;
  const isGrain = layout === 'flower';
  const cover = isGrain ? coverForMode(kind) : null;
  const [text, setText] = useState('');
  const [source, setSource] = useState('text'); // text | file | digest (commitment, hash)
  const [file, setFile] = useState(null);       // { name, bytes, sha256 }
  const [digest, setDigest] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sealed, setSealed] = useState(null);   // what made the drawing on show, with its reveal
  const [stored, setStored] = useState(null);   // { bytes, raw } of the text as stored
  const [S, setS] = useState(null);
  const latest = useRef({});
  latest.current = { kind, layout, update };

  useEffect(() => { loadSeal().then(setS); }, []);

  // A sealed drawing whose reveal this panel no longer holds (it was unmounted: the pattern
  // changed and came back) must not stay on show to be committed blind.
  useEffect(() => {
    if (params.sealHeightmap) update({ sealHeightmap: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Digest input only exists for a plain hash.
  useEffect(() => { if (kind !== 'hash' && source === 'digest') setSource('text'); }, [kind, source]);
  const usesSource = kind === 'commitment' || kind === 'hash';
  const src = usesSource ? source : 'text';

  // Stored size of the text, compression included (never in a grain), for the counter.
  useEffect(() => {
    let live = true;
    if (!S || !(kind === 'inscription' || kind === 'sealed')) { setStored(null); return undefined; }
    if (isGrain) { const n = S.textBytes(text).length; setStored({ bytes: n, raw: n }); return undefined; }
    S.storedTextLength(text).then((n) => live && setStored({ bytes: n, raw: S.textBytes(text).length }));
    return () => { live = false; };
  }, [S, text, kind, isGrain]);

  const cap = !S ? null
    : isGrain ? (kind === 'inscription' || kind === 'sealed' ? S.grainTextCapacity(kind, SEAL_COVERS[cover].frame) : Infinity)
      : S.sealCapacity(layout, kind);
  const items = useMemo(() => text.split(/\r\n?|\n/).map((t) => t.trim()).filter(Boolean), [text]);
  const tooLong = cap != null && stored && stored.bytes > cap;
  const ready = !busy && !tooLong && (
    kind === 'list' ? items.length > 0 && items.length <= 256
      : src === 'file' ? !!file
        : src === 'digest' ? /^[0-9a-f]{64}$/i.test(digest.trim().split(/\s+/)[0] || '')
          : text.length > 0);

  // The drawing on show is this panel's seal only while the heightmap is still the one it made.
  const current = sealed && params.sealHeightmap === sealed.heightmap ? sealed : null;
  const committed = current && lastCommit && lastCommit.heightmap === current.heightmap ? lastCommit : null;

  async function pickFile(f) {
    setError(null);
    setFile(null);
    if (!f) return;
    if (f.size > MAX_FILE) { setError('Files up to 256 MB.'); return; }
    const bytes = new Uint8Array(await f.arrayBuffer());
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    setFile({ name: f.name, bytes, sha256: Array.from(d, (v) => v.toString(16).padStart(2, '0')).join('') });
  }

  async function seal() {
    setBusy(true);
    setError(null);
    try {
      const Sl = await loadSeal();
      const input = { mode: kind, layout };
      if (kind === 'list') input.items = items;
      else if (src === 'file') input.bytes = file.bytes;
      else if (src === 'digest') input.digest = digest;
      else input.text = text;
      let enc, dec, ok;
      if (isGrain) {
        // A fresh speckle for every seal; when the trellis cannot reach a frame in it, another.
        let base = null;
        for (let t = 0; t < COVER_TRIES && !enc; t++) {
          base = grainCover(cover, undefined, { petal: params.sealPetal, corona: params.sealCorona, bud: params.sealBud });
          try {
            enc = await Sl.encodeGrain({ ...input, heightmap: base.heightmap, alt: base.alt, size: SEAL_COVERS[cover].size ?? undefined });
          } catch (e) {
            if (!/too small/.test(e.message)) throw e;
          }
        }
        if (!enc) throw new Error("the flower's grain could not hold this seal; try again, or pick a digit layout");
        // Read it straight back: a grain seal, and only grain cells moved (the flower is as dreamt).
        dec = await Sl.findSeal(enc.heightmap);
        ok = dec && dec.carrier === 'grain' && dec.mode === kind && dec.size === enc.size && dec.fillerIntact
          && [...enc.heightmap].every((v, i) => v === base.heightmap[i] || (base.alt[i] != null && Number(v) === base.alt[i]));
      } else {
        enc = await Sl.encodeSeal(input);
        // Read it straight back before showing it: the drawing must decode to what was sealed.
        dec = await Sl.decodeSeal(enc.heightmap);
        ok = dec && dec.mode === kind && dec.layout === layout && dec.fillerIntact;
      }
      const content = src === 'file' ? { bytes: file.bytes } : src === 'digest' ? { digest } : { text };
      if (ok && kind === 'inscription') ok = dec.text === Sl.normalizeText(text);
      if (ok && kind === 'sealed') ok = (await Sl.openSeal(dec, enc.reveal.secret)) === Sl.normalizeText(text);
      if (ok && kind === 'commitment') ok = await Sl.verifyCommitment(dec, content, enc.reveal.salt);
      if (ok && kind === 'hash') ok = await Sl.verifyHash(dec, content);
      if (ok && kind === 'list') ok = (await Promise.all(enc.reveal.items.map((it) => Sl.verifyListItem(dec, it.token)))).every((r) => r.ok);
      if (!ok) throw new Error('the drawing did not decode back to what you sealed, so it was not used');
      // The mode or layout changed while sealing: this seal is for neither; drop it.
      if (latest.current.kind !== kind || latest.current.layout !== layout) return;
      setSealed({
        heightmap: enc.heightmap, kind, layout, reveal: enc.reveal, compressed: !!enc.compressed,
        grain: isGrain ? { cover, size: enc.size, changed: enc.changed } : null,
        source: src, text: kind === 'list' ? null : Sl.normalizeText(text), file: src === 'file' ? { name: file.name, sha256: file.sha256 } : null,
      });
      latest.current.update({ sealHeightmap: enc.heightmap });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const links = current && committed ? revealLinks(current, committed) : [];
  const fileText = current ? revealFile(current, committed, links) : '';

  return (
    <div className="flex flex-col gap-2 text-xs">
      {mode === 'commitment' && (
        <Toggle
          label="salt"
          options={[[1, 'salted'], [0, 'plain SHA-256']]}
          value={salted ? 1 : 0}
          onSelect={(v) => update({ sealSalt: v, sealHeightmap: null })}
        />
      )}
      {isGrain && (
        <PartHeights
          tops={coverTops(cover)}
          petal={params.sealPetal}
          corona={params.sealCorona}
          bud={params.sealBud}
          // a seal is drawn at its heights: other heights mean sealing again
          onChange={(patch) => update({ ...patch, sealHeightmap: null })}
        />
      )}
      <p className="opacity-70 leading-relaxed">{(isGrain && GRAIN_HELP[kind]) || HELP[kind]}</p>
      {isGrain && <p className="opacity-60 leading-relaxed">{GRAIN_NOTE[cover]}</p>}
      {usesSource && (
        <Toggle
          label="content"
          options={[['text', 'text'], ['file', 'file'], ...(kind === 'hash' ? [['digest', 'digest']] : [])]}
          value={src}
          onSelect={(v) => { setSource(v); setError(null); }}
        />
      )}
      {src === 'file' ? (
        <div className="flex flex-col gap-1">
          <input type="file" aria-label="seal file" onChange={(e) => pickFile(e.target.files?.[0])} />
          {file && <span className="opacity-60 break-all">{file.name} — SHA-256 {file.sha256}</span>}
          <span className="opacity-50">The file is read here and never uploaded.</span>
        </div>
      ) : src === 'digest' ? (
        <input
          value={digest}
          onChange={(e) => setDigest(e.target.value)}
          placeholder="a SHA-256 digest (64 hex characters, e.g. from sha256sum)"
          spellCheck={false}
          autoComplete="off"
          aria-label="seal digest"
        />
      ) : (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={kind === 'list' ? 6 : 4}
          placeholder={kind === 'list' ? 'one secret per line' : kind === 'commitment' || kind === 'hash' ? 'what you know now (any length)' : 'your message'}
          className="w-full"
          spellCheck={false}
          autoComplete="off"
          aria-label="seal text"
        />
      )}
      <span className="opacity-60" style={tooLong ? { color: '#f87171', opacity: 1 } : undefined}>
        {counter(kind, src, { cap, stored, items, layout, tooLong, cover })}
      </span>
      <button type="button" className="btn-primary btn-sm text-xs self-start" disabled={!ready} onClick={seal}>
        {busy ? '[sealing…]' : '[seal it]'}
      </button>
      {error && <p style={{ color: '#f87171' }}>{error}</p>}

      {!current && !isGrain && (
        <p className="opacity-50 leading-relaxed">
          On show: an example seal, an inscription of &ldquo;{SEAL_DEMO_TEXT}&rdquo;. Every seal of the same layout
          shares its first cells, the format&apos;s mark; the rest is the content.
        </p>
      )}
      {!current && isGrain && params.sealPetal == null && params.sealCorona == null && params.sealBud == null && (
        <p className="opacity-50 leading-relaxed">
          On show: an example, an inscription of &ldquo;{SEAL_DEMO_TEXT}&rdquo; hidden in the {cover === 'miniflower' ? 'sunflower' : 'flower'}&apos;s
          grain. Your seal gets a fresh speckle of its own.
        </p>
      )}
      {!current && isGrain && (params.sealPetal != null || params.sealCorona != null || params.sealBud != null) && (
        <p className="opacity-50 leading-relaxed">
          On show: the {cover === 'miniflower' ? 'sunflower' : 'flower'} at these heights, not sealed yet. [seal it] draws
          your seal at them, with a fresh speckle.
        </p>
      )}

      {current && (
        <div className="flex flex-col gap-2 p-2 mt-1" style={BOX}>
          <span>
            ✓ sealed and read back: this drawing decodes to what you sealed{current.compressed ? ' (stored compressed)' : ''}.
            {current.grain && ` Hidden in the grain: ${current.grain.changed} speckles moved by one height (a ${current.grain.size}-byte frame).`}
          </span>
          {current.kind === 'sealed' && <Secret label="Secret — the only thing that opens it. Anyone holding it can open the seal." value={current.reveal.secret} />}
          {current.kind === 'commitment' && <Secret label={`Salt — keep it with the exact ${current.source === 'file' ? 'file' : 'text'}. Until you publish both, nobody can tell what the seal holds.`} value={current.reveal.salt} />}
          {current.kind === 'hash' && <span className="opacity-70 break-all">SHA-256 {current.reveal.digest}. Nothing secret to keep: reveal the {current.source === 'file' ? 'file' : current.source === 'digest' ? 'content behind the digest' : 'text'} whenever you like.</span>}
          {current.kind === 'list' && <span className="opacity-70">{current.reveal.items.length} items, each with its own reveal in the reveal file: publish one and the others stay hidden.</span>}
          {current.kind === 'inscription' && <span className="opacity-70">Not secret: anyone with the decoder can read it.</span>}
          {(current.kind === 'sealed' || current.kind === 'commitment' || current.kind === 'list') && (
            <span style={{ color: '#fbbf24' }}>
              This site keeps nothing. Lose the reveal file and nobody can ever {current.kind === 'sealed' ? 'open' : 'prove'} this seal, you included.
            </span>
          )}
          <a
            className="btn-primary btn-sm text-xs no-underline self-start"
            download={`terraform-seal-${current.kind}${committed ? `-${committed.tokenId}` : ''}.txt`}
            href={`data:text/plain;charset=utf-8,${encodeURIComponent(fileText)}`}
          >
            [save reveal file{committed ? ' — with its transaction' : ''}]
          </a>
          {!committed && (
            <span className="opacity-60 leading-relaxed">
              Commit it below like any drawing. Once it is mined, its transaction and reveal links appear here and
              in the reveal file: the transaction dates the seal.
            </span>
          )}
          {committed && (
            <div className="flex flex-col gap-1">
              <span className="opacity-80 break-all">
                Committed to #{committed.tokenId} in{' '}
                <a href={`https://etherscan.io/tx/${committed.txHash}`} target="_blank" rel="noopener noreferrer">{committed.txHash.slice(0, 10)}…</a>.
                Save the reveal file again: it now includes the transaction.
              </span>
              <span style={{ color: '#fbbf24' }}>
                {current.kind === 'inscription' || current.kind === 'hash'
                  ? 'Reveal link — opens the decoder on this seal:'
                  : 'Reveal links — publishing one reveals the secret in it. Keep them private until then:'}
              </span>
              {links.slice(0, 3).map((l) => <code key={l.url} className="break-all select-all opacity-80">{l.url}</code>)}
              {links.length > 3 && <span className="opacity-60">…and {links.length - 3} more in the reveal file.</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function counter(kind, src, { cap, stored, items, layout, tooLong, cover }) {
  const where = layout === 'flower' ? `the ${cover === 'miniflower' ? 'sunflower' : 'flower'}'s grain` : `the ${SEAL_LAYOUT_LABELS[layout]} layout`;
  if (kind === 'list') return `${items.length} item${items.length === 1 ? '' : 's'} (up to 256) — only their fingerprint is stored`;
  if (kind === 'commitment' || kind === 'hash') {
    if (src === 'digest') return 'the digest itself is stored';
    return `any ${src === 'file' ? 'file' : 'length'} — only its fingerprint is stored`;
  }
  if (!stored) return '…';
  const note = stored.bytes < stored.raw ? ` (compressed from ${stored.raw})` : '';
  const advice = layout === 'flower' ? ' — too long for the grain: shorten it, or pick a digit layout' : ' — too long: pick a layout with less symmetry';
  return `${stored.bytes}${note} / ${cap} bytes in ${where}${tooLong ? advice : ''}`;
}

function revealLinks(s, c) {
  const base = `${typeof window !== 'undefined' ? window.location.origin : 'https://terraformmandala.xyz'}/seal#tx=${c.txHash}`;
  const q = (k, v) => `&${k}=${encodeURIComponent(v)}`;
  if (s.kind === 'sealed') return [{ label: 'opens it', url: base + q('secret', s.reveal.secret) }];
  if (s.kind === 'commitment') return [{ label: 'proves it', url: base + q('salt', s.reveal.salt) + (s.source === 'text' ? q('text', s.text) : '') }];
  if (s.kind === 'hash') return [{ label: 'checks it', url: base + (s.source === 'text' ? q('text', s.text) : '') }];
  if (s.kind === 'list') return s.reveal.items.map((it) => ({ label: `reveals item ${it.index + 1}`, url: base + q('item', it.token) }));
  return [{ label: 'reads it', url: base }];
}

function revealFile(s, c, links) {
  const L = ['TERRAFORM SEAL — keep this file private until you reveal.', `mode: ${s.kind}`,
    s.grain ? `layout: ${s.grain.cover === 'miniflower' ? 'sunflower' : 'flower'} — in the grain of ${s.grain.cover === 'miniflower' ? 'the sunflower' : "#6454's flower"} (${s.grain.size}-byte frame)` : `layout: ${s.layout}`];
  if (c) L.push(`parcel: #${c.tokenId}`, `transaction: ${c.txHash}`, `https://etherscan.io/tx/${c.txHash}`);
  else L.push('transaction: (not committed yet: save this file again after committing)');
  if (s.kind === 'sealed') L.push(`secret: ${s.reveal.secret}`);
  if (s.kind === 'commitment') L.push(`salt: ${s.reveal.salt}`);
  if (s.kind === 'hash') L.push(`sha-256: ${s.reveal.digest}`);
  if (s.file) L.push(`file: ${s.file.name} (SHA-256 ${s.file.sha256}) — keep the file itself, unchanged`);
  if (s.text != null && s.source === 'text') L.push('', 'text (exact, between the lines):', '-----', s.text, '-----');
  if (s.kind === 'list') {
    L.push('', 'items — each reveal token proves its own line and nothing else:');
    for (const it of s.reveal.items) L.push('', `${it.index + 1}. ${it.text}`, `   salt ${it.salt}`, `   reveal: ${it.token}`);
  }
  if (links.length) {
    L.push('', 'REVEAL LINKS — publishing a link reveals what it holds:');
    for (const l of links) L.push(`${l.label}: ${l.url}`);
  }
  L.push('', 'Decode or verify at https://terraformmandala.xyz/seal — the format and a reference decoder are there.');
  return L.join('\n');
}

// The flower's three heights (James, 2026-11-19: "toggle the petal and central seed bud heights
// separately", then the zone between them: the corona). Each slider is the part's top height; the
// part moves as a whole (rims and gradient keep their steps until they reach 0), so 0 lays it flat.
// null = as drawn.
function PartHeights({ tops, petal, corona, bud, onChange }) {
  const row = (label, key, value, top) => (
    <div className="flex flex-col gap-1">
      <span className="opacity-60 uppercase tracking-wider">
        {label} — {value ?? top}{value == null ? ' (as drawn)' : value === 9 ? ' (empty)' : ''}
        {value != null && (
          <button type="button" className="ml-2 opacity-70 hover:opacity-100 normal-case" onClick={() => onChange({ [key]: null })}>[as drawn]</button>
        )}
      </span>
      <input type="range" min={0} max={9} step={1} value={value ?? top} aria-label={label} onChange={(e) => onChange({ [key]: Number(e.target.value) })} style={{ width: '100%' }} />
    </div>
  );
  return (
    <div className="flex flex-col gap-2">
      {row('petal height', 'sealPetal', petal, tops.petal)}
      {row('corona height', 'sealCorona', corona, tops.corona)}
      {row('bud height', 'sealBud', bud, tops.bud)}
    </div>
  );
}

function Secret({ label, value }) {
  return (
    <>
      <span className="opacity-70">{label}</span>
      <code className="break-all select-all">{value}</code>
      <button type="button" className="btn-primary btn-sm text-xs self-start" onClick={() => navigator.clipboard?.writeText(value)}>[copy]</button>
    </>
  );
}

function Toggle({ label, options, value, onSelect }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="opacity-60 uppercase tracking-wider">{label}</span>
      <div className="flex gap-2">
        {options.map(([v, l]) => (
          <button
            key={String(v)}
            type="button"
            className="btn-primary btn-sm text-xs flex-1"
            style={{ opacity: value === v ? 1 : 0.5 }}
            aria-pressed={value === v}
            onClick={() => onSelect(v)}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}
