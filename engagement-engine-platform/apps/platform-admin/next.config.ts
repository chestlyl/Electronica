import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@ee/domain', '@ee/configuration'],
};

export default nextConfig;
