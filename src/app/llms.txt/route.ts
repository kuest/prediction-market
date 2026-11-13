import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@/i18n/locales'
import { resolvePublicRuntimeEnv } from '@/lib/public-runtime-config.shared'
import { deferPublicShellPrerenderIfNeeded } from '@/lib/public-shell-rendering'
import { source } from '@/lib/source'
import { loadRuntimeThemeState } from '@/lib/theme-settings'

const NON_DEFAULT_LOCALE_PREFIXES = SUPPORTED_LOCALES.filter((locale) => locale !== DEFAULT_LOCALE).map(
  (locale) => `/${locale}`,
)

const PUBLIC_APP_ROUTES = [
  {
    title: 'Home',
    url: '/',
    description: 'Explore active prediction markets and featured categories.',
  },
  {
    title: 'New markets',
    url: '/new',
    description: 'Recently added prediction markets.',
  },
  {
    title: 'Activity',
    url: '/activity',
    description: 'Live public activity across trades and market interactions.',
  },
  {
    title: 'Sports',
    url: '/sports',
    description: 'Sports prediction markets, live games, futures, props, and league pages.',
  },
  {
    title: 'Esports',
    url: '/esports',
    description: 'Esports markets, live events, upcoming matches, props, and game pages.',
  },
  {
    title: 'Leaderboard',
    url: '/leaderboard',
    description: 'Trader rankings and public performance views.',
  },
  {
    title: 'Mentions',
    url: '/mentions',
    description: 'Live events where you can predict the words and phrases that will be said.',
  },
  {
    title: 'Portfolio',
    url: '/portfolio',
    description: 'Authenticated user positions, winnings, open orders, and wallet actions.',
  },
  {
    title: 'Settings',
    url: '/settings',
    description: 'Authenticated profile, notification, trading, affiliate, 2FA, and SDK settings.',
  },
  {
    title: 'Terms of Service',
    url: '/tos',
    description: 'Legal terms for using the market.',
  },
] as const

const ROUTE_PATTERNS = [
  {
    pattern: '/event/{eventSlug}',
    description:
      'Event detail page with markets, probabilities, order book, chart, comments, rules, and resolution state.',
  },
  {
    pattern: '/event/{eventSlug}/{marketSlug}',
    description: 'Specific market view inside a multi-market event.',
  },
  {
    pattern: '/predictions/{query}',
    description: 'Search-result landing page for prediction topics.',
  },
  {
    pattern: '/profile/{usernameOrWallet}',
    description: 'Public trader profile, positions, and activity.',
  },
  {
    pattern: '/series/{seriesSlug}',
    description: 'Markets grouped by a recurring series.',
  },
  {
    pattern: '/sports/{sportSlug}',
    description: 'Sport-specific market landing page.',
  },
  {
    pattern: '/sports/{sportSlug}/{eventSlug}',
    description: 'Sports event page with game markets and related context.',
  },
  {
    pattern: '/sports/{sportSlug}/{eventSlug}/{marketSlug}',
    description: 'Specific market view inside a sports event.',
  },
  {
    pattern: '/esports/{gameSlug}',
    description: 'Esports game landing page.',
  },
  {
    pattern: '/{categorySlug}',
    description: 'Dynamic category landing page, such as crypto, finance, politics, sports, or culture.',
  },
  {
    pattern: '/{categorySlug}/{subcategorySlug}',
    description: 'Dynamic subcategory landing page.',
  },
  {
    pattern: '/docs/{docPath}.md',
    description: 'Machine-readable markdown version of a documentation page.',
  },
] as const

const DEVELOPER_RESOURCES = [
  {
    title: 'Documentation',
    url: '/docs',
    description: 'User and API documentation.',
  },
  {
    title: 'API Reference',
    url: '/docs/api-reference',
    description: 'Overview of the public Gamma, CLOB, Data, and WebSocket APIs.',
  },
  {
    title: 'Authentication',
    url: '/docs/api-reference/authentication',
    description: 'CLOB API authentication, credential flow, and SDK guidance.',
  },
  {
    title: 'Clients & SDKs',
    url: '/docs/api-reference/clients-sdks',
    description: 'Python, Rust, and TypeScript SDK guidance.',
  },
  {
    title: 'Rate Limits',
    url: '/docs/api-reference/rate-limits',
    description: 'API rate-limit behavior.',
  },
] as const

const FRONTEND_API_ROUTES = [
  {
    pattern: '/api/events',
    description: 'Paginated event listing used by home, category, search, sports, and esports surfaces.',
  },
  {
    pattern: '/api/event-activity?market={conditionId}',
    description: 'Public activity feed for a market condition.',
  },
  {
    pattern: '/api/holders?conditionId={conditionId}',
    description: 'Top holder data for a market condition.',
  },
  {
    pattern: '/api/embed/events/slug/{eventSlug}',
    description: 'CORS-enabled event payload for external embeds.',
  },
  {
    pattern: '/api/embed/markets/slug/{marketSlug}',
    description: 'CORS-enabled market payload for external embeds.',
  },
  {
    pattern: '/api/market-context',
    description: 'POST endpoint that returns structured market context for event tooling.',
  },
  {
    pattern: '/market.html?market={marketSlug}',
    description: 'Embeddable market widget HTML endpoint.',
  },
] as const

