export function shortAddress(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function Footer() {
  return (
    <footer className="px-6 mt-16 mb-6 text-xs opacity-40">
      Built by{' '}
      <a href="https://x.com/TerraformsOTC" target="_blank" rel="noopener noreferrer">
        TerraformsOTC
      </a>{' '}
      and Claude · Sister tools:{' '}
      <a href="https://terraformestimator.xyz" target="_blank" rel="noopener noreferrer">
        estimator
      </a>
      {' · '}
      <a href="https://terraformlore.xyz" target="_blank" rel="noopener noreferrer">
        lore
      </a>
    </footer>
  );
}
