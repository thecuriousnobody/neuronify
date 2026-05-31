import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

// iOS home-screen icon: the glowing neuron mark on the ink background.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0A0E1A',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            width: 132,
            height: 132,
            borderRadius: '50%',
            backgroundImage:
              'radial-gradient(circle, rgba(143,220,255,0.95), rgba(56,189,248,0.55) 42%, rgba(56,189,248,0) 72%)',
          }}
        />
        <div style={{ width: 60, height: 60, borderRadius: '50%', backgroundColor: '#BFE9FF' }} />
      </div>
    ),
    { ...size },
  );
}
