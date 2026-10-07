import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { BookOpenIcon, HomeIcon, SquareTerminalIcon } from 'lucide-react'

import DiscordIcon from '@/components/icons/DiscordIcon'
import SiteLogoIcon from '@/components/SiteLogoIcon'
import { source } from '@/lib/source'
import { loadRuntimeThemeState } from '@/lib/theme-settings'

interface DocsSlugLayoutProps {
  params: Promise<{ locale: string; slug?: string[] }>
  children: ReactNode
}

export async function generateMetadata(): Promise<Metadata> {
  const runtimeTheme = await loadRuntimeThemeState()
  const site = runtimeTheme.site

  return {
    title: {
      template: `%s | ${site.name} Documentation`,
      default: `${site.name} Documentation`,
    },
  }
}

export default async function Layout({ children }: DocsSlugLayoutProps) {
  const runtimeTheme = await loadRuntimeThemeState()
  const site = runtimeTheme.site

  return (
    <DocsLayout
      nav={{
        url: '/docs',
        title: (
          <>
            <SiteLogoIcon
              logoSvg={site.logoSvg}
              logoImageUrl={site.logoImageUrl}
              alt={`${site.name} logo`}
              className="size-6"
              imageClassName="object-contain"
              size={24}
            />
            <span className="font-medium">{`${site.name} Docs`}</span>
          </>
        ),
        transparentMode: 'top',
      }}
      sidebar={{
        prefetch: true,
        tabs: [
          {
            title: 'Documentation',
            description: 'For Users',
            url: '/docs',
            icon: <BookOpenIcon className="size-4" />,
          },
          {
            title: 'API Reference',
            description: 'For Developers',
            url: '/docs/api-reference',
            icon: <SquareTerminalIcon className="size-4" />,
          },
        ],
      }}
      tree={source.pageTree}
      themeSwitch={{
        mode: 'light-dark-system',
      }}
      links={[
        {
          type: 'main',
          url: '/',
          external: true,
          text: 'Main site',
          icon: <HomeIcon />,
        },
        ...(site.discordLink
          ? [
              {
                type: 'main' as const,
                url: site.discordLink,
                external: true,
                text: 'Get Help',
                icon: <DiscordIcon />,
              },
            ]
          : []),
      ]}
    >
      {children}
    </DocsLayout>
  )
}
