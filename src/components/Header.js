'use client';

import { useEffect, useState } from 'react';
import { shortAddress } from './shared';

export default function Header({ walletAddress, onConnect, onDisconnect }) {
  const short = shortAddress(walletAddress);
  const [hasEthereum, setHasEthereum] = useState(true);
  // window.ethereum is undefined on first paint in SSR and on mobile/no-extension
  // browsers. Detect after mount so we can disable the connect button accurately.
  useEffect(() => {
    setHasEthereum(typeof window !== 'undefined' && typeof window.ethereum !== 'undefined');
  }, []);

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
          {walletAddress ? (
            <button
              type="button"
              className="btn-primary btn-sm text-xs whitespace-nowrap"
              onClick={onDisconnect}
              title="disconnect"
            >
              {short} ⨯
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary btn-sm text-xs whitespace-nowrap"
              onClick={onConnect}
              disabled={!hasEthereum}
              title={hasEthereum ? 'connect wallet' : 'no wallet extension detected'}
            >
              [connect wallet]
            </button>
          )}
        </div>
      </nav>
    </header>
  );
}
