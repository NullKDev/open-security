import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n.ts')

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],

  async redirects() {
    return [
      { source: '/config', destination: '/settings/providers', permanent: true },
      { source: '/repos', destination: '/settings/repos', permanent: true },
      {
        source: '/repos/:id/settings',
        destination: '/settings/repos/:id',
        permanent: true,
      },
      // NOTE: /findings/:path* must NOT be redirected — sub-pages
      // /findings/[id]/verify and /findings/[id]/regression must still work.
      // Only redirect the exact /findings root to /queue?tab=dismissed.
      {
        source: '/findings',
        destination: '/queue?tab=dismissed',
        permanent: false,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
