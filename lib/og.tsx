import { ImageResponse } from 'next/og';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = "Neuronify — your city's nervous system";

// Instrument Serif gives the headline its brand character. Fetched at render
// time from the Google Fonts repo; if it ever fails we fall back to a generic
// serif so the image still renders (never throws).
async function loadSerif(): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(
      'https://raw.githubusercontent.com/google/fonts/main/ofl/instrumentserif/InstrumentSerif-Regular.ttf',
    );
    if (res.ok) return await res.arrayBuffer();
  } catch {
    /* fall through to generic serif */
  }
  return null;
}

// A scattered neural field — faint nodes plus a couple of bright ones.
const NODES: { x: number; y: number; r: number; o: number; bright?: boolean }[] = [
  { x: 980, y: 90, r: 6, o: 0.9, bright: true },
  { x: 1080, y: 180, r: 4, o: 0.5 },
  { x: 900, y: 220, r: 3, o: 0.4 },
  { x: 1130, y: 300, r: 5, o: 0.7, bright: true },
  { x: 1010, y: 360, r: 3, o: 0.35 },
  { x: 1095, y: 470, r: 4, o: 0.5 },
  { x: 940, y: 470, r: 3, o: 0.3 },
  { x: 1150, y: 560, r: 6, o: 0.8, bright: true },
];

export default async function OgImage() {
  const serif = await loadSerif();

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: '#0A0E1A',
          padding: '76px 80px',
          position: 'relative',
          fontFamily: 'sans-serif',
        }}
      >
        {/* cyan bloom, top-right */}
        <div
          style={{
            position: 'absolute',
            top: -160,
            right: -120,
            width: 620,
            height: 620,
            borderRadius: '50%',
            backgroundImage:
              'radial-gradient(circle, rgba(56,189,248,0.28), rgba(56,189,248,0) 68%)',
          }}
        />
        {/* decorative nodes */}
        {NODES.map((n, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: n.x,
              top: n.y,
              width: n.r * 2,
              height: n.r * 2,
              borderRadius: '50%',
              backgroundColor: n.bright ? '#8FDCFF' : '#9CB0D8',
              opacity: n.o,
            }}
          />
        ))}

        {/* wordmark */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              backgroundColor: '#38BDF8',
              marginRight: 14,
            }}
          />
          <div style={{ fontSize: 30, fontWeight: 600, color: '#E8ECF3', letterSpacing: -0.5 }}>
            Neuronify
          </div>
        </div>

        {/* headline block */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              fontSize: 19,
              letterSpacing: 7,
              color: '#38BDF8',
              textTransform: 'uppercase',
              marginBottom: 26,
            }}
          >
            Your city&apos;s nervous system
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              fontFamily: '"Instrument Serif", serif',
              lineHeight: 1.0,
            }}
          >
            <div style={{ display: 'flex', fontSize: 92, color: '#E8ECF3' }}>Every resident,</div>
            <div style={{ display: 'flex', fontSize: 92 }}>
              <span style={{ color: '#E8ECF3', marginRight: 26 }}>a</span>
              <span style={{ color: '#8FDCFF' }}>neuron.</span>
            </div>
          </div>
          <div style={{ display: 'flex', fontSize: 29, color: '#8A93A6', marginTop: 28 }}>
            Community signal in. A costed plan out.
          </div>
        </div>

        {/* footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: '1px solid rgba(140,160,200,0.12)',
            paddingTop: 26,
          }}
        >
          <div style={{ fontSize: 24, color: '#8FDCFF' }}>neuronify.ai</div>
          <div style={{ fontSize: 19, letterSpacing: 4, color: '#5E6678', textTransform: 'uppercase' }}>
            Peoria · Illinois
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: serif
        ? [{ name: 'Instrument Serif', data: serif, style: 'normal', weight: 400 }]
        : [],
    },
  );
}
