import type { NextConfig } from 'next'

import { withSentryConfig } from '@sentry/nextjs/config'
import { createMDX } from 'fumadocs-mdx/next'
import createNextIntlPlugin from 'next-intl/plugin'

import { resolveCommitSha } from '@/lib/git'
import { getOptimizedImageHostPatterns } from '@/lib/image/image-optimization'

const optimizedImageHostPatterns = getOptimizedImageHostPatterns(process.env)
const commitSha = resolveCommitSha()

const config: NextConfig = {
  output: process.env.VERCEL_ENV ? undefined : 'standalone',
  deploymentId: process.env.VERCEL_ENV ? undefined : commitSha,
  cacheComponents: true,
  partialPrefetching: true,
  typedRoutes: true,
  reactStrictMode: false,
  reactCompiler: true,
  compress: false,
  typescript: {
    ignoreBuildErrors: !!process.env.VERCEL_ENV,
  },
  experimental: {
    agentUpgrade: 'latest',
    inlineCss: true,
    serverActions: {
      bodySizeLimit: '2mb',
    },
    typedEnv: true,
    turbopackRustReactCompiler: true,
  },
  images: {
    unoptimized: process.env.DISABLE_IMAGE_OPTIMIZATION === 'true',
    loader: 'custom',
    loaderFile: './src/lib/image/image-loader.ts',
    deviceSizes: [256, 384, 640, 768],
    imageSizes: [16, 20, 24, 32, 36, 40, 42, 44, 48, 56, 64, 96, 128],
    remotePatterns: optimizedImageHostPatterns.map((hostname) => ({
      protocol: 'https',
      hostname,
      port: '',
      pathname: '/**',
    })),
  },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/javascript; charset=utf-8',
          },
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self'",
          },
        ],
      },
    ]
  },
  async redirects() {
    return [
      {
        source: '/docs/my-account/affiliate-program',
        destination: '/docs/my-account/rewards',
        permanent: true,
      },
      {
        source: '/docs/my-account/affiliate-program.md',
        destination: '/docs/my-account/rewards.md',
        permanent: true,
      },
      {
        source: '/:locale/docs/my-account/affiliate-program',
        destination: '/:locale/docs/my-account/rewards',
        permanent: true,
      },
      {
        source: '/:locale/docs/my-account/affiliate-program.md',
        destination: '/:locale/docs/my-account/rewards.md',
        permanent: true,
      },
    ]
  },
  async rewrites() {
    return [
      {
        source: '/docs/:path*.md',
        destination: '/llms.md/:path*',
      },
      {
        source: '/:locale/docs/:path*.md',
        destination: '/llms.md/:path*',
      },
      {
        source: '/sitemaps/:id.xml',
        destination: '/sitemaps/sitemap/:id.xml',
      },
      {
        source: '/@:username',
        destination: '/profile/:username',
      },
      {
        source: '/:locale/@:username',
        destination: '/:locale/profile/:username',
      },
    ]
  },
  env: {
    COMMIT_SHA: commitSha,
  },
}

const withMDX = createMDX({
  configPath: 'docs.config.ts',
})

const withNextIntl = createNextIntlPlugin({
  experimental: {
    extract: true,
    srcPath: './src',
    messages: {
      path: './src/i18n/messages',
      format: 'json',
      locales: 'infer',
      sourceLocale: 'en',
    },
  },
})

export default withSentryConfig(withNextIntl(withMDX(config)), {
  telemetry: false,
  silent: true,
})
