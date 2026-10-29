'use client';

export function shortAddress(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// `note`: an extra line above the standing credit, e.g. for the pattern in use.
export function Footer({ note = null } = {}) {
  return (
    <footer className="px-6 mt-16 mb-6 text-xs opacity-40 leading-relaxed">
      {note && <p className="mb-2">{note}</p>}
      This project builds on top of the 2025 0xGoldenFlower project and mandala algo originally
      conceived by @d3l33t, a Mathcastles community member. Carried forward by TerraformsOTC with
      LLM assistance. This is experimental software, always independently verify transactions
      constructed using this tool before submitting.
    </footer>
  );
}
