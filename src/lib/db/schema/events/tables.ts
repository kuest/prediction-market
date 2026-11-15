import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  pgView,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'

import type { SportsSegmentScore } from '@/types'

import { users } from '../auth/tables'

export const conditions = pgTable('conditions', {
  id: text().primaryKey(),
  oracle: text().notNull(),
  question_id: text().notNull(),
  resolved: boolean().default(false),
  metadata_hash: text(),
  creator: char('creator', { length: 42 }),
  uma_request_tx_hash: char('uma_request_tx_hash', { length: 66 }),
  uma_request_log_index: integer('uma_request_log_index'),
  uma_oracle_address: char('uma_oracle_address', { length: 42 }),
  mirror_uma_request_tx_hash: char('mirror_uma_request_tx_hash', { length: 66 }),
  mirror_uma_request_log_index: integer('mirror_uma_request_log_index'),
  mirror_uma_oracle_address: char('mirror_uma_oracle_address', { length: 42 }),
  resolution_status: text(),
  resolution_flagged: boolean(),
  resolution_paused: boolean(),
  resolution_last_update: timestamp({ withTimezone: true }),
  resolution_price: numeric({ precision: 20, scale: 6 }),
  resolution_was_disputed: boolean(),
  resolution_approved: boolean(),
  resolution_liveness_seconds: integer(),
  resolution_deadline_at: timestamp({ withTimezone: true }),
  created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
})

export const conditions_audit = pgTable('conditions_audit', {
  id: char({ length: 26 })
    .primaryKey()
    .default(sql`generate_ulid()`),
  condition_id: text()
    .notNull()
    .references(() => conditions.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
  old_values: jsonb().notNull(),
  new_values: jsonb().notNull(),
  created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
})

export const events = pgTable(
  'events',
  {
    id: char({ length: 26 })
      .primaryKey()
      .default(sql`generate_ulid()`),
    slug: text().notNull().unique(),
    title: text().notNull(),
    creator: char({ length: 42 }),
    icon_url: text(),
    is_hidden: boolean().notNull().default(false),
    is_polymarket_mirror: boolean().notNull().default(false),
    livestream_url: text(),
    additional_context: text(),
    additional_context_updated_at: timestamp({ withTimezone: true }),
    show_market_icons: boolean().default(true),
    enable_neg_risk: boolean().default(false),
    neg_risk_augmented: boolean().default(false),
    neg_risk: boolean().default(false),
    neg_risk_market_id: char({ length: 66 }),
    series_slug: text(),
    series_id: text(),
    series_recurrence: text(),
    status: text().notNull().default('active'),
    rules: text(),
    active_markets_count: integer().default(0),
    total_markets_count: integer().default(0),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    start_date: timestamp({ withTimezone: true }),
    end_date: timestamp({ withTimezone: true }),
    resolved_at: timestamp({ withTimezone: true }),
  },
  (table) => ({
    titleSearchIdx: index('idx_events_title_lower_gin_trgm').using(
      'gin',
      sql`LOWER(${table.title}) extensions.gin_trgm_ops`,
    ),
    slugSearchIdx: index('idx_events_slug_lower_gin_trgm').using(
      'gin',
      sql`LOWER(${table.slug}) extensions.gin_trgm_ops`,
    ),
  }),
)

export const event_live_chart_configs = pgTable('event_live_chart_configs', {
  series_slug: text().primaryKey(),
  topic: text().notNull().default('crypto_prices_chainlink'),
  event_type: text().notNull().default('update'),
  symbol: text().notNull(),
  display_name: text().notNull(),
  display_symbol: text().notNull(),
  line_color: text().notNull().default('#F59E0B'),
  icon_path: text(),
  enabled: boolean().notNull().default(true),
  show_price_decimals: boolean().notNull().default(true),
  active_window_minutes: integer().notNull().default(1440),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

export const series_social_trackers = pgTable(
  'series_social_trackers',
  {
    id: smallint().primaryKey().generatedAlwaysAsIdentity(),
    series_slug: text().notNull(),
    platform: text().notNull().default('X'),
    handle: text().notNull(),
    display_name: text().notNull(),
    is_verified: boolean().notNull().default(false),
    bio: text(),
    is_active: boolean().notNull().default(true),
    priority: smallint().notNull().default(0),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    series_slug_platform_handle_unique: unique('series_social_trackers_series_slug_platform_handle_key').on(
      table.series_slug,
      table.platform,
      table.handle,
    ),
  }),
)

export const event_translations = pgTable(
  'event_translations',
  {
    event_id: char({ length: 26 })
      .notNull()
      .references(() => events.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    locale: text().notNull(),
    title: text().notNull(),
    source_hash: text().notNull(),
    is_manual: boolean().notNull().default(false),
    additional_context: text(),
    additional_context_source_hash: text(),
    additional_context_is_manual: boolean().notNull().default(false),
    rules: text(),
    rules_source_hash: text(),
    rules_is_manual: boolean().notNull().default(false),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.event_id, table.locale] }),
  }),
)

