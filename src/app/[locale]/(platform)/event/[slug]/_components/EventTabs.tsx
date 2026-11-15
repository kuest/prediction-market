'use client'

import dynamic from 'next/dynamic'
import { useMemo, useState } from 'react'

import type { EventTabKey } from '@/app/[locale]/(platform)/event/[slug]/_components/EventTabSelector'
import type { EventFaqItem } from '@/lib/event-faq'
import type { Event, User } from '@/types'

import EventComments from '@/app/[locale]/(platform)/event/[slug]/_components/EventComments'
import EventFaq from '@/app/[locale]/(platform)/event/[slug]/_components/EventFaq'
import { useMarketChannelStatus } from '@/app/[locale]/(platform)/event/[slug]/_components/EventMarketChannelProvider'
import EventTabSelector from '@/app/[locale]/(platform)/event/[slug]/_components/EventTabSelector'
import { useCommentMetrics } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useCommentMetrics'
import { useLiveCommentsChannel } from '@/app/[locale]/(platform)/event/[slug]/_hooks/useLiveCommentsChannel'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent } from '@/components/ui/tabs'

const EventTopHolders = dynamic(() => import('@/app/[locale]/(platform)/event/[slug]/_components/EventTopHolders'), {
  loading: () => <Skeleton className="h-52" />,
})

const EventActivity = dynamic(() => import('@/app/[locale]/(platform)/event/[slug]/_components/EventActivity'), {
  loading: () => <Skeleton className="h-52" />,
})

interface EventTabsProps {
  event: Event
  user: User | null
  faqItems: EventFaqItem[]
  initialTab?: EventTabKey
}

function useActiveTab(initialTab: EventTabKey) {
  const [activeTab, setActiveTab] = useState<EventTabKey>(initialTab)
  return { activeTab, setActiveTab }
}

function useCommentsCount(commentMetrics: ReturnType<typeof useCommentMetrics>['data']) {
  return useMemo(() => {
    if (commentMetrics?.comments_count != null) {
      return commentMetrics.comments_count
    }
    return null
  }, [commentMetrics?.comments_count])
}

export default function EventTabs({ event, user, faqItems, initialTab = 'comments' }: EventTabsProps) {
  const { activeTab, setActiveTab } = useActiveTab(initialTab)
  const { data: commentMetrics } = useCommentMetrics(event.slug)
  const { status: liveCommentsStatus } = useLiveCommentsChannel({
    eventSlug: event.slug,
    user,
    enabled: activeTab === 'comments',
  })
  const marketChannelStatus = useMarketChannelStatus()
  const commentsCount = useCommentsCount(commentMetrics)

  return (
    <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as EventTabKey)} className="mt-6">
      <EventTabSelector
        activeTab={activeTab}
        commentsCount={commentsCount}
        liveCommentsStatus={liveCommentsStatus}
        marketChannelStatus={marketChannelStatus}
      />
      <TabsContent value="comments" className="mt-0">
        <EventComments event={event} user={user} />
        <EventFaq items={faqItems} />
      </TabsContent>
      <TabsContent value="holders" className="mt-0">
        {activeTab === 'holders' && <EventTopHolders event={event} />}
      </TabsContent>
      <TabsContent value="activity" className="mt-0">
        {activeTab === 'activity' && <EventActivity event={event} />}
      </TabsContent>
    </Tabs>
  )
}
