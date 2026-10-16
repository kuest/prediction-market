export interface Event {
  id: string
  slug: string
  title: string
  creator: string
  icon_url: string
  livestream_url?: string | null
  additional_context?: string | null
  additional_context_updated_at?: string | null
  show_market_icons: boolean
  is_polymarket_mirror?: boolean
  enable_neg_risk?: boolean
  neg_risk_augmented?: boolean
  neg_risk?: boolean
  neg_risk_market_id?: string
  status: 'draft' | 'active' | 'resolved' | 'archived'
  rules?: string
  series_slug?: string | null
  series_recurrence?: string | null
  sports_event_id?: string | null
  sports_parent_event_id?: number | null
  sports_event_slug?: string | null
  sports_sport_slug?: string | null
  sports_series_slug?: string | null
  sports_league_slug?: string | null
  sports_section?: 'games' | 'props' | null
  sports_start_time?: string | null
  sports_event_week?: number | null
  sports_score?: string | null
  sports_segment_scores?: SportsSegmentScore[] | null
  sports_segment_count?: number | null
  sports_period?: string | null
  sports_elapsed?: string | null
  sports_live?: boolean | null
  sports_ended?: boolean | null
  sports_tags?: string[] | null
  sports_teams?: SportsTeam[] | null
  sports_team_logo_urls?: string[] | null
  sports_source_provider?: string | null
  sports_source_event_id?: string | null
  sports_source_game_id?: string | null
  sports_source_league_id?: string | null
  sports_source_league_label?: string | null
  sports_source_match_confidence?: string | null
  has_live_chart?: boolean
  active_markets_count: number
  total_markets_count: number
  volume: number
  start_date?: string | null
  end_date: string | null
  resolved_at?: string | null
  created_at: string
  updated_at: string
  markets: Market[]
  tags: {
    id: number
    name: string
    slug: string
    isMainCategory: boolean
    event_page_note?: string | null
  }[]
  main_tag: string
  is_bookmarked: boolean
  is_trending: boolean
}

export interface SportsSegmentScore {
  segment: number
  homeScore: number | null
  awayScore: number | null
}

export interface EventSeriesEntry {
  id: string
  slug: string
  status: Event['status']
  end_date: string | null
  resolved_at: string | null
  created_at: string
  sports_event_slug?: string | null
  sports_sport_slug?: string | null
  sports_league_slug?: string | null
  resolved_direction?: 'up' | 'down' | null
}

export type HomeFeaturedTargetType = 'event' | 'series'
export type HomeFeaturedSource = 'manual' | 'ai'
export type HomeFeaturedContextMode = 'auto' | 'news' | 'comments' | 'hidden'
type HomeFeaturedContextItemType = 'news' | 'comment'
export type HomeFeaturedCardKind = 'neg-risk' | 'sports' | 'standard'
export type HomeFeaturedSideCardIcon =
  | 'activity'
  | 'award'
  | 'badge-alert'
  | 'badge-cent'
  | 'badge-check'
  | 'badge-dollar-sign'
  | 'badge-euro'
  | 'badge-info'
  | 'badge-japanese-yen'
  | 'badge-percent'
  | 'badge-plus'
  | 'badge-russian-ruble'
  | 'badge-x'
  | 'bitcoin'
  | 'bot'
  | 'brain'
  | 'briefcase-business'
  | 'building-2'
  | 'calendar-clock'
  | 'chart-candlestick'
  | 'chart-line'
  | 'circle-user-round'
  | 'clapperboard'
  | 'cloud-sun'
  | 'coins'
  | 'flame'
  | 'flag'
  | 'gamepad-2'
  | 'globe'
  | 'goal'
  | 'id-card'
  | 'landmark'
  | 'line-chart'
  | 'map'
  | 'medal'
  | 'newspaper'
  | 'rocket'
  | 'satellite'
  | 'scale'
  | 'shield-check'
  | 'sparkles'
  | 'tags'
  | 'target'
  | 'ticket-percent'
  | 'trending-up'
  | 'trophy'
  | 'volleyball'
  | 'vote'
  | 'wallet'
  | 'zap'

