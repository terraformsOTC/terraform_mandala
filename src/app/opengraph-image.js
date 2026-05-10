import { ImageResponse } from 'next/og';
import { generateMandala } from '@/lib/mandala';

export const runtime = 'nodejs';
export const alt = 'Terraform Mandala — heightmap mandala generator';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const BG = '#0a0a0a';
const FG = '#e8e8e8';

const ASCII_RAMP = [' ', ' ', '.', ':', '-', '=', '+', '*', '#', '@'];

export default async function Image() {
  const { grid } = generateMandala({
    seed: 'terraformmandala-og',
    algorithm: 'rings',
    peakHeight: 9,
    minHeight: 0,
    ringCount: 8,
    smoothing: 1,
  });

  const cellPx = 14;
  const gridPx = cellPx * 32;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: BG,
          color: FG,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          fontFamily: 'monospace',
          padding: '60px 70px',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: gridPx,
            height: gridPx,
            marginRight: 70,
          }}
        >
          {grid.map((row, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'row', height: cellPx }}>
              {row.map((d, j) => {
                const n = Number(d);
                return (
                  <div
                    key={j}
                    style={{
                      width: cellPx,
                      height: cellPx,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: cellPx,
                      lineHeight: 1,
                      opacity: 0.25 + (n / 9) * 0.75,
                      color: FG,
                    }}
                  >
                    {ASCII_RAMP[n] || ' '}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            justifyContent: 'center',
          }}
        >
          <div style={{ display: 'flex', fontSize: 22, opacity: 0.55, marginBottom: 16 }}>
            [terraformmandala.xyz]
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              fontSize: 64,
              lineHeight: 1.1,
              marginBottom: 20,
            }}
          >
            <div style={{ display: 'flex' }}>heightmap mandala</div>
            <div style={{ display: 'flex' }}>generator</div>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              fontSize: 24,
              opacity: 0.7,
              lineHeight: 1.4,
            }}
          >
            <div style={{ display: 'flex' }}>Design symmetric mandalas, preview them on</div>
            <div style={{ display: 'flex' }}>your Terraform parcel, commit onchain.</div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
