'use client';

import { shortAddress } from './shared';

export default function Header({ walletAddress, onConnect, onDisconnect }) {
  const short = shortAddress(walletAddress);

  return (
    <header className="z-10 px-6 py-4 md:py-6 md:mb-6 mb-3 sticky top-0 md:relative bg-primary">
      <nav className="flex flex-row justify-between items-center" style={{ minHeight: '36px' }}>
        <div className="flex items-center">
          <a className="md:my-0 no-underline" href="/">[terraform mandala]</a>
        </div>
        <div className="flex items-center gap-4">
          <a
            href="https://terraformestimator.xyz"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm opacity-60 hover:opacity-100 transition-opacity no-underline hidden md:inline whitespace-nowrap"
          >
            [estimator ↗]
          </a>
          <a
            href="https://terraformlore.xyz"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm opacity-60 hover:opacity-100 transition-opacity no-underline hidden md:inline whitespace-nowrap"
          >
            [lore ↗]
          </a>
          <a
            href="https://terraformexplorer.xyz/dreams"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm opacity-60 hover:opacity-100 transition-opacity no-underline hidden md:inline whitespace-nowrap"
          >
            [dream timeline ↗]
          </a>
          {/* wallet connect temporarily disabled */}
        </div>
      </nav>
    </header>
  );
}
