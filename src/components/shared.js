'use client';

import { useEffect } from 'react';

export function shortAddress(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// Minimal modal. Backdrop click + Escape close. Caller owns the open state.
export function Modal({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-primary)',
          border: '1px solid rgba(232,232,232,0.3)',
          maxWidth: '480px', width: '100%',
          padding: '20px',
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs uppercase tracking-wider opacity-70">{title}</span>
          <button type="button" className="text-xs opacity-60 hover:opacity-100" onClick={onClose}>
            [close]
          </button>
        </div>
        {children}
      </div>
    </div>
  );
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
