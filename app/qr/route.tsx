import { ImageResponse } from 'next/og';
import QRCode from 'qrcode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TARGET = 'https://neuronify.ai/speak';

async function loadDisplayFont(): Promise<{ name: string; data: ArrayBuffer; weight: 400 | 700 }> {
  try {
    const r = await fetch(
      'https://cdn.jsdelivr.net/npm/@fontsource/syne@latest/files/syne-latin-700-normal.woff',
    );
    if (r.ok) return { name: 'Syne', data: await r.arrayBuffer(), weight: 700 };
  } catch {
    /* fall back */
  }
  const fb = await fetch(
    'https://raw.githubusercontent.com/google/fonts/main/ofl/instrumentserif/InstrumentSerif-Regular.ttf',
  );
  return { name: 'Instrument Serif', data: await fb.arrayBuffer(), weight: 400 };
}

export async function GET() {
  // High error-correction + navy-on-white = reliable scanning from a screen or print.
  const qr = await QRCode.toDataURL(TARGET, {
    errorCorrectionLevel: 'H',
    margin: 1,
    scale: 12,
    color: { dark: '#0A0E1A', light: '#FFFFFF' },
  });
  const font = await loadDisplayFont();
  const fam = `"${font.name}", sans-serif`;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0A0E1A',
          padding: '70px 64px',
          position: 'relative',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: -180,
            right: -150,
            width: 600,
            height: 600,
            borderRadius: '50%',
            backgroundImage:
              'radial-gradient(circle, rgba(56,189,248,0.26), rgba(56,189,248,0) 68%)',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 44 }}>
          <div
            style={{ width: 18, height: 18, borderRadius: '50%', backgroundColor: '#38BDF8', marginRight: 14 }}
          />
          <div style={{ fontSize: 34, fontWeight: 600, color: '#E8ECF3' }}>Neuronify</div>
        </div>

        <div
          style={{
            fontSize: 20,
            letterSpacing: 7,
            color: '#38BDF8',
            textTransform: 'uppercase',
            marginBottom: 22,
          }}
        >
          Speak to Peoria
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            fontFamily: fam,
            letterSpacing: -1.5,
            lineHeight: 1.04,
            marginBottom: 50,
          }}
        >
          <div style={{ fontSize: 74, color: '#E8ECF3' }}>What does your city</div>
          <div style={{ fontSize: 74, color: '#8FDCFF' }}>need?</div>
        </div>

        <div
          style={{
            display: 'flex',
            padding: 28,
            backgroundColor: '#FFFFFF',
            borderRadius: 28,
            boxShadow: '0 30px 80px -20px rgba(0,0,0,0.6)',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} width={440} height={440} alt="" />
        </div>

        <div style={{ marginTop: 40, fontSize: 32, color: '#8FDCFF', fontFamily: 'monospace', letterSpacing: 2 }}>
          neuronify.ai/speak
        </div>
        <div style={{ marginTop: 14, fontSize: 21, color: '#8A93A6', fontWeight: 300 }}>
          Scan it. Say one thing. Watch the city light up.
        </div>
      </div>
    ),
    {
      width: 1080,
      height: 1350,
      fonts: [{ name: font.name, data: font.data, style: 'normal' as const, weight: font.weight }],
    },
  );
}
