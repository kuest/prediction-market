import PublicPositionsLoadingState from '@/app/[locale]/(platform)/profile/_components/PublicPositionsLoadingState'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { tableHeaderClass } from '@/lib/constants'
import { cn } from '@/lib/utils'

export function PortfolioOverviewSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="relative h-full overflow-hidden rounded-lg bg-background">
        <CardContent className="relative flex h-full flex-col gap-2 p-3 sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <Skeleton className="h-5 w-24" />
              <div className="flex items-center gap-2">
                <Skeleton className="w-32 text-3xl/tight sm:text-4xl" style={{ height: '1lh' }} />
                <Skeleton className="size-8 rounded-full" />
              </div>
              <Skeleton className="h-5 w-44" />
            </div>
            <div className="flex shrink-0 flex-col items-end">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="w-24 text-xl sm:text-2xl" style={{ height: '1lh' }} />
            </div>
          </div>
          <div className="mt-auto pt-1">
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-11 rounded-md" />
              <Skeleton className="h-11 rounded-md" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="relative h-full overflow-hidden rounded-lg bg-background">
        <CardContent className="relative flex h-full flex-col gap-2.5 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3 sm:gap-4">
            <div className="flex items-center gap-2">
              <Skeleton className="size-4" />
              <Skeleton className="h-6 w-24" />
            </div>
            <div className="flex items-center gap-2">
              {[0, 1, 2, 3].map((index) => (
                <Skeleton key={index} className="h-8 w-10 rounded-md" />
              ))}
            </div>
          </div>
          <div className="flex items-start justify-between gap-3 sm:gap-4">
            <div className="space-y-2">
              <Skeleton className="w-28 text-2xl leading-none sm:text-3xl" style={{ height: '1lh' }} />
              <Skeleton className="h-5 w-24" />
            </div>
            <Skeleton className="h-7 w-20" />
          </div>
          <Skeleton className="mt-auto h-12 w-full rounded-md sm:h-18" />
        </CardContent>
      </Card>
    </div>
  )
}

export function PortfolioWinningsSkeleton() {
  return (
    <Card className="relative z-0 w-full rounded-lg border bg-transparent">
      <CardContent className="flex flex-nowrap items-center justify-between gap-2 p-3 sm:gap-4 sm:pl-4 md:gap-6 md:py-4 md:pr-4 md:pl-6">
        <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-5">
          <Skeleton className="h-10 w-14 shrink-0 sm:ml-2 sm:h-12 sm:w-17" />
          <div className="min-w-0 flex-1 sm:pl-2">
            <Skeleton className="h-5 w-32 max-w-full sm:h-6" />
          </div>
        </div>
        <Skeleton className="h-9 w-18 shrink-0 rounded-md sm:h-10 sm:w-22" />
      </CardContent>
    </Card>
  )
}

interface PortfolioPositionsSkeletonProps {
  labels: [string, string, string]
  filterLabels: [string, string, string]
}

export function PortfolioPositionsSkeleton({ labels, filterLabels }: PortfolioPositionsSkeletonProps) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="relative">
        <div className="flex items-center justify-start gap-6 px-4 pt-4 text-sm font-semibold sm:px-6">
          {labels.map((label, index) => (
            <span key={label} className={cn('relative pb-3 whitespace-nowrap', index > 0 && 'text-muted-foreground')}>
              {label}
              {index === 0 && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-foreground" />}
            </span>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-border/80" />
      </div>

      <div className="space-y-3 pt-4">
        <div className="px-2 pt-2 sm:px-3">
          <div className="flex items-center gap-2 sm:gap-3">
            <Skeleton className="h-9 min-w-0 flex-1" />
            <div className="flex shrink-0 items-center gap-2">
              <Skeleton className="flex h-9 items-center gap-1 p-0.5" aria-hidden>
                {filterLabels.slice(0, 2).map((label) => (
                  <span key={label} className="invisible px-2.5 text-xs font-medium sm:px-3 sm:text-sm">
                    {label}
                  </span>
                ))}
              </Skeleton>
              <Skeleton
                className="flex h-9 w-9 items-center justify-center border border-transparent sm:w-fit sm:gap-1.5 sm:px-2.5"
                aria-hidden
              >
                <span className="invisible size-4 shrink-0" />
                <span className="invisible hidden text-sm whitespace-nowrap sm:block">{filterLabels[2]}</span>
              </Skeleton>
            </div>
          </div>
        </div>
        <div className="relative w-full overflow-x-auto">
          <table className="w-full min-w-[1000px] table-fixed border-collapse">
            <thead>
              <tr className="border-b">
                {['w-[32%]', 'w-[14%]', 'w-[11%]', 'w-[11%]', 'w-[12%]', 'w-35'].map((width, index) => (
                  <th key={index} className={cn(tableHeaderClass, width)}>
                    <div className="px-2 py-1">
                      <Skeleton className={cn('h-4 w-16', index > 0 && 'mx-auto', index === 4 && 'mr-0')} />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
          </table>
          <PublicPositionsLoadingState skeletonCount={5} />
        </div>
      </div>
    </div>
  )
}
