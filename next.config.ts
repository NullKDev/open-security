import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n.ts')

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
};

export default withNextIntl(nextConfig);
