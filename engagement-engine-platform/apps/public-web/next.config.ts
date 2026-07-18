import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@ee/domain'],
};

export default nextConfig;
