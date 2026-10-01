import type { MDXComponents } from 'mdx/types'
import type { Metadata } from 'next'

import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import { getExtracted } from 'next-intl/server'
import { cacheLife, cacheTag } from 'next/cache'
import { notFound, redirect } from 'next/navigation'

import type { SupportedLocale } from '@/i18n/locales'

import { AffiliateShareDisplay } from '@/app/[locale]/docs/_components/AffiliateShareDisplay'
import { APIPage } from '@/app/[locale]/docs/_components/APIPage'
import { DiscordLink } from '@/app/[locale]/docs/_components/DiscordLink'
import { GammaAPIPage } from '@/app/[locale]/docs/_components/GammaAPIPage'
import { ViewOptions } from '@/app/[locale]/docs/_components/LLMPageActions'
import {
  PublicRuntimeServiceUrl,
  PublicRuntimeWebSocketPlayground,
} from '@/app/[locale]/docs/_components/PublicRuntimeServiceUrl'
import { SecurityReserveBalance } from '@/app/[locale]/docs/_components/SecurityReserveBalance'
import { SiteName } from '@/app/[locale]/docs/_components/SiteName'
import { TradingFeeChart } from '@/app/[locale]/docs/_components/TradingFeeChart'
import { WebSocketPlayground } from '@/app/[locale]/docs/_components/WebSocketPlayground'
import { cacheTags } from '@/lib/cache-tags'
import { getEnglishDocsStaticParams } from '@/lib/docs-static-params'
import { withLocalePrefix } from '@/lib/locale-path'
import { source } from '@/lib/source'
import { loadRuntimeThemeState } from '@/lib/theme-settings'
import { cn } from '@/lib/utils'

export const instant = false

function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    APIPage,
    GammaAPIPage,
    AffiliateShareDisplay,
    TradingFeeChart,
    WebSocketPlayground,
    PublicRuntimeServiceUrl,
    PublicRuntimeWebSocketPlayground,
    SecurityReserveBalance,
    DiscordLink,
    SiteName,
    ...components,
  }
}

export async function generateStaticParams() {
  return getEnglishDocsStaticParams()
}

async function generateCachedDocsMetadata({ slug }: { slug?: string[] }): Promise<Metadata> {
  'use cache'
  cacheLife('max')
  cacheTag(cacheTags.settings)

  const runtimeTheme = await loadRuntimeThemeState()
  const siteDocumentationTitle = `${runtimeTheme.site.name} Documentation`

  const page = source.getPage(slug)
  if (!page) {
    notFound()
  }
  const pageTitle = page.data.title ?? 'Documentation'

  return {
    title: {
      absolute: `${pageTitle} | ${siteDocumentationTitle}`,
    },
    description: page.data.description,
  }
}

export async function generateMetadata(props: PageProps<'/[locale]/docs/[[...slug]]'>): Promise<Metadata> {
  const { slug } = await props.params
  return generateCachedDocsMetadata({ slug })
}

async function renderCachedDocsPage({ locale, slug }: { locale: string; slug?: string[] }) {
  'use cache'
  cacheLife('max')
  cacheTag(cacheTags.settings)

  const t = await getExtracted()

  const page = source.getPage(slug)
  if (!page) {
    redirect('/docs')
  }

  const localizedPageUrl = withLocalePrefix(page.url, locale as SupportedLocale)
  const markdownUrl = `${localizedPageUrl}.md`
  const MDX = page.data.body
  const useFullLayout = Boolean(page.data.full)

  return (
    <DocsPage
      toc={page.data.toc}
      full={useFullLayout}
      tableOfContent={{
        style: 'clerk',
      }}
    >
      <div className="border-b pb-4 lg:pb-0">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <DocsTitle>{page.data.title}</DocsTitle>
            <DocsDescription>{page.data.description}</DocsDescription>
          </div>
          <div className="hidden shrink-0 items-center gap-2 lg:flex">
            <ViewOptions markdownUrl={markdownUrl} />
            <DiscordLink className="h-8.5">{t('Get Help')}</DiscordLink>
          </div>
        </div>
        <div className="-mt-4 flex flex-wrap items-center gap-2 lg:hidden">
          <ViewOptions markdownUrl={markdownUrl} />
          <DiscordLink className="h-8.5">{t('Get Help')}</DiscordLink>
        </div>
      </div>
      <DocsBody className={cn({ 'max-w-none': useFullLayout })}>
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  )
}

export default async function Page(props: PageProps<'/[locale]/docs/[[...slug]]'>) {
  return renderCachedDocsPage(await props.params)
}
