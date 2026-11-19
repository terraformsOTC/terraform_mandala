'use client';

import { useEffect, useRef, useState } from 'react';
import { CommitError, STATUS_NAMES } from '@/lib/commitShared';
import { TERRAFORMS_ADDRESS } from '@/lib/addresses';

// commit.js brings ethers with it, which most visitors never need. It loads on
// the first [check & commit] click; by the time the user confirms it is cached.
const loadCommit = () => import('@/lib/commit');

const ETHERSCAN_TX = (hash) => `https://etherscan.io/tx/${hash}`;
const BOX = { border: '1px solid rgba(232,232,232,0.15)' };
const SHORT_ADDRESS = `${TERRAFORMS_ADDRESS.slice(0, 6)}…${TERRAFORMS_ADDRESS.slice(-4)}`;

/**
 * Commit the current mandala to the selected parcel. Each stage is explicit:
 * checks (with a visible checklist), a confirmation that spells out what will
 * change, the wallet signature, then a read-back of what the chain stored.
 *
 * The parcel must render with the renderer of the preview (`renderer`, v0 or v2),
 * so the mandala looks on-chain as it did here. If it doesn't, the panel offers the
 * preview in the parcel's own renderer (`onRendererChange`) and the switch to the
 * preview's renderer — the migration to v2 or, since 2026-11-17, the switch back to
 * v0: its own transaction with the same stages (mode 'migrate', target `switchTo`);
 * the commit checks then run again, and `onParcelRendererChange` reports the
 * parcel's new renderer. A parcel that is already terraformed is offered the return
 * to daydream mode the same way (mode 'dream'), so its owner can replace the old
 * drawing without going to Etherscan.
 */
