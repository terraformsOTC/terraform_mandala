'use client';

import { useEffect, useState } from 'react';
import {
  CommitError, STATUS_NAMES, prepareCommit, sendCommit, verifyCommit,
  prepareMigrate, sendMigrate, verifyMigrate,
} from '@/lib/commit';
import { TERRAFORMS_ADDRESS } from '@/lib/contract';

const ETHERSCAN_TX = (hash) => `https://etherscan.io/tx/${hash}`;
const BOX = { border: '1px solid rgba(232,232,232,0.15)' };
const SHORT_ADDRESS = `${TERRAFORMS_ADDRESS.slice(0, 6)}…${TERRAFORMS_ADDRESS.slice(-4)}`;

/**
 * Commit the current mandala to the selected parcel. Each stage is explicit:
 * checks (with a visible checklist), a confirmation that spells out what will
 * change, the wallet signature, then a read-back of what the chain stored.
 *
 * A parcel still on the v0 renderer is offered the migration to v2 first, as
 * its own transaction with the same stages (mode 'migrate'); the commit checks
 * then run again.
 */
export default function CommitPanel({ tokenId, heightmap, walletAddress }) {
  const [stage, setStage] = useState('idle'); // idle | checking | confirm | signing | pending | done | error
  const [mode, setMode] = useState('commit'); // commit | migrate
  const [needsV2, setNeedsV2] = useState(false);
  const [steps, setSteps] = useState([]);
  const [prepared, setPrepared] = useState(null);
  const [txHash, setTxHash] = useState(null);
  const [message, setMessage] = useState(null);

  // Any change to what would be committed invalidates a prepared commit.
  useEffect(() => {
    setStage('idle');
    setMode('commit');
    setNeedsV2(false);
    setSteps([]);
    setPrepared(null);
    setTxHash(null);
    setMessage(null);
  }, [tokenId, heightmap, walletAddress]);

  if (!walletAddress || !heightmap || tokenId == null || tokenId > 9911) return null;

  const fail = (err) => {
    setStage('error');
    setNeedsV2(Boolean(err?.needsV2));
    setMessage(err instanceof CommitError ? err.message : err?.shortMessage || err?.message || String(err));
  };

  const runChecks = async (nextMode = 'commit') => {
    setMode(nextMode);
    setNeedsV2(false);
    setStage('checking');
    setSteps([]);
    setMessage(null);
    setTxHash(null);
    const onStep = (label) => setSteps((s) => [...s, label]);
    try {
      const result = nextMode === 'migrate'
        ? await prepareMigrate({ tokenId, account: walletAddress, onStep })
        : await prepareCommit({ tokenId, heightmap, account: walletAddress, onStep });
      setPrepared(result);
      setStage('confirm');
    } catch (err) {
      fail(err);
    }
  };

  const confirm = async () => {
    setStage('signing');
    try {
      const tx = mode === 'migrate'
        ? await sendMigrate(prepared, walletAddress)
        : await sendCommit(prepared, walletAddress);
      setTxHash(tx.hash);
      setStage('pending');
      const receipt = await tx.wait();
      if (receipt.status !== 1) throw new CommitError('The transaction was mined but reverted. Nothing changed on the parcel.');
      if (mode === 'migrate') {
        const check = await verifyMigrate(prepared);
        setStage('done');
        setMessage(
          check.ok
            ? `Migrated. Parcel #${tokenId} now renders with v2.`
            : `The transaction succeeded, but the read-back did not confirm v2 (renderer index ${check.index}). Check the parcel on Etherscan.`,
        );
        return;
      }
      const check = await verifyCommit(prepared);
      setStage('done');
      setMessage(
        check.ok
          ? `Committed. Parcel #${tokenId} is now ${STATUS_NAMES[check.status]} and the chain holds exactly this heightmap.`
          : `The transaction succeeded, but the read-back did not match (status ${STATUS_NAMES[check.status]}, canvas ${check.canvasOk ? 'matches' : 'differs'}). Check the parcel on Etherscan.`,
      );
    } catch (err) {
      // 4001 / ACTION_REJECTED: the user declined in their wallet.
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

  return (
    <div className="flex flex-col gap-2 text-xs p-3" style={BOX}>
      <span className="opacity-60 uppercase tracking-wider">
        {mode === 'migrate' ? 'migrate to v2' : 'commit on-chain'}
      </span>

      {stage === 'idle' && (
        <>
          <p className="opacity-75 leading-relaxed">
            Write this mandala to parcel #{tokenId} from your wallet. The site checks everything
            before you sign; nothing is sent until you confirm.
          </p>
          <button type="button" className="btn-primary btn-sm text-xs self-start" onClick={() => runChecks('commit')}>
            [check & commit to #{tokenId}]
          </button>
        </>
      )}

      {(stage === 'checking' || stage === 'error') && checklist(false)}

      {stage === 'error' && (
        <>
          <p style={{ color: '#f87171' }} className="leading-relaxed">{message}</p>
          {needsV2 ? (
            <>
              <p className="opacity-75 leading-relaxed">
                Migrating changes only which on-chain renderer draws the parcel. It is a separate
                transaction, it can be switched back, and nothing else about the parcel changes.
              </p>
              <button type="button" className="btn-primary btn-sm text-xs self-start" onClick={() => runChecks('migrate')}>
                [migrate #{tokenId} to v2]
              </button>
            </>
          ) : (
            <button type="button" className="btn-primary btn-sm text-xs self-start" onClick={() => runChecks(mode)}>
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
                Parcel #{prepared.tokenId} switches from the <strong>v{prepared.from === 1n ? '1' : '0'}</strong> renderer
                to <strong>v2</strong>. Its heightmap, mode and everything else stay as they are.
              </p>
              <p className="opacity-75 mt-1">
                Estimated gas: {prepared.gas.toString()} units, paid by you.
              </p>
              <p className="opacity-50 mt-1 break-all">
                Terraforms.setTokenURIAddress([{prepared.tokenId}], 2) — contract {SHORT_ADDRESS}
              </p>
            </div>
          ) : (
            <div className="mt-2 p-2 leading-relaxed" style={BOX}>
              <p>
                Parcel #{prepared.tokenId} goes from <strong>{STATUS_NAMES[prepared.status]}</strong> to{' '}
                <strong>{STATUS_NAMES[prepared.newStatus]}</strong> and shows this heightmap.
              </p>
              <p className="opacity-75 mt-1">
                It stays that way unless the parcel enters daydream mode again and a new heightmap is
                committed. Estimated gas: {prepared.gas.toString()} units, paid by you.
              </p>
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
        <>
          <p className="leading-relaxed">
            {message}{' '}
            <a href={ETHERSCAN_TX(txHash)} target="_blank" rel="noopener noreferrer">[etherscan ↗]</a>
          </p>
          {mode === 'migrate' && (
            <button type="button" className="btn-primary btn-sm text-xs self-start" onClick={() => runChecks('commit')}>
              [continue to commit checks]
            </button>
          )}
        </>
      )}
    </div>
  );
}
