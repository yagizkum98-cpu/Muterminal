import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/mobil/muterminal.apk',
      headers: [
        { key: 'Content-Type', value: 'application/vnd.android.package-archive' },
        { key: 'Content-Disposition', value: 'attachment; filename="muterminal.apk"' },
      ],
    }];
  },
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