export interface HomeFeaturedEventAdminItem {
  id?: string
  targetType: HomeFeaturedTargetType
  eventId: string | null
  seriesSlug: string | null
  title: string
  slug: string | null
  iconUrl: string | null
  enabled: boolean
  rank: number
  source: HomeFeaturedSource
  startsAt: string | null
  endsAt: string | null
  contextMode: HomeFeaturedContextMode
  autoRolloverEnabled: boolean
  contextItems: HomeFeaturedContextItem[]
}

export interface HomeFeaturedContextItem {
  id: string
  type: HomeFeaturedContextItemType
  source: string
  title: string
  avatarUrl: string | null
  avatarSeed?: string | null
  faviconUrl: string | null
  url: string | null
  publishedAt: string | null
  selectedAt: string
  expiresAt: string
  relevanceScore: number | null
  isManual: boolean
}

export interface HomeFeaturedOutcomeSummary {
  key: string
  conditionId: string
  marketSlug: string | null
  outcomeIndex: number
  label: string
  chance: number
  imageUrl: string | null
  color: string
}

export interface HomeFeaturedSportsMarketGroup {
  label: string
  markets: Array<{
    conditionId: string
    label: string
    chance: number
    tone: 'home' | 'away' | 'draw' | 'neutral'
    color: string | null
  }>
}

export interface HomeFeaturedRolloverEvent {
  contextItems: HomeFeaturedContextItem[]
  event: Event
  kind: HomeFeaturedCardKind
  primaryMarkets: Market[]
  topOutcomes: HomeFeaturedOutcomeSummary[]
  resolvedEventId: string
  temporalStatus: 'live' | 'daily' | 'monthly' | 'ends'
  temporalLabel: string
  sportsMarketGroups: HomeFeaturedSportsMarketGroup[]
}

export interface HomeFeaturedEventCard {
  featuredId: string
  targetType: HomeFeaturedTargetType
  source: HomeFeaturedSource
  rank: number
  contextMode: HomeFeaturedContextMode
  kind: HomeFeaturedCardKind
  event: Event
  primaryMarkets: Market[]
  topOutcomes: HomeFeaturedOutcomeSummary[]
  contextItems: HomeFeaturedContextItem[]
  previousTitle: string | null
  nextTitle: string | null
  resolvedEventId: string
  resolvedSeriesSlug: string | null
  temporalStatus: 'live' | 'daily' | 'monthly' | 'ends'
  temporalLabel: string
  sportsMarketGroups: HomeFeaturedSportsMarketGroup[]
  liveChartConfig: EventLiveChartConfig | null
  seriesEvents: EventSeriesEntry[]
  nextSeriesEvent: HomeFeaturedRolloverEvent | null
}

export interface HomeFeaturedHotTopic {
  label: string
  slug: string
  href: string
  volume24h: number
}

export type HomeFeaturedSideCardSlideType = 'text' | 'image' | 'video'

export interface HomeFeaturedSideCardSlide {
  id: string
  enabled: boolean
  type: HomeFeaturedSideCardSlideType
  title: string
  text: string
  ctaLabel: string
  ctaHref: string
  icon: HomeFeaturedSideCardIcon
  useAi: boolean
  useImage: boolean
  imagePath: string
  imageUrl: string
  videoUrl: string
  videoEmbedUrl: string
}

export interface HomeFeaturedSideCardSettings extends HomeFeaturedSideCardSlide {
  slides: HomeFeaturedSideCardSlide[]
}

export interface HomeFeaturedSettings {
  enabled: boolean
  useAi: boolean
  maxCards: number
  defaultContextMode: HomeFeaturedContextMode
  newsSources: string[]
  commentBlacklist: string[]
  minVolume24h: number
  includeSportsToday: boolean
  includeNewEvents: boolean
  sideCard: HomeFeaturedSideCardSettings
}

export interface EventLiveChartConfig {
  series_slug: string
  topic: string
  event_type: string
  symbol: string
  display_name: string
  display_symbol: string
  line_color: string
  icon_path: string | null
  enabled: boolean
  show_price_decimals: boolean
  active_window_minutes: number
}

