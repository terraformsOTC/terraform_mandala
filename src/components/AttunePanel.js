'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CommitError } from '@/lib/commitShared';
import { TOKEN_URI_V1_ADDRESS, TOKEN_URI_V2_ADDRESS } from '@/lib/addresses';

// /attune (James, 2026-11-25): set a parcel's attunement, the whole number its owner
// can store on Terraforms' v2 metadata contract and, since 2026-11-26, separately on
// the v1 one. The page is unlinked on purpose. Its one write is lib/commit.js's
// sendAttune, behind the same stages as the commit panel: checks with a visible
// checklist, a confirmation that spells out the call, the wallet signature, then a
// read-back of the stored number and its event.

// commit.js brings ethers with it; it loads on the first read or check.
const loadCommit = () => import('@/lib/commit');

const ETHERSCAN_TX = (hash) => `https://etherscan.io/tx/${hash}`;
const BOX = { border: '1px solid rgba(232,232,232,0.15)' };
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const VERSIONS = ['v2', 'v1'];
const CONTRACTS = {
  v2: {
    address: TOKEN_URI_V2_ADDRESS,
    name: 'TerraformsTokenURI_v2',
    note: "Terraforms' current metadata contract, which 2,660 parcels draw with. Mathcastles can upgrade it at any time.",
  },
  v1: {
    address: TOKEN_URI_V1_ADDRESS,
    name: 'TerraformsTokenURI_v1',
    note: "The older v1 metadata contract keeps its own store, apart from v2's. Any parcel can have a number there, whichever renderer it draws with (6 parcels draw with v1). v1's code can be upgraded only until 24 Dec 2026, 00:11:47 UTC; after that v1 can never draw the number, but it stays on-chain for anything to read.",
  },
};

const PRESETS = [
  ['42', 'the answer to life, the universe and everything'],
  ['0', 'homeostasis, the default: logs the event and changes nothing'],
  ['113', 'for the artist, 0x113d'],
  ['9911', 'one for every minted parcel'],
  ['11104', 'one for every slot in the castle'],
  ['-1', 'one step retrograde'],
];

const meaning = (v) => (v === 0n ? 'homeostasis' : v > 0n ? 'activated' : 'retrograde');
const described = (v) => (typeof v === 'bigint' ? `${v} (${meaning(v)})` : '?');
const isWhole = (s) => /^-?\d+$/.test(String(s).trim());

