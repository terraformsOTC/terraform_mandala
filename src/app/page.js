'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Header from '@/components/Header';
import ParcelGrid from '@/components/ParcelGrid';
import ErrorBoundary from '@/components/ErrorBoundary';
import MandalaDesigner, { defaultParams } from '@/components/MandalaDesigner';
import { Footer } from '@/components/shared';
import { DEFAULTS } from '@/lib/mandala';
import { randomSeed } from '@/lib/seedrandom';

const SEARCH_PARAM_KEYS = ['token', 'seed', 'variance', 'peak', 'start', 'order'];

export default function Home() {
  return (
    <ErrorBoundary>
      <Suspense fallback={null}>
        <HomeInner />
      </Suspense>
    </ErrorBoundary>
  );
}

function HomeInner() {
  const searchParams = useSearchParams();

  const [walletAddress, setWalletAddress] = useState(null);
  const [parcels, setParcels] = useState(null);
  const [parcelsLoading, setParcelsLoading] = useState(false);
  const [error, setError] = useState(null);

  const [selectedTokenId, setSelectedTokenId] = useState(() => {
    const raw = searchParams.get('token');
    if (!raw) return null;
    const t = Number(raw);
    return Number.isInteger(t) && t >= 1 && t <= 11104 ? t : null;
  });
  const [tokenInput, setTokenInput] = useState(() => searchParams.get('token') || '');
  const [animData, setAnimData] = useState(null);
  const [animLoading, setAnimLoading] = useState(false);

  const [params, setParams] = useState(() => paramsFromUrl(searchParams) || defaultParams());

  const walletRef = useRef(walletAddress);
  useEffect(() => { walletRef.current = walletAddress; }, [walletAddress]);

  const loadWallet = useCallback(async (addr) => {
    setParcelsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/wallet/${encodeURIComponent(addr)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'failed to load wallet');
      setParcels(data.parcels);
    } catch (err) {
      setError(err.message);
      setParcels([]);
    } finally {
      setParcelsLoading(false);
    }
  }, []);

  const submitTokenId = useCallback(() => {
    const n = Number(tokenInput);
    if (!Number.isInteger(n) || n < 1 || n > 11104) {
      setError('parcel id must be between 1 and 11104');
      return;
    }
    setError(null);
    setSelectedTokenId(n);
  }, [tokenInput]);

  const connectWallet = useCallback(async () => {
    if (typeof window === 'undefined' || typeof window.ethereum === 'undefined') {
      setError('No wallet detected. Install MetaMask or another Web3 wallet.');
      return;
    }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const addr = accounts[0];
      setWalletAddress(addr);
      await loadWallet(addr);
    } catch (err) {
      if (err?.code !== 4001) setError(err.message || 'wallet connection failed');
    }
  }, [loadWallet]);

  const disconnectWallet = useCallback(() => {
    setWalletAddress(null);
    setParcels(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.ethereum?.on) return;
    const handler = (accounts) => {
      const next = accounts?.[0];
      if (!next) {
        disconnectWallet();
        return;
      }
      const prev = walletRef.current;
      if (prev && prev.toLowerCase() === next.toLowerCase()) return;
      setWalletAddress(next);
      loadWallet(next);
    };
    window.ethereum.on('accountsChanged', handler);
    return () => window.ethereum.removeListener?.('accountsChanged', handler);
  }, [disconnectWallet, loadWallet]);

  useEffect(() => {
    if (selectedTokenId == null) {
      setAnimData(null);
      return;
    }
    setTokenInput(String(selectedTokenId));
    let cancelled = false;
    setAnimLoading(true);
    setError(null);
    fetch(`/api/parcel/${selectedTokenId}/animdata`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (cancelled) return;
        if (!ok) throw new Error(j.error || 'failed to load parcel');
        setAnimData(j);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setAnimLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTokenId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const next = new URLSearchParams(window.location.search);
    SEARCH_PARAM_KEYS.forEach((k) => next.delete(k));
    if (selectedTokenId != null) next.set('token', String(selectedTokenId));
    next.set('seed', params.seed);
    if (params.variance !== DEFAULTS.variance) next.set('variance', String(params.variance));
    if (params.peakHeight !== DEFAULTS.peakHeight) next.set('peak', String(params.peakHeight));
    if (params.startValue !== DEFAULTS.startValue) next.set('start', String(params.startValue));
    if (params.rotationalOrder !== DEFAULTS.rotationalOrder)
      next.set('order', String(params.rotationalOrder));
    const qs = next.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', url);
  }, [params, selectedTokenId]);

  return (
    <div className="content-wrapper">
      <Header
        walletAddress={walletAddress}
        onConnect={connectWallet}
        onDisconnect={disconnectWallet}
      />

      <main className="px-6 flex-1">
        {error && (
          <p className="text-sm mb-4" style={{ color: '#f87171' }}>
            {error}
          </p>
        )}

        <div className="max-w-2xl">
          <h1 className="text-2xl mb-4">heightmap mandala generator</h1>
          <p className="text-sm opacity-75 mb-3">
            Generates mandala-style heightmaps for terraform parcels. Input variables can be
            flexed to alter the resulting mandala animation. Those familiar with etherscan can
            export the heightmap and commit it to a parcel using the tool at the bottom of the
            page.
          </p>
          <p className="text-xs opacity-55 mb-6">
            v1 is preview-only. The encoded uint256[16] array is exposed for power users who want
            to commit via etherscan today. Wallet-connected commit/erase ships in v2.
          </p>

          <div className="flex flex-col gap-2 mb-2">
            <label className="text-xs opacity-60 uppercase tracking-wider">input parcel id</label>
            <form
              onSubmit={(e) => { e.preventDefault(); submitTokenId(); }}
              className="flex gap-2 items-center"
            >
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={11104}
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="1 – 11104"
                className="flex-1 max-w-xs"
              />
              <button type="submit" className="btn-primary btn-sm">
                load parcel
              </button>
            </form>
          </div>
        </div>

        {walletAddress && (
          <section className="mt-8">
            <h2 className="text-lg mb-2 opacity-80">[your parcels]</h2>
            <ParcelGrid
              parcels={parcels}
              selectedTokenId={selectedTokenId}
              onSelect={setSelectedTokenId}
              loading={parcelsLoading}
              address={walletAddress}
            />
          </section>
        )}

        {selectedTokenId != null && (
          <section className="mt-10 pt-6 border-t border-current border-opacity-10">
            {animLoading && !animData && (
              <p className="text-sm opacity-70">[loading parcel animation data…]</p>
            )}
            {animData && (
              <MandalaDesigner
                animData={animData}
                params={params}
                onParamsChange={setParams}
              />
            )}
          </section>
        )}
      </main>

      <Footer />
    </div>
  );
}

function paramsFromUrl(searchParams) {
  if (!searchParams) return null;
  const seed = searchParams.get('seed');
  if (!seed) return null;
  const num = (k, lo, hi, fallback) => {
    const v = Number(searchParams.get(k));
    return Number.isInteger(v) && v >= lo && v <= hi ? v : fallback;
  };
  return {
    seed,
    variance: num('variance', 1, 4, DEFAULTS.variance),
    peakHeight: num('peak', 1, 9, DEFAULTS.peakHeight),
    startValue: num('start', 0, 9, DEFAULTS.startValue),
    rotationalOrder: searchParams.get('order') === '8' ? 8 : 4,
  };
}