export const event_creations = pgTable(
  'event_creations',
  {
    id: char({ length: 26 })
      .primaryKey()
      .default(sql`generate_ulid()`),
    created_by_user_id: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    updated_by_user_id: text().references(() => users.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    source_event_id: char({ length: 26 }).references(() => events.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    deployed_event_id: char({ length: 26 }).references(() => events.id, { onDelete: 'set null', onUpdate: 'cascade' }),
    title: text().notNull().default('Untitled draft'),
    slug: text(),
    title_template: text(),
    slug_template: text(),
    creation_mode: text().notNull().default('single'),
    status: text().notNull().default('draft'),
    start_at: timestamp({ withTimezone: true }),
    deploy_at: timestamp({ withTimezone: true }),
    end_date: timestamp({ withTimezone: true }),
    wallet_address: char({ length: 42 }),
    draft_payload: jsonb().$type<Record<string, unknown> | null>(),
    asset_payload: jsonb().$type<Record<string, unknown> | null>(),
    main_category_slug: text(),
    category_slugs: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    market_mode: text(),
    binary_question: text(),
    binary_outcome_yes: text(),
    binary_outcome_no: text(),
    resolution_source: text(),
    resolution_rules: text(),
    recurrence_unit: text(),
    recurrence_interval: integer(),
    recurrence_until: timestamp({ withTimezone: true }),
    pending_request_id: text(),
    pending_payload_hash: char({ length: 66 }),
    pending_chain_id: integer(),
    pending_confirmed_txs: jsonb().$type<Record<string, unknown>[] | null>(),
    last_run_at: timestamp({ withTimezone: true }),
    last_error: text(),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    deployedEventIdIdx: index('idx_event_creations_deployed_event_id').on(table.deployed_event_id),
    updatedByUserIdIdx: index('idx_event_creations_updated_by_user_id').on(table.updated_by_user_id),
  }),
)

export const jobs = pgTable(
  'jobs',
  {
    id: char({ length: 26 })
      .primaryKey()
      .default(sql`generate_ulid()`),
    job_type: text().notNull(),
    dedupe_key: text().notNull(),
    payload: jsonb().notNull(),
    status: text().notNull().default('pending'),
    attempts: smallint().notNull().default(0),
    max_attempts: smallint().notNull().default(5),
    available_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    reserved_at: timestamp({ withTimezone: true }),
    last_error: text(),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    job_type_dedupe_key_unique: unique('jobs_job_type_dedupe_key_key').on(table.job_type, table.dedupe_key),
  }),
)

