'use client'

import type { Event } from '@/types'

import SiteLogoIcon from '@/components/SiteLogoIcon'
import { useCurrentTimestamp } from '@/hooks/useCurrentTimestamp'
import { useSiteIdentity } from '@/hooks/useSiteIdentity'

import EventMetaInformation from './EventMetaInformation'

export default function EventChartSummary({ event, showWatermark = true }: { event: Event; showWatermark?: boolean }) {
  const site = useSiteIdentity()
  const currentTimestamp = useCurrentTimestamp({ intervalMs: 30_000 })

  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
      <EventMetaInformation event={event} currentTimestamp={currentTimestamp || null} />
      {showWatermark && (site.logoSvg || site.logoImageUrl || site.name) && (
        <div className="flex items-center gap-1 text-xl text-muted-foreground opacity-50 select-none">
          {(site.logoSvg || site.logoImageUrl) && (
            <SiteLogoIcon
              logoSvg={site.logoSvg ?? ''}
              logoImageUrl={site.logoImageUrl}
              alt={`${site.name} logo`}
              className="size-[1em] **:fill-current **:stroke-current"
              imageClassName="size-[1em] object-contain"
              size={20}
            />
          )}
          {site.name && <span className="font-semibold">{site.name}</span>}
        </div>
      )}
    </div>
  )
}
