'use client';

export default function ParcelGrid({ parcels, selectedTokenId, onSelect, loading, address }) {
  if (loading) {
    return (
      <div className="text-sm opacity-75">
        [loading parcels for {address?.slice(0, 6)}...{address?.slice(-4)}]
      </div>
    );
  }
  if (!parcels) return null;
  if (parcels.length === 0) {
    return <p className="opacity-75 text-sm">no terraforms parcels found in this wallet.</p>;
  }
  return (
    <div
      className="grid w-full mt-4 gap-3"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}
    >
      {parcels.map((p) => (
        <ParcelCard
          key={p.tokenId}
          parcel={p}
          selected={selectedTokenId === p.tokenId}
          onSelect={() => onSelect(p.tokenId)}
        />
      ))}
    </div>
  );
}

function ParcelCard({ parcel, selected, onSelect }) {
  const { tokenId, statusLabel } = parcel;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="text-left bg-transparent border-none p-0 cursor-pointer"
      style={{ outline: selected ? '2px solid currentColor' : 'none', outlineOffset: '2px' }}
    >
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: '277 / 400' }}>
        <span className="absolute inset-0 bg-placeholder animate-pulse" />
        <img
          src={`/api/image/${tokenId}`}
          alt={`Parcel ${tokenId}`}
          className="absolute inset-0 w-full h-full transition-opacity opacity-100"
          loading="lazy"
          style={{ transitionDuration: '300ms', objectFit: 'cover' }}
          onError={(e) => {
            e.target.style.opacity = 0;
            e.target.parentNode.querySelector('span').classList.remove('animate-pulse');
          }}
        />
      </div>
      <div className="flex justify-between items-center mt-1 text-sm">
        <span>{tokenId}</span>
        {statusLabel && <span className="text-xs opacity-60">{statusLabel}</span>}
      </div>
    </button>
  );
}