export const markets = pgTable(
  'markets',
  {
    condition_id: text()
      .primaryKey()
      .references(() => conditions.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    polymarket_condition_id: text(),
    event_id: char({ length: 26 })
      .notNull()
      .references(() => events.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    title: text().notNull(),
    slug: text().notNull(),
    short_title: text(),
    question: text(),
    market_rules: text(),
    resolution_source: text(),
    resolution_source_url: text(),
    resolver: char({ length: 42 }),
    neg_risk: boolean().default(false).notNull(),
    neg_risk_other: boolean().default(false).notNull(),
    neg_risk_market_id: char({ length: 66 }),
    neg_risk_request_id: char({ length: 66 }),
    metadata_version: text(),
    metadata_schema: text(),
    icon_url: text(),
    is_active: boolean().default(true).notNull(),
    is_resolved: boolean().default(false).notNull(),
    metadata: text(),
    volume_24h: numeric({ precision: 20, scale: 6 }).default('0').notNull(),
    volume: numeric({ precision: 20, scale: 6 }).default('0').notNull(),
    end_time: timestamp({ withTimezone: true }),
    created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    conditionIdLowerIdx: index('idx_markets_condition_id_lower').on(sql`LOWER(${table.condition_id})`),
  }),
)

export const market_context_cache = pgTable(
  'market_context_cache',
  {
    condition_id: text()
      .notNull()
      .references(() => markets.condition_id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    locale: text().notNull(),
    context: text().notNull(),
    expires_at: timestamp({ withTimezone: true }).notNull(),
    created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.condition_id, table.locale] }),
  }),
)

export const home_featured_events = pgTable(
  'home_featured_events',
  {
    id: char({ length: 26 })
      .primaryKey()
      .default(sql`generate_ulid()`),
    target_type: text().notNull().default('event'),
    event_id: char({ length: 26 }).references(() => events.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    series_slug: text(),
    enabled: boolean().notNull().default(true),
    rank: integer().notNull().default(0),
    source: text().notNull().default('manual'),
    starts_at: timestamp({ withTimezone: true }),
    ends_at: timestamp({ withTimezone: true }),
    context_mode: text().notNull().default('auto'),
    auto_rollover_enabled: boolean().notNull().default(true),
    created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    contextModeCheck: check(
      'home_featured_events_context_mode_check',
      sql`${table.context_mode} IN ('auto', 'news', 'comments', 'hidden')`,
    ),
    enabledRankIdx: index('idx_home_featured_events_enabled_rank').on(table.enabled, table.rank),
    eventIdIdx: index('idx_home_featured_events_event_id').on(table.event_id),
    seriesSlugIdx: index('idx_home_featured_events_series_slug').on(table.series_slug),
    sourceCheck: check('home_featured_events_source_check', sql`${table.source} IN ('manual', 'ai')`),
    startsAtIdx: index('idx_home_featured_events_starts_at').on(table.starts_at),
    endsAtIdx: index('idx_home_featured_events_ends_at').on(table.ends_at),
    targetReferenceCheck: check(
      'home_featured_events_target_reference_check',
      sql`(
        (${table.target_type} = 'event' AND ${table.event_id} IS NOT NULL AND ${table.series_slug} IS NULL)
        OR (${table.target_type} = 'series' AND ${table.event_id} IS NULL AND TRIM(COALESCE(${table.series_slug}, '')) <> '')
      )`,
    ),
    targetTypeCheck: check('home_featured_events_target_type_check', sql`${table.target_type} IN ('event', 'series')`),
  }),
)

