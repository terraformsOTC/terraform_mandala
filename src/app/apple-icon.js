import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#0a0a0a',
          color: '#e8e8e8',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 90,
          fontFamily: 'monospace',
          fontWeight: 700,
          letterSpacing: -4,
        }}
      >
        TM
      </div>
    ),
    { ...size },
  );
}
