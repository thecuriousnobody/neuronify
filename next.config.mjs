/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // v1 resident doors retired — one front door (/report). Temporary redirects
  // (not 308s) so the old paths can be repurposed later without cache pain.
  async redirects() {
    return [
      { source: '/speak', destination: '/report', permanent: false },
      { source: '/intake', destination: '/report', permanent: false },
    ];
  },
};

export default nextConfig;