export const home_featured_event_context_items = pgTable(
  'home_featured_event_context_items',
  {
    id: char({ length: 26 })
      .primaryKey()
      .default(sql`generate_ulid()`),
    featured_event_id: char({ length: 26 })
      .notNull()
      .references(() => home_featured_events.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    event_id: char({ length: 26 })
      .notNull()
      .references(() => events.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    locale: text().notNull().default('en'),
    item_type: text().notNull().default('news'),
    source: text().notNull(),
    title: text().notNull(),
    url: text(),
    favicon_url: text(),
    published_at: timestamp({ withTimezone: true }),
    relevance_score: numeric({ precision: 8, scale: 4 }),
    is_manual: boolean().notNull().default(false),
    selected_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    expires_at: timestamp({ withTimezone: true }).notNull(),
    created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    featuredEventLocaleIdx: index('idx_home_featured_context_featured_locale').on(
      table.featured_event_id,
      table.locale,
    ),
    eventLocaleExpiresIdx: index('idx_home_featured_context_event_locale_expires').on(
      table.event_id,
      table.locale,
      table.expires_at,
    ),
    expiresAtIdx: index('idx_home_featured_context_expires_at').on(table.expires_at),
    itemTypeCheck: check(
      'home_featured_event_context_items_item_type_check',
      sql`${table.item_type} IN ('news', 'comment')`,
    ),
    relevanceScoreCheck: check(
      'home_featured_event_context_items_relevance_score_check',
      sql`${table.relevance_score} IS NULL OR (${table.relevance_score} >= 0 AND ${table.relevance_score} <= 1)`,
    ),
  }),
)

export const event_sports = pgTable(
  'event_sports',
  {
    event_id: char({ length: 26 })
      .primaryKey()
      .references(() => events.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    sports_event_id: text(),
    sports_event_slug: text(),
    sports_parent_event_id: bigint({ mode: 'number' }),
    sports_game_id: bigint({ mode: 'number' }),
    sports_event_date: date(),
    sports_start_time: timestamp({ withTimezone: true }),
    sports_series_slug: text(),
    sports_series_id: text(),
    sports_series_recurrence: text(),
    sports_series_color: text(),
    sports_sport_slug: text(),
    sports_league_label: text(),
    sports_league_slug: text(),
    sports_event_week: integer(),
    sports_score: text(),
    sports_segment_scores: jsonb().$type<SportsSegmentScore[] | null>(),
    sports_period: text(),
    sports_elapsed: text(),
    sports_live: boolean(),
    sports_ended: boolean(),
    sports_tags: jsonb(),
    sports_teams: jsonb(),
    sports_team_logo_urls: jsonb(),
    sports_source_provider: text(),
    sports_source_event_id: text(),
    sports_source_game_id: text(),
    sports_source_league_id: text(),
    sports_source_league_label: text(),
    sports_source_match_confidence: numeric({ precision: 6, scale: 4 }),
    sports_source_payload: jsonb(),
    sports_source_selected_at: timestamp({ withTimezone: true }),
    created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sourceConfidenceCheck: check(
      'event_sports_source_match_confidence_range',
      sql`${table.sports_source_match_confidence} IS NULL OR (${table.sports_source_match_confidence} >= 0 AND ${table.sports_source_match_confidence} <= 1)`,
    ),
    sourceEventIdx: index('idx_event_sports_source_event').on(
      table.sports_source_provider,
      table.sports_source_event_id,
    ),
    sourceGameIdx: index('idx_event_sports_source_game').on(table.sports_source_provider, table.sports_source_game_id),
    sourceLeagueIdx: index('idx_event_sports_source_league').on(
      table.sports_source_provider,
      table.sports_source_league_id,
    ),
  }),
)

export const market_sports = pgTable(
  'market_sports',
  {
    condition_id: text()
      .primaryKey()
      .references(() => markets.condition_id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    event_id: char({ length: 26 }).references(() => events.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    sports_market_type: text(),
    sports_line: numeric({ precision: 20, scale: 8 }),
    sports_group_item_title: text(),
    sports_group_item_threshold: text(),
    sports_game_start_time: timestamp({ withTimezone: true }),
    sports_event_id: bigint({ mode: 'number' }),
    sports_parent_event_id: bigint({ mode: 'number' }),
    sports_game_id: bigint({ mode: 'number' }),
    sports_event_date: date(),
    sports_start_time: timestamp({ withTimezone: true }),
    sports_series_color: text(),
    sports_event_slug: text(),
    sports_teams: jsonb(),
    sports_team_logo_urls: jsonb(),
    sports_source_provider: text(),
    sports_source_event_id: text(),
    sports_source_game_id: text(),
    sports_source_league_id: text(),
    sports_source_league_label: text(),
    sports_source_market_id: text(),
    sports_source_match_confidence: numeric({ precision: 6, scale: 4 }),
    sports_source_payload: jsonb(),
    created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sourceConfidenceCheck: check(
      'market_sports_source_match_confidence_range',
      sql`${table.sports_source_match_confidence} IS NULL OR (${table.sports_source_match_confidence} >= 0 AND ${table.sports_source_match_confidence} <= 1)`,
    ),
    sourceEventIdx: index('idx_market_sports_source_event').on(
      table.sports_source_provider,
      table.sports_source_event_id,
    ),
    sourceGameIdx: index('idx_market_sports_source_game').on(table.sports_source_provider, table.sports_source_game_id),
    sourceLeagueIdx: index('idx_market_sports_source_league').on(
      table.sports_source_provider,
      table.sports_source_league_id,
    ),
  }),
)

export const sports_menu_items = pgTable('sports_menu_items', {
  id: text().primaryKey(),
  item_type: text().notNull(),
  label: text(),
  href: text(),
  icon_url: text(),
  parent_id: text(),
  menu_slug: text(),
  h1_title: text(),
  mapped_tags: jsonb()
    .notNull()
    .default(sql`'[]'::jsonb`),
  url_aliases: jsonb()
    .notNull()
    .default(sql`'[]'::jsonb`),
  games_enabled: boolean().notNull().default(true),
  props_enabled: boolean().notNull().default(true),
  sort_order: integer().notNull().default(0),
  enabled: boolean().notNull().default(true),
  sidebar_category: boolean().notNull().default(false),
  sidebar_enabled: boolean().notNull().default(false),
  sidebar_featured: boolean().notNull().default(false),
  sidebar_sort_order: integer().notNull().default(0),
  created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
})

export const outcomes = pgTable('outcomes', {
  condition_id: text()
    .notNull()
    .references(() => conditions.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
  outcome_text: text().notNull(),
  outcome_index: smallint().notNull(),
  token_id: text().notNull().primaryKey(),
  polymarket_token_id: text(),
  is_winning_outcome: boolean().default(false),
  payout_value: numeric({ precision: 20, scale: 6 }),
  created_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp({ withTimezone: true }).defaultNow().notNull(),
})

export const tags = pgTable('tags', {
  id: smallint().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull().unique(),
  slug: text().notNull().unique(),
  is_main_category: boolean().default(false),
  is_hidden: boolean().notNull().default(false),
  hide_events: boolean().notNull().default(false),
  event_page_note: text(),
  display_order: smallint().default(0),
  active_markets_count: integer().default(0),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

export const tag_translations = pgTable(
  'tag_translations',
  {
    tag_id: smallint()
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    locale: text().notNull(),
    name: text().notNull(),
    source_hash: text(),
    is_manual: boolean().notNull().default(false),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tag_id, table.locale] }),
  }),
)

export const event_tags = pgTable('event_tags', {
  event_id: char({ length: 26 })
    .notNull()
    .references(() => events.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
  tag_id: smallint()
    .notNull()
    .references(() => tags.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
})

export const v_main_tag_subcategories = pgView('v_main_tag_subcategories', {
  main_tag_id: integer(),
  main_tag_slug: text(),
  main_tag_name: text(),
  main_tag_is_hidden: boolean(),
  sub_tag_id: integer(),
  sub_tag_name: text(),
  sub_tag_slug: text(),
  sub_tag_is_main_category: boolean(),
  sub_tag_is_hidden: boolean(),
  active_markets_count: integer(),
  last_market_activity_at: timestamp(),
}).existing()
