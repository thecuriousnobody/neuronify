import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: "Neuronify — Your city's nervous system",
  description:
    'Neuronify turns what your city is saying into a ranked, costed plan its leaders can act on.',
  metadataBase: new URL('https://neuronify.ai'),
  openGraph: {
    title: "Neuronify — Your city's nervous system",
    description:
      'Community signal in. A costed plan out. Civic feedback, triaged and costed for the council.',
    url: 'https://neuronify.ai',
    siteName: 'Neuronify',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: "Neuronify — Your city's nervous system",
    description: 'Community signal in. A costed plan out.',
  },
};

export const viewport: Viewport = {
  themeColor: '#0A0E1A',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
