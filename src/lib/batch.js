// Resolve `fn` over `items` in sequential batches of `size`, so we never open
// more than `size` concurrent RPC connections at once. Public RPC endpoints
// (ethereum.publicnode.com et al.) silently drop calls beyond ~20–50 concurrent,
// which corrupts results and wastes quota — a wallet with 200 parcels would
// otherwise fire 200+ calls in a single Promise.all. Results preserve input order.
export async function mapInBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    out.push(...(await Promise.all(batch.map((item, j) => fn(item, i + j)))));
  }
  return out;
}