export interface ConditionChangeLogEntry {
  condition_id: string
  created_at: string
  old_values: Record<string, unknown>
  new_values: Record<string, unknown>
}

export interface Market {
  condition_id: string
  polymarket_condition_id?: string | null
  question_id: string
  event_id: string
  title: string
  slug: string
  short_title?: string
  question?: string
  market_rules?: string
  resolution_source?: string
  resolution_source_url?: string
  resolver?: string
  neg_risk?: boolean
  neg_risk_other?: boolean
  neg_risk_market_id?: string
  neg_risk_request_id?: string
  metadata_version?: string
  metadata_schema?: string
  icon_url: string
  is_active: boolean
  is_resolved: boolean
  accepting_orders?: boolean
  archived?: boolean
  block_number: number
  block_timestamp: string
  metadata?: any
  sports_market_type?: string | null
  sports_game_start_time?: string | null
  sports_start_time?: string | null
  sports_line?: string | null
  sports_group_item_title?: string | null
  sports_group_item_threshold?: string | null
  volume_24h: number
  volume: number
  end_time?: string | null
  created_at: string
  updated_at: string
  price: number
  probability: number
  outcomes: Outcome[]
  condition: Condition
}

export interface SportsTeam {
  name?: string | null
  abbreviation?: string | null
  record?: string | null
  color?: string | null
  host_status?: string | null
  logo_url?: string | null
}

export interface Outcome {
  condition_id: string
  outcome_text: string
  outcome_index: number
  token_id: string
  polymarket_token_id?: string | null
  is_winning_outcome: boolean
  payout_value?: number
  buy_price?: number
  last_trade_price?: number
  sell_price?: number
  created_at: string
  updated_at: string
}

interface Condition {
  id: string
  oracle: string
  question_id: string
  outcome_slot_count: number
  resolved: boolean
  payout_numerators?: number[]
  payout_denominator?: number
  metadata_hash?: string
  creator?: string
  uma_request_tx_hash?: string
  uma_request_log_index?: number
  uma_oracle_address?: string
  mirror_uma_request_tx_hash?: string
  mirror_uma_request_log_index?: number
  mirror_uma_oracle_address?: string
  resolution_status?: string | null
  resolution_flagged?: boolean | null
  resolution_paused?: boolean | null
  resolution_last_update?: string | null
  resolution_price?: number | null
  resolution_was_disputed?: boolean | null
  resolution_approved?: boolean | null
  resolution_liveness_seconds?: number | null
  resolution_deadline_at?: string | null
  volume: number
  open_interest: number
  active_positions_count: number
  created_at: string
  resolved_at?: string
  updated_at: string
}

interface TradingAuthStatus {
  enabled: boolean
  updatedAt?: string
  version?: string
}

interface UserSettings {
  notifications?: {
    email_resolutions?: boolean
    inapp_order_fills?: boolean
    inapp_hide_small_fills?: boolean
    inapp_resolutions?: boolean
  }
  trading?: {
    market_order_type?: ClobOrderType
    show_slippage_warning?: boolean
  }
  tradingAuth?: {
    relayer?: TradingAuthStatus
    clob?: TradingAuthStatus
    approvals?: TradingAuthStatus
    autoRedeem?: TradingAuthStatus
  }
  [key: string]: any
}

export type DepositWalletStatus = 'not_started' | 'signed' | 'deploying' | 'deployed'

export interface User {
  id: string
  address: string
  email: string
  twoFactorEnabled: boolean | null | undefined
  username: string
  image: string
  settings: UserSettings
  affiliate_code?: string | null
  referred_by_user_id?: string | null
  is_admin: boolean
  deposit_wallet_address?: string | null
  deposit_wallet_signature?: string | null
  deposit_wallet_signed_at?: string | null
  deposit_wallet_status?: DepositWalletStatus | null
  deposit_wallet_tx_hash?: string | null
}

interface PublicProfileStats {
  positions_value: number
  profit_loss: number
  volume_traded: number
  markets_traded: number
}

export interface PublicProfile {
  address: string
  deposit_wallet_address?: string | null
  username: string
  image: string
  created_at: Date
  stats?: PublicProfileStats
}