const publicRuntimeEnv = resolvePublicRuntimeEnv(process.env)

const SERVICE_ENDPOINTS = [
  {
    name: 'Gamma API',
    url: publicRuntimeEnv.gammaUrl,
    description: 'Market discovery, events, tags, series, and search metadata.',
  },
  {
    name: 'CLOB API',
    url: publicRuntimeEnv.clobUrl,
    description: 'Orders, cancellations, trades, order books, pricing, and CLOB authentication.',
  },
  {
    name: 'Data API',
    url: publicRuntimeEnv.dataUrl,
    description: 'Positions, user activity, holders, leaderboards, and analytics.',
  },
  {
    name: 'CLOB WebSocket',
    url: publicRuntimeEnv.wsClobUrl,
    description: 'Market and user real-time streams.',
  },
  {
    name: 'Live Data WebSocket',
    url: publicRuntimeEnv.wsLiveDataUrl,
    description: 'Activity, comments, and reference price streams.',
  },
] as const

function normalizeDescription(description?: string) {
  return description?.replace(/\s+/g, ' ').trim()
}

function formatLink(title: string, url: string, description?: string) {
  const normalizedDescription = normalizeDescription(description)

  if (!normalizedDescription) {
    return `- [${title}](${url})`
  }

  return `- [${title}](${url}): ${normalizedDescription}`
}

function formatEndpoint({ name, url, description }: (typeof SERVICE_ENDPOINTS)[number]) {
  return `- ${name}: (${url}) - ${description}`
}

export async function GET() {
  await deferPublicShellPrerenderIfNeeded()

  const runtimeTheme = await loadRuntimeThemeState()
  const site = runtimeTheme.site
  const siteDescription = normalizeDescription(site.description) ?? 'Decentralized prediction markets.'
  const pages = [...source.getPages()].sort((left, right) => left.url.localeCompare(right.url))
  const socialLinks = [
    site.supportUrl ? formatLink('Support', site.supportUrl, 'Official support channel for this market.') : null,
    site.discordLink ? formatLink('Discord', site.discordLink, 'Community and support server.') : null,
    site.twitterLink ? formatLink('X / Twitter', site.twitterLink, 'Public social updates.') : null,
  ].filter((line): line is string => Boolean(line))

  const lines = [
    `# ${site.name}`,
    '',
    `> ${siteDescription}`,
    '',
    `${site.name} is a prediction market for trading on real-world events. It supports market discovery, event pages, sports and esports views, public trader profiles, portfolio management, wallet funding, CLOB trading, SDK downloads, and developer documentation.`,
    '',
    '## LLM Usage Notes',
    '- Prefer documentation links ending in `.md` when loading reference material into an LLM.',
    `- Public app pages may be localized with ${NON_DEFAULT_LOCALE_PREFIXES.map((prefix) => `\`${prefix}\``).join(', ')} prefixes; docs content is canonical in English.`,
    '- Authenticated routes such as `/portfolio`, `/settings`, and SDK downloads require a signed-in user.',
    '- Do not treat public API examples as financial, legal, or trading advice.',
    '',
    '## Primary App Routes',
    ...PUBLIC_APP_ROUTES.map((route) => formatLink(route.title, route.url, route.description)),
    '',
    '## Route Patterns',
    ...ROUTE_PATTERNS.map((route) => `- \`${route.pattern}\`: ${route.description}`),
    '',
    '## Selected Frontend API Routes',
    ...FRONTEND_API_ROUTES.map((route) => `- \`${route.pattern}\`: ${route.description}`),
    '',
    '## Developer Resources',
    ...DEVELOPER_RESOURCES.map((resource) => formatLink(resource.title, resource.url, resource.description)),
    '',
    '## Public Service Endpoints',
    ...SERVICE_ENDPOINTS.map(formatEndpoint),
    '',
    '## Machine-Readable Indexes',
    '- [llms.txt](/llms.txt): This project-level LLM index.',
    '- [Sitemap](/sitemap.xml): XML sitemap index for public app, docs, category, prediction, and event URLs.',
    '- [Docs sitemap](/sitemaps/docs.xml): XML sitemap for documentation pages.',
    '',
    ...(socialLinks.length > 0 ? ['## Official Links', ...socialLinks, ''] : []),
    '## Documentation Pages',
    '> User and API docs. Each link points to the machine-readable markdown view.',
    '',
    ...pages.map((page) => {
      const title = page.data.title ?? page.url
      return formatLink(title, `${page.url}.md`, page.data.description)
    }),
  ]

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  })
}
