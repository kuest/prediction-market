'use client'

import type { Route } from 'next'

import { MoveRightIcon } from 'lucide-react'

import type { BiggestWinEntry } from '@/app/[locale]/(platform)/leaderboard/_utils/leaderboardTypes'

import { BiggestWinsSkeleton } from '@/app/[locale]/(platform)/leaderboard/_components/LeaderboardSkeletons'
import {
  resolveLeaderboardProxyWallet,
  resolveNumber,
  resolveString,
} from '@/app/[locale]/(platform)/leaderboard/_utils/leaderboardApi'
import { formatValueOrDash } from '@/app/[locale]/(platform)/leaderboard/_utils/leaderboardFormatters'
import { useLeaderboardTranslations } from '@/app/[locale]/(platform)/leaderboard/_utils/leaderboardTranslations'
import ProfileLink from '@/components/ProfileLink'
import { Link } from '@/i18n/navigation'
import { buildPublicProfilePath } from '@/lib/platform-routing'
import { cn } from '@/lib/utils'

interface BiggestWinsSidebarProps {
  biggestWins: BiggestWinEntry[]
  isBiggestWinsLoading: boolean
  biggestWinsPeriodLabel: string
}

export default function BiggestWinsSidebar({
  biggestWins,
  isBiggestWinsLoading,
  biggestWinsPeriodLabel,
}: BiggestWinsSidebarProps) {
  const { translateBiggestWins } = useLeaderboardTranslations()

  return (
    <aside
      className={cn(
        `w-full overflow-hidden rounded-2xl border bg-background shadow-md lg:sticky lg:top-35 lg:h-fit lg:self-start`,
      )}
    >
      <div className="max-h-152 min-h-88 overflow-y-auto">
        <div className="sticky top-0 z-10 bg-background px-6 pt-6 pb-2">
          <h2 className="text-xl font-semibold text-foreground">{translateBiggestWins(biggestWinsPeriodLabel)}</h2>
        </div>
        <div className="w-full px-5">
          {isBiggestWinsLoading && <BiggestWinsSkeleton count={6} />}

          {!isBiggestWinsLoading &&
            biggestWins.map((entry, index) => {
              const rowKey = [
                resolveLeaderboardProxyWallet(entry) || entry.userName || '',
                entry.winRank ?? entry.rank ?? index,
              ].join('-')
              return <BiggestWinRow key={rowKey} entry={entry} index={index} />
            })}
        </div>
      </div>
    </aside>
  )
}

function BiggestWinRow({ entry, index }: { entry: BiggestWinEntry; index: number }) {
  const record = entry as Record<string, unknown>
  const rank = entry.winRank ?? entry.rank ?? index + 1
  const address = resolveLeaderboardProxyWallet(entry)
  const rawUsername = resolveString(record, [
    'user.userName',
    'user.username',
    'user.name',
    'user.pseudonym',
    'userName',
    'username',
    'name',
    'pseudonym',
    'xUsername',
  ])
  const isWalletAlias = rawUsername.startsWith('0x') && rawUsername.includes('...')
  const username = (isWalletAlias && address ? address : rawUsername) || address
  const profileImage = resolveString(record, [
    'user.profileImage',
    'user.profile_image',
    'user.image',
    'profileImage',
    'profile_image',
    'avatar',
  ])
  const eventTitle = resolveString(record, ['event.title', 'event.name', 'eventTitle', 'event_name', 'title'])
  const eventSlug = resolveString(record, ['event.slug', 'eventSlug', 'event_slug', 'slug'])
  const marketSlug = resolveString(record, ['market.slug', 'marketSlug', 'market_slug'])
  const amountIn = resolveNumber(record, [
    'initialValue',
    'initial_value',
    'amountIn',
    'amount_in',
    'amountPaid',
    'amount_paid',
    'paid',
    'buy',
    'cost',
    'entryValue',
    'entry_value',
    'investment',
    'usdIn',
    'usd_in',
  ])
  const amountOut = resolveNumber(record, [
    'finalValue',
    'final_value',
    'amountOut',
    'amount_out',
    'amountReceived',
    'amount_received',
    'received',
    'payout',
    'payoutAmount',
    'payout_amount',
    'won',
    'winnings',
    'return',
    'exitValue',
    'exit_value',
    'usdOut',
    'usd_out',
  ])

  const profileSlug = address || username
  const profileHref = profileSlug ? (buildPublicProfilePath(profileSlug) ?? undefined) : undefined
  const eventHref = eventSlug ? (marketSlug ? `/event/${eventSlug}/${marketSlug}` : `/event/${eventSlug}`) : null

  const amountInLabel = formatValueOrDash(amountIn)
  const amountOutLabel = formatValueOrDash(amountOut)
  const amountInClass = Number.isFinite(amountIn) ? 'text-foreground' : 'text-muted-foreground'
  const amountOutClass = Number.isFinite(amountOut) ? 'text-yes' : 'text-muted-foreground'

  return (
    <div className="flex w-full items-center gap-3 border-b border-border/80 py-4 last:border-b-0">
      <span className="w-5 shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">{rank}</span>
      <div className="min-w-0 flex-1">
        <ProfileLink
          user={{
            image: profileImage,
            username,
            address,
          }}
          profileSlug={profileSlug}
          profileHref={profileHref}
          layout="stacked"
          tooltipTrigger="avatar-username"
          containerClassName="items-center gap-3 [&_[data-avatar]]:h-8 [&_[data-avatar]]:w-8"
          avatarSize={32}
          usernameClassName="text-sm font-medium text-foreground underline-offset-2 hover:underline"
          usernameMaxWidthClassName="max-w-[9ch]"
          usernameAddon={
            eventTitle ? (
              <span className="inline-flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
                <span className="shrink-0">|</span>
                {eventHref ? (
                  <Link
                    href={eventHref as Route}
                    className={cn(
                      `block max-w-[20ch] truncate text-muted-foreground transition-colors hover:text-foreground hover:underline`,
                    )}
                    title={eventTitle}
                  >
                    {eventTitle}
                  </Link>
                ) : (
                  <span className="block max-w-[23ch] truncate">{eventTitle}</span>
                )}
              </span>
            ) : null
          }
        >
          <div className="flex w-full items-center gap-2 text-xs">
            <span className={amountInClass}>{amountInLabel}</span>
            <MoveRightIcon className="size-4 text-muted-foreground" />
            <span className={cn('font-medium', amountOutClass)}>{amountOutLabel}</span>
          </div>
        </ProfileLink>
      </div>
    </div>
  )
}
