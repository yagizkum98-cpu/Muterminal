import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  async redirects() {
    return [{ source: '/index.html', destination: '/', permanent: false }];
  },
  async rewrites() {
    return [
      { source: '/admin/login', destination: '/api/session/login' },
      { source: '/admin/logout', destination: '/api/session/logout' },
      { source: '/admin/challenge/:file', destination: '/api/session/challenge/:file' },
    ];
  },
};

export default config;
