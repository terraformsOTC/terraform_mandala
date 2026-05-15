'use client';

import { useState } from 'react';
import { encode } from '@/lib/heightmap';
import { sendEnterDream, sendCommitDream } from '@/lib/wallet';
import { Modal } from './shared';

// Status semantics confirmed in contract.js:
//   0 Terrain      → must enterDream first to be eligible to commit
//   1 Daydream     → can commitDreamToCanvas with the encoded heightmap
//   2 Terraformed  → re-enterDream to erase + start over
//   3 Origin       → genesis 1-of-1 (token 83); not modifiable

export default function DreamActions({ animData, walletAddress, heightmap, onConfirmed }) {
  const [phase, setPhase] = useState('idle');
  const [txHash, setTxHash] = useState(null);
  const [errMsg, setErrMsg] = useState(null);
  const [commitModalOpen, setCommitModalOpen] = useState(false);

  const status = animData?.status;
  const owner = animData?.owner;
  const tokenId = animData?.tokenId;
  const isUnminted = animData?.isUnminted;

  if (isUnminted) {
    return (
      <Card>
        <p className="text-xs opacity-50">
          Unminted parcels can&rsquo;t be modified — there&rsquo;s no token on-chain yet.
        </p>
      </Card>
    );
  }

  if (status === 3) {
    return (
      <Card>
        <p className="text-xs opacity-50">
          Origin parcels can&rsquo;t be modified.
        </p>
      </Card>
    );
  }

  if (!walletAddress) {
    return (
      <Card>
        <p className="text-xs opacity-50">
          Connect your wallet to modify parcels you own.
        </p>
      </Card>
    );
  }

  const isOwner = owner && walletAddress && owner.toLowerCase() === walletAddress.toLowerCase();
  if (!isOwner) {
    return (
      <Card>
        <p className="text-xs opacity-50">
          View only — connected wallet doesn&rsquo;t own this parcel.
        </p>
      </Card>
    );
  }

  const busy = phase === 'pending' || phase === 'confirming';

  const runTx = async (label, sendFn) => {
    setPhase('pending');
    setTxHash(null);
    setErrMsg(null);
    try {
      const tx = await sendFn();
      setTxHash(tx.hash);
      setPhase('confirming');
      await tx.wait(1);
      setPhase('confirmed');
      if (onConfirmed) onConfirmed();
    } catch (err) {
      const reason = err?.shortMessage || err?.reason || err?.message || `${label} failed`;
      // ethers v6 rejects ACTION_REJECTED when the user cancels in the wallet.
      const userRejected = err?.code === 'ACTION_REJECTED' || err?.code === 4001;
      setErrMsg(userRejected ? 'Cancelled in wallet.' : reason);
      setPhase('error');
    }
  };

  const onEnterDream = () =>
    runTx('enterDream', () => sendEnterDream(tokenId));

  // Encode once for the modal preview; re-encoded inside confirmCommit before send.
  let encodedPreview = null;
  let encodeError = null;
  if (heightmap) {
    try {
      encodedPreview = encode(heightmap);
    } catch (err) {
      encodeError = err.message || 'cannot encode heightmap';
    }
  }

  const confirmCommit = () => {
    let encoded;
    try {
      encoded = encode(heightmap);
    } catch (err) {
      setErrMsg(err.message || 'cannot encode heightmap');
      setPhase('error');
      setCommitModalOpen(false);
      return;
    }
    setCommitModalOpen(false);
    runTx('commitDreamToCanvas', () => sendCommitDream(tokenId, encoded));
  };

  return (
    <Card>
      <div className="flex flex-col gap-3">
        {status === 0 && (
          <>
            <p className="text-xs opacity-60">
              This parcel is in Terrain mode. Enter daydream mode first, then commit your mandala.
            </p>
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                disabled={busy}
                className="btn-primary btn-sm text-xs"
                onClick={onEnterDream}
              >
                [enter daydream mode]
              </button>
            </div>
          </>
        )}

        {status === 1 && (
          <>
            <p className="text-xs opacity-60">
              In daydream mode — ready to commit. This sends{' '}
              <code className="opacity-90">commitDreamToCanvas</code> with the encoded uint256[16]
              array.
            </p>
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                disabled={busy || !heightmap || !!encodeError}
                className="btn-primary btn-sm text-xs"
                onClick={() => setCommitModalOpen(true)}
              >
                [commit dream to canvas]
              </button>
            </div>
            {encodeError && (
              <p className="text-xs" style={{ color: '#f87171' }}>encoder: {encodeError}</p>
            )}
          </>
        )}

        {status === 2 && (
          <>
            <p className="text-xs opacity-60">
              This parcel has a committed drawing. Re-entering daydream mode erases it so you can
              commit a new one.
            </p>
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                disabled={busy}
                className="btn-primary btn-sm text-xs"
                onClick={onEnterDream}
              >
                [erase drawing]
              </button>
            </div>
          </>
        )}

        <TxStatus phase={phase} txHash={txHash} errMsg={errMsg} />
      </div>

      <Modal
        open={commitModalOpen}
        onClose={() => setCommitModalOpen(false)}
        title="confirm commit"
      >
        <div className="flex flex-col gap-3 text-xs">
          <p className="opacity-80">
            About to call{' '}
            <code className="opacity-100">commitDreamToCanvas(#{tokenId}, &lt;uint256[16]&gt;)</code>.
            This is an on-chain write — you&rsquo;ll pay gas, and the drawing replaces any current
            canvas. You can erase later by re-entering daydream mode (another tx).
          </p>
          {encodedPreview && (
            <pre
              className="text-[10px] whitespace-pre-wrap break-all opacity-60 p-2"
              style={{ border: '1px solid rgba(232,232,232,0.15)' }}
            >
              {encodedPreview[0].slice(0, 18)}… … {encodedPreview[15].slice(-18)}
            </pre>
          )}
          <p className="opacity-60">
            Always verify the tx details in your wallet before signing.
          </p>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              className="btn-primary btn-sm text-xs"
              onClick={() => setCommitModalOpen(false)}
            >
              [cancel]
            </button>
            <button
              type="button"
              className="btn-primary btn-sm text-xs"
              onClick={confirmCommit}
              disabled={!heightmap || !!encodeError}
            >
              [confirm — send tx]
            </button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

function Card({ children }) {
  return (
    <div
      className="flex flex-col gap-2 p-3 mt-2"
      style={{ border: '1px solid rgba(232,232,232,0.15)' }}
    >
      <span className="text-xs opacity-60 uppercase tracking-wider">[onchain actions]</span>
      {children}
    </div>
  );
}

function TxStatus({ phase, txHash, errMsg }) {
  if (phase === 'idle') return null;
  const label = {
    pending: 'waiting for wallet…',
    confirming: 'tx submitted — waiting for confirmation…',
    confirmed: 'confirmed.',
    error: errMsg || 'something went wrong.',
  }[phase];
  return (
    <div className="text-xs flex flex-col gap-1">
      <span className={phase === 'error' ? 'opacity-90' : 'opacity-70'}>{label}</span>
      {txHash && (
        <a
          href={`https://etherscan.io/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="opacity-70 underline"
        >
          {txHash.slice(0, 10)}…{txHash.slice(-6)} ↗
        </a>
      )}
    </div>
  );
}