interface CommentPosition {
  condition_id?: string
  outcome_index?: number
  amount?: number | string
  conditionId?: string
  outcomeIndex?: number
}

export interface Comment {
  id: string
  content: string
  user_id: string
  username: string
  user_avatar: string
  user_address: string
  user_proxy_wallet_address?: string | null
  user_created_at?: string
  likes_count: number
  replies_count: number
  created_at: string
  is_owner: boolean
  user_has_liked: boolean
  parent_comment_id?: string | null
  parentCommentID?: string | null
  positions?: CommentPosition[]
  recent_replies?: Comment[]
}

type NotificationCategory = 'trade' | 'system' | 'general'

type NotificationLinkType = 'none' | 'market' | 'event' | 'order' | 'settings' | 'profile' | 'external' | 'custom'

export interface Notification {
  id: string
  category: NotificationCategory
  title: string
  description: string
  created_at: string
  user_avatar?: string | null
  extra_info?: string
  time_ago?: string
  link_type?: NotificationLinkType
  link_target?: string | null
  link_url?: string | null
  link_label?: string
  metadata?: Record<string, unknown>
}

export interface AffiliateData {
  referralUrl: string
  commissionPercent: number
  stats: {
    total_referrals: number
    active_referrals: number
    volume: number
    total_affiliate_fees: number
  }
  recentReferrals: {
    user_id: string
    username: string
    address: string
    deposit_wallet_address?: string | null
    image?: string | null
    created_at: string
  }[]
}

export interface ActivityOrder {
  id: string
  event_id?: string
  type?: string
  user: {
    id: string
    username: string
    address: string
    image: string
    created_at?: string
  }
  side: 'buy' | 'sell'
  amount: string
  price: string
  outcome: {
    index: number
    text: string
  }
  market: {
    condition_id?: string
    title: string
    slug: string
    icon_url: string
    event?: {
      slug: string
      show_market_icons: boolean
    }
  }
  total_value: number
  created_at: string
  status: string
  tx_hash?: string
}

export type OrderSide = 0 | 1 // 0 = BUY, 1 = SELL
export type OrderType = 'MARKET' | 'LIMIT'
export type ClobOrderType = 'FOK' | 'FAK' | 'GTC' | 'GTD'
export type MarketOrderType = 'FAK' | 'FOK'

export interface UserOpenOrder {
  id: string
  side: 'buy' | 'sell'
  type: ClobOrderType
  status: string
  price: number
  maker_amount: number
  taker_amount: number
  size_matched: number
  created_at: string
  expiration?: number | null
  outcome: {
    index: number
    text: string
  }
  market: {
    condition_id: string
    title: string
    slug: string
    is_active: boolean
    is_resolved: boolean
    icon_url?: string
    event_slug?: string
    event_title?: string
  }
}

export type QueryResult<T> = { data: T; error: null } | { data: null; error: string }

export interface SearchResultItems {
  events: Event[]
  profiles: PublicProfile[]
}

export interface SearchLoadingStates {
  events: boolean
  profiles: boolean
}

type Address = `0x${string}`

export interface BlockchainOrder {
  salt: bigint
  maker: Address
  signer: Address
  taker: Address
  token_id: bigint
  maker_amount: bigint
  taker_amount: bigint
  expiration: bigint
  nonce: bigint
  fee_rate_bps: bigint
  side: number
  signature_type: number
  timestamp: bigint
  metadata: `0x${string}`
  builder: `0x${string}`
}

export interface UserPosition {
  market: {
    condition_id: string
    title: string
    slug: string
    icon_url: string
    is_active: boolean
    is_resolved: boolean
    event?: {
      slug: string
    }
  }
  outcome_index?: number
  outcome_text?: string
  average_position: number
  total_position_value: number
  total_position_cost?: number
  total_shares?: number
  profit_loss_value?: number
  profit_loss_percent?: number
  size?: number
  avgPrice?: number
  curPrice?: number
  currentValue?: number
  totalBought?: number
  initialValue?: number
  percentPnl?: number
  percentRealizedPnl?: number
  realizedPnl?: number
  cashPnl?: number
  redeemable?: boolean
  opposite_outcome_text?: string
  order_count: number
  last_activity_at: string
}
