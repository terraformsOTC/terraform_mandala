export function shortAddress(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function Footer() {
  return (
    <footer className="px-6 mt-16 mb-6 text-xs opacity-40 leading-relaxed">
      This project builds on top of the 2025 0xGoldenFlower project and mandala algo originally
      conceived by @d3l33t, a Mathcastles community member. Carried forward by{' '}
      <a href="https://x.com/TerraformsOTC" target="_blank" rel="noopener noreferrer">
        TerraformsOTC
      </a>{' '}
      and Claude. This is experimental software, always independently verify transactions
      constructed using this tool before submitting.
    </footer>
  );
}
