#!/usr/bin/env node
// Reference decoder for Terraform seals (TFS1), from terraformmandala.xyz/seal: seals written in
// a drawing's digits and seals hidden in its grain.
// Needs Node 18+ and seal.mjs beside it (the format is documented at its top). It reads
// the chain through any Ethereum JSON-RPC node; nothing else is contacted.
//
//   node decode.mjs <parcel id | commit tx hash | 1024 digits> [options]
//     --secret <s>                     open a sealed message
//     --text <t> | --file <path>       the revealed content of a commitment or a plain hash
//     --salt <hex>                     a salted commitment's salt
//     --item <tfs1:…>                  check one revealed item of a list commitment
//     --rpc <url>                      JSON-RPC endpoint (default https://ethereum-rpc.publicnode.com)
import { readFileSync } from 'node:fs';
import { findSeal, openSeal, verifyCommitment, verifyHash, verifyListItem, heightmapFromCanvas, parseCommitCalldata } from './seal.mjs';

const TERRAFORMS = '0x4e1f41613c9084fdb9e34e11fae9412427480e56';
const CANVAS_DATA = '0xb9173bb6'; // tokenToCanvasData(uint256,uint256)

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const input = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const RPC = opt('rpc') || 'https://ethereum-rpc.publicnode.com';
if (!input) {
  console.log('usage: node decode.mjs <parcel id | commit tx hash | 1024 digits> [--secret S] [--text T | --file PATH] [--salt HEX] [--item TOKEN] [--rpc URL]');
  process.exit(2);
}

async function rpc(method, params) {
  const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await res.json();
  if (body.error) throw Object.assign(new Error(body.error.message || 'rpc error'), { rpc: body.error });
  return body.result;
}
const word = (n) => BigInt(n).toString(16).padStart(64, '0');

let heightmap;
if (/^\d{1,4}$/.test(input)) {
  // The getter reverts past the end of a shorter canvas: keep the run before the first revert.
  const reads = await Promise.allSettled(Array.from({ length: 16 }, (_, i) =>
    rpc('eth_call', [{ to: TERRAFORMS, data: CANVAS_DATA + word(input) + word(i) }, 'latest'])));
  const canvas = [];
  for (const r of reads) {
    if (r.status !== 'fulfilled') { if (!r.reason?.rpc) throw r.reason; break; }
    canvas.push(BigInt(r.value));
  }
  if (canvas.length !== 16) { console.log(`parcel #${input} stores no drawing`); process.exit(1); }
  heightmap = heightmapFromCanvas(canvas);
  console.log(`parcel #${input}: its stored drawing`);
} else if (/^0x[0-9a-fA-F]{64}$/.test(input)) {
  const tx = await rpc('eth_getTransactionByHash', [input]);
  if (!tx) { console.log('transaction not found'); process.exit(1); }
  if ((tx.to || '').toLowerCase() !== TERRAFORMS) { console.log('not a transaction to the Terraforms contract'); process.exit(1); }
  const call = parseCommitCalldata(tx.input);
  if (!call) { console.log('not a commitDreamToCanvas transaction'); process.exit(1); }
  const [receipt, block] = await Promise.all([rpc('eth_getTransactionReceipt', [input]), rpc('eth_getBlockByNumber', [tx.blockNumber, false])]);
  heightmap = heightmapFromCanvas(call.canvas);
  console.log(`committed to parcel #${call.tokenId} by ${tx.from} in block ${Number(tx.blockNumber)}, ${new Date(Number(block.timestamp) * 1000).toISOString()}` +
    (receipt && Number(receipt.status) === 0 ? ' (REVERTED: it never took effect)' : ''));
} else {
  heightmap = input.replace(/\s+/g, '');
}

const seal = await findSeal(heightmap);
if (!seal) { console.log('no seal in this drawing'); process.exit(1); }
const where = seal.carrier === 'grain' ? `hidden in the grain (${seal.size}-byte frame)` : `${seal.layout} layout`;
console.log(`seal: ${seal.mode}, ${where}${seal.compressed ? ', compressed' : ''}${seal.fillerIntact ? '' : ' (payload intact, other cells changed)'}`);
const content = opt('file') ? { bytes: new Uint8Array(readFileSync(opt('file'))) } : opt('text') !== undefined ? { text: opt('text') } : null;
const done = (ok, yes, no) => { console.log(ok ? yes : no); process.exit(ok ? 0 : 1); };
if (seal.mode === 'inscription') console.log(`text:\n${seal.text}`);
if (seal.mode === 'sealed') {
  const s = opt('secret') || opt('key');
  if (s) console.log(`text:\n${await openSeal(seal, s)}`);
  else console.log('sealed: pass --secret to open it');
}
if (seal.mode === 'commitment') {
  console.log(`fingerprint: ${seal.digest}`);
  if (content && opt('salt')) done(await verifyCommitment(seal, content, opt('salt')), 'MATCHES: whoever committed this had this content', 'does NOT match (content or salt differs)');
  console.log('pass --text or --file, and --salt, to check a reveal');
}
if (seal.mode === 'hash') {
  console.log(`sha-256: ${seal.digest}`);
  if (content) done(await verifyHash(seal, content), 'MATCHES: this is the content behind the hash', 'does NOT match');
  console.log('pass --text or --file to check it');
}
if (seal.mode === 'list') {
  console.log(`list: ${seal.count} items, root ${seal.root}`);
  if (opt('item')) {
    const r = await verifyListItem(seal, opt('item'));
    done(r.ok, `MATCHES: item ${r.index + 1} of ${seal.count}:\n${r.text}`, 'does NOT match: this reveal is not part of this list');
  }
  console.log('pass --item to check one revealed item');
}
