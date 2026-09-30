'use client'

import { useQuery } from '@tanstack/react-query'
import { CheckIcon, CopyIcon, TriangleAlertIcon } from 'lucide-react'
import { useExtracted } from 'next-intl'
import Image from 'next/image'
import { useState } from 'react'

import { Button, buttonVariants } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { toast } from '@/components/ui/toast'
import { usePublicRuntimeConfig } from '@/hooks/usePublicRuntimeConfig'

const UPSTREAM_COMMITS_URL = 'https://api.github.com/repos/kuest/prediction-market/commits?per_page=1'
const GITHUB_SYNC_IMAGE_SRC = '/images/sync/github-sync.jpg'
const UPSTREAM_COMMIT_QUERY_STALE_TIME_MS = 60 * 60 * 1000
const UPSTREAM_COMMIT_WARNING_MIN_AGE_MS = 8 * 60 * 60 * 1000

interface GitHubCommitResponse {
  commit?: {
    author?: {
      date?: unknown
    }
    committer?: {
      date?: unknown
    }
  }
  sha?: unknown
}

interface UpstreamCommit {
  committedAtMs: number | null
  sha: string
}

interface CopyVersionProps {
  forkRepositoryUrl: string | null
}

interface ForkSyncWarningProps {
  currentCommitSha: string
  forkRepositoryUrl: string | null
  upstreamCommitSha: string
}

function normalizeUpstreamCommitSha(sha: unknown) {
  if (typeof sha !== 'string') {
    return null
  }

  const trimmedSha = sha.trim()

  if (!trimmedSha) {
    return null
  }

  return trimmedSha.toLowerCase()
}

function parseCommitDateMs(date: unknown) {
  if (typeof date !== 'string') {
    return null
  }

  const timestamp = Date.parse(date)

  return Number.isFinite(timestamp) ? timestamp : null
}

async function fetchLatestUpstreamCommit({ signal }: { signal?: AbortSignal } = {}) {
  const response = await fetch(UPSTREAM_COMMITS_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
    },
    signal,
  }).catch(() => null)

  if (!response?.ok) {
    return null
  }

  const commits: unknown = await response.json().catch(() => null)

  if (!Array.isArray(commits)) {
    return null
  }

  const [latestCommit] = commits as GitHubCommitResponse[]
  const sha = normalizeUpstreamCommitSha(latestCommit?.sha)

  if (!sha) {
    return null
  }

  return {
    committedAtMs:
      parseCommitDateMs(latestCommit?.commit?.committer?.date) ?? parseCommitDateMs(latestCommit?.commit?.author?.date),
    sha,
  } satisfies UpstreamCommit
}

function isUpstreamCommitOldEnough(upstreamCommit: UpstreamCommit) {
  return (
    upstreamCommit.committedAtMs !== null &&
    Date.now() - upstreamCommit.committedAtMs >= UPSTREAM_COMMIT_WARNING_MIN_AGE_MS
  )
}

function shouldShowForkSyncWarning(
  upstreamCommit: UpstreamCommit | null | undefined,
  normalizedCommitSha: string,
): upstreamCommit is UpstreamCommit {
  return Boolean(
    upstreamCommit &&
    normalizedCommitSha !== 'unknown' &&
    !upstreamCommit.sha.startsWith(normalizedCommitSha) &&
    isUpstreamCommitOldEnough(upstreamCommit),
  )
}

function ForkSyncWarning({ currentCommitSha, forkRepositoryUrl, upstreamCommitSha }: ForkSyncWarningProps) {
  const t = useExtracted()
  const title = t('Fork is behind upstream')
  const syncForkLabel = t('Sync fork')

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={0}
        closeDelay={150}
        render={
          <Button
            type="button"
            variant="ghost"
            aria-label={title}
            size="sm"
            className="text-amber-500 dark:text-amber-400"
          >
            <TriangleAlertIcon aria-hidden />
          </Button>
        }
      />
      <PopoverContent side="top" align="start" className="w-80 max-w-[calc(100vw-2rem)] p-3 text-left font-normal">
        <div className="space-y-3">
          <div className="space-y-1">
            <PopoverTitle className="text-sm font-semibold text-foreground">{title}</PopoverTitle>
            <PopoverDescription className="text-xs text-muted-foreground">
              {t('Your fork is not synced with the latest Kuest version. Open your project on GitHub and click')}{' '}
              {forkRepositoryUrl ? (
                <a
                  href={forkRepositoryUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonVariants({
                    variant: 'link',
                    size: 'sm',
                    className: 'h-6 px-0 align-baseline text-xs font-bold',
                  })}
                >
                  {syncForkLabel}
                </a>
              ) : (
                <strong className="font-bold text-foreground">{syncForkLabel}</strong>
              )}
              .
            </PopoverDescription>
          </div>
          <div className="overflow-hidden rounded-md border bg-muted">
            <Image
              src={GITHUB_SYNC_IMAGE_SRC}
              width={544}
              height={278}
              sizes="320px"
              alt={t('GitHub Sync fork button')}
              className="size-full"
            />
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-sm bg-muted px-2 py-1.5 text-[11px] text-muted-foreground">
            <dt>{t('Current')}</dt>
            <dd className="truncate text-right font-mono text-foreground">{currentCommitSha}</dd>
            <dt>{t('Upstream')}</dt>
            <dd className="truncate text-right font-mono text-foreground">
              {upstreamCommitSha.slice(0, currentCommitSha.length)}
            </dd>
          </dl>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default function CopyVersion({ forkRepositoryUrl }: CopyVersionProps) {
  const [copied, setCopied] = useState(false)
  const t = useExtracted()
  const { commitSha, isVercel, siteUrl } = usePublicRuntimeConfig()
  const normalizedCommitSha = commitSha.toLowerCase()
  const latestUpstreamCommitQuery = useQuery({
    queryKey: ['github-upstream-commit-sha', UPSTREAM_COMMITS_URL],
    queryFn: fetchLatestUpstreamCommit,
    enabled: normalizedCommitSha !== 'unknown' && isVercel === 'true',
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: UPSTREAM_COMMIT_QUERY_STALE_TIME_MS,
  })
  const latestUpstreamCommit = latestUpstreamCommitQuery.data
  const upstreamCommitForWarning = shouldShowForkSyncWarning(latestUpstreamCommit, normalizedCommitSha)
    ? latestUpstreamCommit
    : null

  async function copyVersionPayload() {
    const payload = `{${[commitSha, siteUrl, isVercel, new Date().toISOString()].join(';')}}`

    try {
      await navigator.clipboard.writeText(payload)
      setCopied(true)
      window.setTimeout(setCopied, 2000, false)
    } catch {
      toast.error(t('Failed to copy version'))
    }
  }

  return (
    <div className="bottom-2 mt-4 flex items-center gap-1 text-muted-foreground lg:fixed">
      {upstreamCommitForWarning && (
        <ForkSyncWarning
          currentCommitSha={commitSha}
          forkRepositoryUrl={forkRepositoryUrl}
          upstreamCommitSha={upstreamCommitForWarning.sha}
        />
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="group font-mono"
        title={copied ? 'Copied' : 'Copy version payload'}
        onClick={() => void copyVersionPayload()}
      >
        v.
        {commitSha}
        {copied ? (
          <CheckIcon className="text-yes" />
        ) : (
          <CopyIcon className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
        )}
      </Button>
    </div>
  )
}
