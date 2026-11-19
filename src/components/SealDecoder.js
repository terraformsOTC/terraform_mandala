'use client';

import { useEffect, useRef, useState } from 'react';

// The public seal decoder (James, 2026-11-17: "publish a decoder, where someone could feed
// the heightmap in to get the original message or secret"). Needs no wallet. Secrets, texts,
// salts and files given here stay in this tab: decoding and checking run in the browser, and
// a reveal link carries its secret in the URL fragment (#…), which browsers never send.
const loadSeal = () => import('@/lib/seal');
const LAYOUT = { eighth: 'eight-fold', quarter: 'four-fold', pinwheel: 'pinwheel', mirror: 'mirror', rotation: 'half-turn', plain: 'none' };
const KIND = { inscription: 'an inscription', sealed: 'a sealed message', commitment: 'a salted commitment', hash: 'a plain SHA-256 hash', list: 'a list commitment' };
const BOX = { border: '1px solid rgba(232,232,232,0.15)' };
const TIMEOUT_MS = 45000;
const get = (url) => fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });

async function readInput(raw, S) {
  const v = raw.trim();
  const tx = /0x[0-9a-fA-F]{64}/.exec(v);   // a bare hash, or an Etherscan link to one
  if (/^#?\d{1,4}$/.test(v)) {
    const id = v.replace('#', '');
    const res = await get(`/api/parcel/${id}/canvas`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'could not read the parcel');
    if (body.canvas.length !== 16) throw new Error(`Parcel #${id} has no stored drawing.`);
    return { heightmap: S.heightmapFromCanvas(body.canvas), source: { kind: 'parcel', tokenId: Number(id), status: body.status } };
  }
  if (tx && (v === tx[0] || /etherscan\.io\/tx\//i.test(v))) {
    const res = await get(`/api/tx/${tx[0]}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'could not read the transaction');
    const call = S.parseCommitCalldata(body.input);
    if (!call) throw new Error('That transaction is not a commitDreamToCanvas.');
    return { heightmap: S.heightmapFromCanvas(call.canvas), source: { kind: 'tx', ...body, tokenId: call.tokenId } };
  }
  const digits = v.replace(/\s+/g, '');
  if (/^[0-9]{1024}$/.test(digits)) return { heightmap: digits, source: { kind: 'digits' } };
  const nums = v.replace(/[[\]"']/g, ' ').split(/[\s,]+/).filter(Boolean);
  if (nums.length === 16 && nums.every((n) => /^\d+$/.test(n))) return { heightmap: S.heightmapFromCanvas(nums), source: { kind: 'canvas' } };
  throw new Error('Paste a parcel number, a commit transaction (hash or Etherscan link), 1024 digits, or the 16 canvas numbers.');
}

export default function SealDecoder() {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [found, setFound] = useState(null);
  const [secret, setSecret] = useState('');
  const [text, setText] = useState('');
  const [salt, setSalt] = useState('');
  const [digest, setDigest] = useState('');
  const [item, setItem] = useState('');
  const [file, setFile] = useState(null); // { name, bytes }
  const [answer, setAnswer] = useState(null);
  const fromLink = useRef(null);

  async function decode(value = input) {
    setBusy(true); setError(null); setFound(null); setAnswer(null);
    try {
      const S = await loadSeal();
      const { heightmap, source } = await readInput(value, S);
      const seal = await S.decodeSeal(heightmap);
      setFound({ seal, source });
      return seal;
    } catch (e) {
      setError(e.name === 'TimeoutError' ? 'The chain read timed out. Try again in a moment.' : e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function check(seal, given) {
    const S = await loadSeal();
    const content = given.file ? { bytes: given.file.bytes } : { text: given.text };
    try {
      if (seal.mode === 'sealed') return setAnswer({ ok: true, open: await S.openSeal(seal, given.secret) });
      if (seal.mode === 'commitment') {
        const ok = await S.verifyCommitment(seal, content, given.salt);
        return setAnswer({ ok, message: ok ? `Matches. Whoever committed this drawing had this ${given.file ? 'file' : 'text'}.` : 'Does not match: the content or the salt differs (every character counts).' });
      }
      if (seal.mode === 'hash') {
        const ok = await S.verifyHash(seal, given.digest ? { digest: given.digest } : content);
        return setAnswer({ ok, message: ok ? 'Matches: this is the content behind the hash.' : 'Does not match: SHA-256 of this content differs.' });
      }
      if (seal.mode === 'list') {
        const r = await S.verifyListItem(seal, given.item);
        return setAnswer({ ok: r.ok, message: r.ok ? `Item ${r.index + 1} of ${seal.count}, committed in this drawing:` : 'This reveal is not part of this list.', item: r.ok ? r.text : null });
      }
    } catch (e) {
      setAnswer({ ok: false, message: e.message });
    }
    return null;
  }

  // A reveal link: /seal#tx=…&secret=… | &salt=…&text=… | &text=… | &item=… — the fragment
  // never leaves the browser. Decode, fill the fields and check at once.
  useEffect(() => {
    const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const target = h.get('tx') || h.get('parcel');
    if (!target) return;
    const given = { secret: h.get('secret') || '', salt: h.get('salt') || '', text: h.get('text') ?? '', item: h.get('item') || '', digest: h.get('digest') || '' };
    fromLink.current = given;
    setInput(target);
    setSecret(given.secret); setSalt(given.salt); setText(given.text); setItem(given.item); setDigest(given.digest);
    decode(target).then((seal) => {
      if (!seal) return;
      const can = (seal.mode === 'sealed' && given.secret) || (seal.mode === 'commitment' && given.salt && given.text)
        || (seal.mode === 'hash' && (given.text || given.digest)) || (seal.mode === 'list' && given.item);
      if (can) check(seal, given);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickFile(f) {
    setFile(null);
    if (!f) return;
    if (f.size > 256 * 1024 * 1024) { setAnswer({ ok: false, message: 'Files up to 256 MB.' }); return; }
    setFile({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  }

  const seal = found?.seal;
  const src = found?.source;
  const when = src?.kind === 'tx' && src.timestamp ? new Date(src.timestamp * 1000).toUTCString() : null;
  const given = { secret, salt, text, item, digest, file };

  return (
    <div className="flex flex-col gap-4 text-sm">
      <h1 className="text-lg opacity-90">[seal decoder]</h1>
      <p className="opacity-75 leading-relaxed">
        A <strong>seal</strong> is a message written into a Terraforms heightmap — the 1,024 digits a parcel stores when
        its owner commits a drawing. It looks like noise, or a kaleidoscope of it. It can be a <strong>commitment</strong>{' '}
        (a fingerprint of a secret, salted, or a plain SHA-256), a <strong>list commitment</strong> (many secrets, revealed one
        at a time), a <strong>sealed message</strong> (encrypted, opened later by a published secret) or an{' '}
        <strong>inscription</strong> anyone can read. The commit transaction dates it.
      </p>
      <a href="/?seed=seal&algo=seal" className="btn-primary btn-sm text-xs no-underline self-start">[make a seal — connect the wallet that owns a dreaming parcel]</a>

      <label className="flex flex-col gap-1">
        <span className="text-xs opacity-60 uppercase tracking-wider">parcel number, commit transaction, or heightmap</span>
        <textarea rows={3} value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} autoComplete="off"
          aria-label="seal input" placeholder="e.g. 7384, or 0x… / an Etherscan link (the commitDreamToCanvas transaction), or the 1024 digits" />
      </label>
      <button type="button" className="btn-primary btn-sm text-xs self-start" disabled={busy || !input.trim()} onClick={() => decode()}>
        {busy ? '[reading…]' : '[decode]'}
      </button>
      {error && <p style={{ color: '#f87171' }}>{error}</p>}

      {found && !seal && <p className="opacity-80">No seal in this drawing.</p>}
      {seal && (
        <div className="flex flex-col gap-2 p-3" style={BOX}>
          <span>
            This drawing is <strong>{KIND[seal.mode]}</strong>, {LAYOUT[seal.layout]} layout{seal.compressed ? ', stored compressed' : ''}.
            {!seal.fillerIntact && <span style={{ color: '#fbbf24' }}> (Its payload checks out, but cells outside it were changed.)</span>}
          </span>
          {src?.kind === 'tx' && (
            <span className="opacity-75">
              Committed to parcel #{src.tokenId} by {src.from.slice(0, 6)}…{src.from.slice(-4)} in block {src.blockNumber}
              {when ? `, ${when}` : ''}{src.status === 0 ? ' — that transaction reverted, so it never took effect' : ''}.{' '}
              <a href={`https://etherscan.io/tx/${src.hash}`} target="_blank" rel="noopener noreferrer">[etherscan ↗]</a>
            </span>
          )}
          {src?.kind === 'parcel' && (
            <span className="opacity-75">
              Parcel #{src.tokenId}&apos;s stored drawing{src.status % 2 === 1 ? ' (the parcel is dreaming, so it is stored but not shown)' : ''}.
              For the date it was committed, decode its commit transaction instead.
            </span>
          )}

          {seal.mode === 'inscription' && <pre className="whitespace-pre-wrap p-2" style={BOX}>{seal.text}</pre>}

          {seal.mode === 'sealed' && (
            <>
              <input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="the secret (43 characters)" spellCheck={false} autoComplete="off" aria-label="secret" />
              <button type="button" className="btn-primary btn-sm text-xs self-start" disabled={!secret.trim()} onClick={() => check(seal, given)}>[open]</button>
            </>
          )}

          {(seal.mode === 'commitment' || seal.mode === 'hash') && (
            <>
              <span className="opacity-75 break-all">{seal.mode === 'hash' ? 'SHA-256' : 'Fingerprint'}: <code>{seal.digest}</code></span>
              <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="the revealed text, exactly" spellCheck={false} autoComplete="off" aria-label="revealed text" />
              <label className="flex flex-col gap-1 opacity-80">
                <span className="text-xs opacity-60">…or the revealed file (read here, never uploaded)</span>
                <input type="file" aria-label="revealed file" onChange={(e) => pickFile(e.target.files?.[0])} />
              </label>
              {seal.mode === 'commitment' && (
                <input value={salt} onChange={(e) => setSalt(e.target.value)} placeholder="the salt (32 hex characters)" spellCheck={false} autoComplete="off" aria-label="salt" />
              )}
              <button type="button" className="btn-primary btn-sm text-xs self-start"
                disabled={!(text || file) || (seal.mode === 'commitment' && !salt.trim())} onClick={() => check(seal, given)}>[verify]</button>
            </>
          )}

          {seal.mode === 'list' && (
            <>
              <span className="opacity-75 break-all">{seal.count} item{seal.count === 1 ? '' : 's'}, Merkle root <code>{seal.root}</code></span>
              <textarea rows={3} value={item} onChange={(e) => setItem(e.target.value)} placeholder="an item's reveal (tfs1:…)" spellCheck={false} autoComplete="off" aria-label="item reveal" />
              <button type="button" className="btn-primary btn-sm text-xs self-start" disabled={!item.trim()} onClick={() => check(seal, given)}>[verify item]</button>
            </>
          )}

          {answer && (answer.open != null
            ? <pre className="whitespace-pre-wrap p-2" style={BOX}>{answer.open}</pre>
            : (
              <>
                <p style={{ color: answer.ok ? '#86efac' : '#f87171' }}>{answer.ok ? '✓ ' : '✗ '}{answer.message}</p>
                {answer.item != null && <pre className="whitespace-pre-wrap p-2" style={BOX}>{answer.item}</pre>}
              </>
            ))}
        </div>
      )}

      <section className="mt-6 pt-4 border-t border-current border-opacity-10 flex flex-col gap-2 opacity-80 leading-relaxed">
        <h2 className="text-base">How it works</h2>
        <p>
          The drawing is the record and the commit transaction dates it. A <strong>salted commitment</strong> stores{' '}
          <code>SHA-256(&quot;terraform-seal/commit/v1&quot; | 0x00 | salt | content)</code> with a 16-byte random salt, so even
          a short or guessable text cannot be found by trying candidates; a <strong>plain hash</strong> stores{' '}
          <code>SHA-256(content)</code>, what sha256sum prints, which anyone can test guesses against. A{' '}
          <strong>list</strong> stores the root of a Merkle tree of salted items, so each can be revealed alone. A{' '}
          <strong>sealed message</strong> stores the text encrypted with AES-256-GCM under keys derived from a 32-byte
          secret, padded so its length is hidden, with a commitment to that secret so no second secret can open it to
          another text. An <strong>inscription</strong> stores the text itself. Texts are DEFLATE-compressed when that
          makes them shorter.
        </p>
        <p>
          The bytes (<code>TFS</code>, version, mode, length, payload, a 4-byte check, then filler) are read as one number
          and written in decimal into the cells: every cell (none), half (mirror, half-turn), a quarter (four-fold,
          pinwheel) or an eighth (eight-fold); the other cells repeat them. One parcel holds 425 bytes at most (1,024
          decimal digits are 3,401 bits); eight-fold holds 56, enough for any commitment. Any changed digit breaks the
          symmetry or the check.
        </p>
        <h2 className="text-base mt-2">Decode it yourself</h2>
        <p>
          The full format is at the top of <a href="/seal/seal.mjs">seal.mjs</a>, the one file this page and the designer
          use. With Node 18+ and nothing else installed, <a href="/seal/decode.mjs">decode.mjs</a> reads a parcel or a
          commit transaction from any Ethereum node. Test vectors: <a href="/seal/vectors.json">vectors.json</a>.
        </p>
        <pre className="whitespace-pre-wrap p-2 text-xs" style={BOX}>{`node decode.mjs 7384
node decode.mjs 0x<commit transaction> --secret <secret>
node decode.mjs 0x<commit transaction> --text "the secret" --salt <salt>
node decode.mjs 0x<commit transaction> --file ./document.pdf
node decode.mjs 0x<commit transaction> --item tfs1:…`}</pre>
        <h2 className="text-base mt-2">On-chain</h2>
        <p>
          The same decoder also lives on Ethereum, as a contract with no owner that nobody can change:{' '}
          <strong>TerraformSealReader</strong>, <code className="break-all">0xF0ecd91e78E0042C1b81945BC8FFB3E7D0E3B623</code>{' '}
          <a href="https://etherscan.io/address/0xf0ecd91e78e0042c1b81945bc8ffb3e7d0e3b623#readContract" target="_blank" rel="noopener noreferrer">[etherscan ↗]</a>.
          It reads a parcel&apos;s drawing straight from the Terraforms contract. <code>decode</code>, <code>textOf</code>,{' '}
          <code>open</code> and the <code>verify</code> functions are free to call from Etherscan&apos;s Read Contract tab
          or any Ethereum node, with no website.
        </p>
      </section>
    </div>
  );
}