export default function AttunePanel() {
  const [wallet, setWallet] = useState(null);
  const [parcels, setParcels] = useState(null);
  const [tokenInput, setTokenInput] = useState('');
  const [currents, setCurrents] = useState(null); // { v2, v1 } (bigint or null each), 'loading' or null
  const [version, setVersion] = useState('v2');
  const [value, setValue] = useState('42');
  const [stage, setStage] = useState('idle'); // idle | checking | confirm | signing | pending | done | error
  const [steps, setSteps] = useState([]);
  const [prepared, setPrepared] = useState(null);
  const [txHash, setTxHash] = useState(null);
  const [message, setMessage] = useState(null);
  const [walletError, setWalletError] = useState(null);
  const runId = useRef(0);
  const walletRef = useRef(null);
  walletRef.current = wallet;

  const tokenId = /^\d+$/.test(tokenInput) && Number(tokenInput) >= 1 && Number(tokenInput) <= 9911 ? Number(tokenInput) : null;

  const loadParcels = useCallback(async (address) => {
    setParcels(null);
    try {
      const res = await fetch(`/api/wallet/${address}`);
      const body = await res.json();
      if (walletRef.current?.toLowerCase() !== address.toLowerCase()) return;
      setParcels(res.ok ? body.parcels : []);
    } catch {
      setParcels([]);
    }
  }, []);

  const connectWallet = useCallback(async () => {
    if (typeof window === 'undefined' || typeof window.ethereum === 'undefined') {
      setWalletError('No wallet detected. Install MetaMask or another Web3 wallet.');
      return;
    }
    try {
      const chainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (chainId !== '0x1') {
        setWalletError('Switch your wallet to Ethereum mainnet, then reconnect.');
        return;
      }
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      setWallet(accounts[0]);
      setWalletError(null);
      loadParcels(accounts[0]);
    } catch (err) {
      if (err?.code !== 4001) setWalletError(err?.message || 'wallet connection failed');
    }
  }, [loadParcels]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.ethereum?.on) return undefined;
    const onAccountsChanged = (accounts) => {
      const next = accounts?.[0] ?? null;
      setWallet(next);
      setParcels(null);
      if (next) loadParcels(next);
    };
    const onChainChanged = (chainId) => {
      if (chainId !== '0x1') {
        setWallet(null);
        setParcels(null);
        setWalletError('Wallet switched off Ethereum mainnet — disconnected. Switch back, then reconnect.');
      }
    };
    window.ethereum.on('accountsChanged', onAccountsChanged);
    window.ethereum.on('chainChanged', onChainChanged);
    return () => {
      window.ethereum.removeListener?.('accountsChanged', onAccountsChanged);
      window.ethereum.removeListener?.('chainChanged', onChainChanged);
    };
  }, [loadParcels]);

  // Any change to the parcel, the contract, the number or the wallet drops a prepared transaction.
  useEffect(() => {
    runId.current += 1;
    setStage('idle');
    setSteps([]);
    setPrepared(null);
    setTxHash(null);
    setMessage(null);
  }, [tokenInput, version, value, wallet]);

  // The parcel's stored attunement on both contracts, read through the wallet's connection.
  useEffect(() => {
    if (!wallet || tokenId == null) {
      setCurrents(null);
      return undefined;
    }
    let live = true;
    setCurrents('loading');
    loadCommit()
      .then(({ readAttunement }) => Promise.all(VERSIONS.map((v) => readAttunement(tokenId, { version: v }).catch(() => null))))
      .then(([v2, v1]) => { if (live) setCurrents({ v2, v1 }); })
      .catch(() => { if (live) setCurrents(null); });
    return () => { live = false; };
  }, [wallet, tokenId]);

  const fail = (err) => {
    setStage('error');
    setMessage(err instanceof CommitError ? err.message : err?.shortMessage || err?.message || String(err));
  };

  const runChecks = async () => {
    const run = ++runId.current;
    const live = () => run === runId.current;
    setStage('checking');
    setSteps([]);
    setMessage(null);
    setTxHash(null);
    try {
      const { prepareAttune } = await loadCommit();
      const result = await prepareAttune({
        tokenId, value, account: wallet, version, onStep: (label) => { if (live()) setSteps((s) => [...s, label]); },
      });
      if (!live()) return;
      setPrepared(result);
      setStage('confirm');
    } catch (err) {
      if (live()) fail(err);
    }
  };

  const confirm = async () => {
    setStage('signing');
    try {
      const { sendAttune, verifyAttune } = await loadCommit();
      const tx = await sendAttune(prepared, wallet);
      setTxHash(tx.hash);
      setStage('pending');
      const receipt = await tx.wait();
      if (receipt.status !== 1) throw new CommitError('The transaction was mined but reverted. Nothing changed.');
      setMessage(`Mined in block ${receipt.blockNumber}. Checking the result on-chain…`);
      setStage('done');
      try {
        const check = await verifyAttune(prepared, receipt);
        if (check.ok) setCurrents((c) => (c && c !== 'loading' ? { ...c, [prepared.version]: check.stored } : c));
        setMessage(
          check.ok
            ? `Attuned. Parcel #${prepared.tokenId}'s ${prepared.version} attunement is now ${check.stored} (${meaning(check.stored)}), and the contract logged AttunementSet.`
            : `The transaction succeeded, but the read-back found ${check.stored}${check.logged ? '' : ' and no AttunementSet event'}. Check it on Etherscan.`,
        );
      } catch (err) {
        setMessage(`The transaction succeeded (block ${receipt.blockNumber}), but the site could not double-check the result through your wallet's connection (${err?.shortMessage || err?.message || err}). Check it on Etherscan.`);
      }
    } catch (err) {
      if (err?.code === 'ACTION_REJECTED' || err?.code === 4001 || err?.info?.error?.code === 4001) {
        setStage('confirm');
        return;
      }
      fail(err);
    }
  };

  const checklist = (done) => (
    <ul className="flex flex-col gap-0.5 mt-2">
      {steps.map((label, i) => {
        const last = i === steps.length - 1;
        const mark = done || !last ? '✓' : stage === 'error' ? '✗' : '…';
        return (
          <li key={label} className={mark === '✗' ? '' : 'opacity-80'} style={mark === '✗' ? { color: '#f87171' } : undefined}>
            [{mark}] {label}
          </li>
        );
      })}
    </ul>
  );

  const busy = stage === 'checking' || stage === 'signing' || stage === 'pending';
  const contract = CONTRACTS[prepared?.version ?? version];

  return (
    <div className="max-w-2xl flex flex-col gap-6 pb-12">
      <div>
        <h1 className="text-2xl mb-4">attune</h1>
        <div className="text-sm opacity-75 leading-relaxed flex flex-col gap-3">
          <p>
            Every Terraforms parcel has an attunement: a whole number its owner can store at any time on
            the v2 metadata contract, and separately on the older v1 one. Mathcastles&apos; own comment
            says 0 is homeostasis, positive is activated, and negative is retrograde or deactivated.
          </p>
          <p>
            Nothing draws it yet: both renderers write 0 into every parcel&apos;s script, whatever is
            stored. Only a parcel&apos;s owner can set it (not its dreamer), and the number stays with
            the parcel when it is sold.
          </p>
        </div>
      </div>

      {!wallet ? (
        <div className="flex flex-col gap-2 text-sm">
          <button type="button" className="btn-primary btn-sm text-sm self-start" onClick={connectWallet}>
            [connect wallet]
          </button>
          {walletError && <p style={{ color: '#f87171' }}>{walletError}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          <p className="opacity-75">connected {short(wallet)}</p>
          {parcels == null ? (
            <p className="opacity-60">reading your parcels…</p>
          ) : parcels.length === 0 ? (
            <p className="opacity-60">This wallet holds no parcels. Type a parcel number to read its attunement.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {parcels.map((p) => (
                <button
                  key={p.tokenId}
                  type="button"
                  className="btn-primary btn-sm text-xs"
                  style={{ opacity: tokenId === p.tokenId ? 1 : 0.6 }}
                  onClick={() => setTokenInput(String(p.tokenId))}
                >
                  #{p.tokenId}{p.statusLabel ? ` · ${p.statusLabel}` : ''}
                </button>
              ))}
            </div>
          )}
          <label className="flex items-center gap-2 mt-2">
            <span className="opacity-60">parcel #</span>
            <input
              className="bg-transparent px-2 py-1 w-24"
              style={BOX}
              inputMode="numeric"
              aria-label="parcel number"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value.replace(/[^\d]/g, ''))}
            />
            {tokenId != null && (
              <span className="opacity-75">
                {currents === 'loading'
                  ? 'reading its attunement…'
                  : currents
                    ? `attunement now v2: ${described(currents.v2)} · v1: ${described(currents.v1)}`
                    : ''}
              </span>
            )}
          </label>
        </div>
      )}

      {wallet && tokenId != null && (
        <div className="flex flex-col gap-2 text-xs p-3" style={BOX}>
          <span className="opacity-60 uppercase tracking-wider">set the attunement</span>
          <div className="flex items-center gap-2">
            <span className="opacity-60">contract</span>
            {VERSIONS.map((v) => (
              <button
                key={v}
                type="button"
                className="btn-primary btn-sm text-xs"
                style={{ opacity: version === v ? 1 : 0.6 }}
                aria-pressed={version === v}
                disabled={busy}
                onClick={() => setVersion(v)}
              >
                {v}
              </button>
            ))}
          </div>
          <p className="opacity-60 leading-relaxed">{CONTRACTS[version].note}</p>
          <label className="flex items-center gap-2">
            <span className="opacity-60">number</span>
            <input
              className="bg-transparent px-2 py-1 w-40 text-sm"
              style={BOX}
              aria-label="attunement"
              value={value}
              onChange={(e) => setValue(e.target.value.trim())}
            />
            {!isWhole(value) && <span style={{ color: '#fbbf24' }}>a whole number, like 42 or -1</span>}
          </label>
          <ul className="flex flex-col gap-1 mt-1">
            {PRESETS.map(([v, note]) => (
              <li key={v} className="flex items-baseline gap-2">
                <button type="button" className="btn-primary btn-sm text-xs" style={{ opacity: value === v ? 1 : 0.6 }} onClick={() => setValue(v)}>
                  {v}
                </button>
                <span className="opacity-60">{note}</span>
              </li>
            ))}
          </ul>
          {value.startsWith('-') && (
            <p className="opacity-75 leading-relaxed" style={{ color: '#fbbf24' }}>
              A negative number is the one kind the v1 and v2 scripts read differently: on a dreamed Flow
              parcel in the Alto, Holo or Radiant zones it keeps the glyphs flowing instead of stepping.
              Today both renderers pass 0, so nothing changes yet.
            </p>
          )}

          {stage === 'idle' && (
            <button type="button" className="btn-primary btn-sm text-xs self-start mt-1" disabled={!isWhole(value) || busy} onClick={runChecks}>
              [check & attune #{tokenId} on {version}]
            </button>
          )}

          {(stage === 'checking' || stage === 'error') && checklist(false)}

          {stage === 'error' && (
            <>
              <p style={{ color: '#f87171' }} className="leading-relaxed">{message}</p>
              <button type="button" className="btn-primary btn-sm text-xs self-start" onClick={runChecks}>
                [run checks again]
              </button>
            </>
          )}

          {(stage === 'confirm' || stage === 'signing') && prepared && (
            <>
              {checklist(true)}
              <div className="mt-2 p-2 leading-relaxed" style={BOX}>
                <p>
                  Parcel #{prepared.tokenId}&apos;s {prepared.version} attunement goes from <strong>{String(prepared.current)}</strong> to{' '}
                  <strong>{String(prepared.attunement)}</strong> ({meaning(prepared.attunement)}).
                </p>
                <p className="opacity-75 mt-1">
                  That one stored number is all that changes{prepared.current === prepared.attunement ? ' (here it stays the same; the transaction still logs the event)' : ''}.
                  No ETH is sent. Estimated gas: {prepared.gas.toString()} units, paid by you.
                </p>
                <p className="opacity-50 mt-1 break-all">
                  {contract.name}.setAttunement({prepared.tokenId}, {String(prepared.attunement)}) — contract {short(contract.address)}
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-primary btn-sm text-xs" onClick={confirm} disabled={stage === 'signing'}>
                  {stage === 'signing' ? '[confirm in your wallet…]' : '[confirm & sign]'}
                </button>
                <button
                  type="button"
                  className="btn-primary btn-sm text-xs"
                  style={{ opacity: 0.6 }}
                  onClick={() => setStage('idle')}
                  disabled={stage === 'signing'}
                >
                  [cancel]
                </button>
              </div>
            </>
          )}

          {stage === 'pending' && (
            <p className="opacity-80 leading-relaxed">
              Transaction sent, waiting for it to be mined…{' '}
              <a href={ETHERSCAN_TX(txHash)} target="_blank" rel="noopener noreferrer">[etherscan ↗]</a>
            </p>
          )}

          {stage === 'done' && (
            <p className="leading-relaxed">
              {message}{' '}
              <a href={ETHERSCAN_TX(txHash)} target="_blank" rel="noopener noreferrer">[etherscan ↗]</a>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