export default function CommitPanel({ tokenId, heightmap, walletAddress, renderer, onRendererChange, onParcelRendererChange, onCommitted, note, blocked = null }) {
  const [stage, setStage] = useState('idle'); // idle | checking | confirm | signing | pending | done | error
  // Whether an error came from the pre-send checks or from sending; only the
  // former marks a checklist step as failed.
  const [failedInChecks, setFailedInChecks] = useState(true);
  const [mode, setMode] = useState('commit'); // commit | migrate | dream
  const [switchTo, setSwitchTo] = useState(null); // the target in mode 'migrate': 'v2' | 'v0'
  const [migrateTo, setMigrateTo] = useState(null); // offered after a failed check: 'v2' | 'v0' | null
  const [needsDream, setNeedsDream] = useState(false);
  const [showRenderer, setShowRenderer] = useState(null);
  const [steps, setSteps] = useState([]);
  const [prepared, setPrepared] = useState(null);
  const [txHash, setTxHash] = useState(null);
  const [message, setMessage] = useState(null);
  // Bumped by every reset and every run of the checks, so a run that finishes after
  // the parcel, heightmap or preview renderer changed is dropped, not shown as ready.
  const runId = useRef(0);

  // Any change to what would be committed, or to the renderer it was previewed
  // with, invalidates a prepared commit.
  useEffect(() => {
    runId.current += 1;
    setStage('idle');
    setMode('commit');
    setSwitchTo(null);
    setMigrateTo(null);
    setNeedsDream(false);
    setShowRenderer(null);
    setSteps([]);
    setPrepared(null);
    setTxHash(null);
    setMessage(null);
  }, [tokenId, heightmap, walletAddress, renderer]);

  if (!walletAddress || !heightmap || tokenId == null || tokenId > 9911) return null;

  const fail = (err, inChecks = true) => {
    setFailedInChecks(inChecks);
    setStage('error');
    setMigrateTo(err?.migrateTo === 'v0' || err?.migrateTo === 'v2' ? err.migrateTo : null);
    setNeedsDream(Boolean(err?.needsDream));
    setShowRenderer(err?.showRenderer ?? null);
    setMessage(err instanceof CommitError ? err.message : err?.shortMessage || err?.message || String(err));
  };

  // `to` is the target renderer of a switch (mode 'migrate'): 'v2' or 'v0'.
  const runChecks = async (nextMode = 'commit', to = null) => {
    const run = ++runId.current;
    const current = () => run === runId.current;
    setMode(nextMode);
    setSwitchTo(nextMode === 'migrate' ? to : null);
    setMigrateTo(null);
    setNeedsDream(false);
    setShowRenderer(null);
    setStage('checking');
    setSteps([]);
    setMessage(null);
    setTxHash(null);
    const onStep = (label) => { if (current()) setSteps((s) => [...s, label]); };
    try {
      const { prepareMigrate, prepareDream, prepareCommit } = await loadCommit();
      const result = nextMode === 'migrate'
        ? await prepareMigrate({ tokenId, account: walletAddress, to, onStep })
        : nextMode === 'dream'
          ? await prepareDream({ tokenId, account: walletAddress, onStep })
          : await prepareCommit({ tokenId, heightmap, account: walletAddress, renderer, onStep });
      if (!current()) return;
      setPrepared(result);
      setStage('confirm');
    } catch (err) {
      if (current()) fail(err);
    }
  };

  const confirm = async () => {
    setStage('signing');
    try {
      const { sendMigrate, sendDream, sendCommit, verifyMigrate, verifyDream, verifyCommit } = await loadCommit();
      const tx = mode === 'migrate'
        ? await sendMigrate(prepared, walletAddress)
        : mode === 'dream'
          ? await sendDream(prepared, walletAddress)
          : await sendCommit(prepared, walletAddress);
      setTxHash(tx.hash);
      setStage('pending');
      const receipt = await tx.wait();
      if (receipt.status !== 1) throw new CommitError('The transaction was mined but reverted. Nothing changed on the parcel.');
      // The transaction is in. From here a failure is in double-checking it, not
      // in the transaction itself, and is reported that way.
      setMessage(`Mined in block ${receipt.blockNumber}. Checking the result on-chain…`);
      setStage('done');
      try {
        if (mode === 'migrate') {
          const to = prepared.to;
          const check = await verifyMigrate(prepared, receipt.blockNumber);
          if (check.ok) onParcelRendererChange?.(to);
          setMessage(
            check.ok
              ? `${to === 'v0' ? 'Switched' : 'Migrated'}. Parcel #${tokenId} now renders with ${to} on-chain.${check.htmlCheck === 'mismatch' ? ` (The parcel's HTML did not match the ${to} renderer's output on a second check — worth a look on Etherscan.)` : ''} Sites that cache artwork (OpenSea, tokens.mathcastles.xyz) can keep showing the old version until they refresh; on OpenSea use "Refresh metadata".`
              : `The transaction succeeded, but the stored renderer for #${tokenId} reads ${check.index}, not ${to}. Check the parcel on Etherscan.`,
          );
          return;
        }
        if (mode === 'dream') {
          const check = await verifyDream(prepared, receipt.blockNumber);
          setMessage(
            check.ok
              ? `Parcel #${tokenId} is back in ${STATUS_NAMES[check.status]} mode and shows a blank canvas until you commit the mandala.`
              : `The transaction succeeded, but parcel #${tokenId} reads ${STATUS_NAMES[check.status] ?? `status ${check.status}`}, not ${STATUS_NAMES[prepared.newStatus]}. Check the parcel on Etherscan.`,
          );
          return;
        }
        onCommitted?.({ txHash: tx.hash, tokenId, heightmap, blockNumber: receipt.blockNumber });
        const check = await verifyCommit(prepared, receipt.blockNumber);
        setMessage(
          check.ok
            ? `Committed. Parcel #${tokenId} is now ${STATUS_NAMES[check.status]} and the chain holds exactly this heightmap.`
            : `The transaction succeeded, but the read-back did not match (status ${STATUS_NAMES[check.status]}, canvas ${check.canvasOk ? 'matches' : 'differs'}). Check the parcel on Etherscan.`,
        );
      } catch (err) {
        setMessage(
          `The transaction succeeded (block ${receipt.blockNumber}), but the site could not double-check the result through your wallet's connection (${err?.shortMessage || err?.message || err}). Check it on Etherscan.`,
        );
      }
    } catch (err) {
      // 4001 / ACTION_REJECTED: the user declined in their wallet.
      if (err?.code === 'ACTION_REJECTED' || err?.code === 4001 || err?.info?.error?.code === 4001) {
        setStage('confirm');
        return;
      }
      fail(err, false);
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

  return (
    <div className="flex flex-col gap-2 text-xs p-3" style={BOX}>
      <span className="opacity-60 uppercase tracking-wider">
        {mode === 'migrate' ? (switchTo === 'v0' ? 'switch to v0' : 'migrate to v2') : mode === 'dream' ? 'return to daydream' : 'commit on-chain'}
      </span>

      {stage === 'idle' && (
        <>
          <p className="opacity-75 leading-relaxed">
            Write this mandala to parcel #{tokenId} from your wallet. The site checks everything
            before you sign; nothing is sent until you confirm.
          </p>
          {blocked && <p className="opacity-75 leading-relaxed" style={{ color: '#fbbf24' }}>{blocked}</p>}
          <button type="button" className="btn-primary btn-sm text-xs self-start" disabled={!!blocked} onClick={() => runChecks('commit')}>
            [check & commit to #{tokenId}]
          </button>
        </>
      )}

      {(stage === 'checking' || stage === 'error') && checklist(stage === 'error' && !failedInChecks)}

      {stage === 'error' && (
        <>
          <p style={{ color: '#f87171' }} className="leading-relaxed">{message}</p>
          {showRenderer && onRendererChange && (
            <button type="button" className="btn-primary btn-sm text-xs self-start" onClick={() => onRendererChange(showRenderer)}>
              [show the {showRenderer} preview]
            </button>
          )}
          {migrateTo ? (
            <>
              <p className="opacity-75 leading-relaxed">
                {migrateTo === 'v0'
                  ? 'Switching changes only which on-chain renderer draws the parcel: v0, the original one. It is a separate transaction, it can be switched back to v2, and nothing else about the parcel changes.'
                  : 'Migrating changes only which on-chain renderer draws the parcel. It is a separate transaction, it can be switched back, and nothing else about the parcel changes.'}
              </p>
              <button type="button" className="btn-primary btn-sm text-xs self-start" onClick={() => runChecks('migrate', migrateTo)}>
                {migrateTo === 'v0' ? `[switch #${tokenId} to v0]` : `[migrate #${tokenId} to v2]`}
              </button>
            </>
          ) : showRenderer ? null : needsDream ? (
            <>
              <p className="opacity-75 leading-relaxed">
                Returning to daydream is a separate transaction from your wallet that makes the parcel
                ready for a new heightmap. Its current drawing stops showing: the parcel is a blank
                daydream until you commit the new one. Then the site runs the commit checks again.
              </p>
              <button type="button" className="btn-primary btn-sm text-xs self-start" onClick={() => runChecks('dream')}>
                [return #{tokenId} to daydream]
              </button>
            </>
          ) : (
            <button type="button" className="btn-primary btn-sm text-xs self-start" onClick={() => runChecks(mode, switchTo)}>
              [run checks again]
            </button>
          )}
        </>
      )}

      {(stage === 'confirm' || stage === 'signing') && prepared && (
        <>
          {checklist(true)}
          {mode === 'migrate' ? (
            <div className="mt-2 p-2 leading-relaxed" style={BOX}>
              <p>
                Parcel #{prepared.tokenId} switches from the <strong>{prepared.fromName}</strong> renderer
                to <strong>{prepared.to}</strong>. Its heightmap, mode and everything else stay as they are.
              </p>
              {prepared.to === 'v0' && (
                <p className="opacity-75 mt-1">
                  v0 is the original renderer and predates antennas: if this parcel&apos;s antenna is on, it
                  stops showing, and leaves its traits, while the parcel is on v0. Switching back to v2
                  brings it back.
                </p>
              )}
              <p className="opacity-75 mt-1">
                Estimated gas: {prepared.gas.toString()} units, paid by you.
              </p>
              <p className="opacity-50 mt-1 break-all">
                Terraforms.setTokenURIAddress([{prepared.tokenId}], {String(prepared.index)}) — contract {SHORT_ADDRESS}
              </p>
            </div>
          ) : mode === 'dream' ? (
            <div className="mt-2 p-2 leading-relaxed" style={BOX}>
              <p>
                Parcel #{prepared.tokenId} goes from <strong>{STATUS_NAMES[prepared.status]}</strong> back to{' '}
                <strong>{STATUS_NAMES[prepared.newStatus]}</strong>, ready for a new heightmap.
              </p>
              <p className="opacity-75 mt-1">
                The current drawing stops showing: the parcel is a blank daydream, and marketplaces list it
                as {STATUS_NAMES[prepared.newStatus]}, until you commit again, which is a second transaction.
                Estimated gas: {prepared.gas.toString()} units, paid by you.
              </p>
              <p className="opacity-50 mt-1 break-all">
                Terraforms.enterDream({prepared.tokenId}) — contract {SHORT_ADDRESS}
              </p>
            </div>
          ) : (
            <div className="mt-2 p-2 leading-relaxed" style={BOX}>
              <p>
                Parcel #{prepared.tokenId} goes from <strong>{STATUS_NAMES[prepared.status]}</strong> to{' '}
                <strong>{STATUS_NAMES[prepared.newStatus]}</strong> and shows this heightmap, drawn by
                its <strong>{prepared.renderer}</strong> renderer as in the preview.
              </p>
              <p className="opacity-75 mt-1">
                It stays that way unless the parcel enters daydream mode again and a new heightmap is
                committed. Estimated gas: {prepared.gas.toString()} units, paid by you.
              </p>
              {note && <p className="mt-1" style={{ color: '#fbbf24' }}>{note}</p>}
              <p className="opacity-50 mt-1 break-all">
                Terraforms.commitDreamToCanvas({prepared.tokenId}, uint256[16]) — contract {SHORT_ADDRESS}
              </p>
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary btn-sm text-xs"
              onClick={confirm}
              disabled={stage === 'signing'}
            >
              {stage === 'signing' ? '[confirm in your wallet…]' : '[confirm & sign]'}
            </button>
            <button
              type="button"
              className="btn-primary btn-sm text-xs"
              style={{ opacity: 0.6 }}
              onClick={() => { setStage('idle'); setMode('commit'); setSwitchTo(null); }}
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
        <>
          <p className="leading-relaxed">
            {message}{' '}
            <a href={ETHERSCAN_TX(txHash)} target="_blank" rel="noopener noreferrer">[etherscan ↗]</a>
          </p>
          {(mode === 'migrate' || mode === 'dream') && !message?.startsWith('Mined in block') && (
            <button type="button" className="btn-primary btn-sm text-xs self-start" onClick={() => runChecks('commit')}>
              [continue to commit checks]
            </button>
          )}
        </>
      )}
    </div>
  );
}
