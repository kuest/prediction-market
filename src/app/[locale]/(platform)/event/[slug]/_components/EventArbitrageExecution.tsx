import { useExtracted } from 'next-intl'

import type { ArbitrageAttempt, ArbitrageExecution } from '@/lib/arbitrage-execution'

import { Button } from '@/components/ui/button'
import { summarizeArbitrageExecution } from '@/lib/arbitrage-execution'
import { formatSharesLabel } from '@/lib/formatters'

export default function EventArbitrageExecution({
  attempt,
  siteName,
  isChecking,
  onCheck,
  onDismiss,
}: {
  attempt: ArbitrageAttempt | null
  siteName: string
  isChecking: boolean
  onCheck: () => void
  onDismiss: () => void
}) {
  const t = useExtracted()
  if (!attempt) {
    return (
      <div className="mb-4 rounded-xl border border-border p-3 text-sm" role="status">
        <p>{t('Saved trade details could not be read. Review both positions before clearing them.')}</p>
        <Button type="button" size="sm" variant="outline" className="mt-3" disabled={isChecking} onClick={onDismiss}>
          {t('I reviewed both positions')}
        </Button>
      </div>
    )
  }
  const summary = summarizeArbitrageExecution(attempt.kuest, attempt.polymarket)
  function status(leg: ArbitrageExecution) {
    if (leg.state === 'confirmed') {
      return t('Confirmed: {shares} shares', {
        shares: formatSharesLabel(leg.shares ?? 0, { maximumFractionDigits: 6 }),
      })
    }
    if (leg.state === 'failed') {
      return t('Not filled')
    }
    return leg.state === 'pending' ? t('Confirmation pending') : t('Result unknown')
  }
  return (
    <div className="mb-4 rounded-xl border border-border p-3 text-sm" role="status">
      <p className="font-semibold">
        {summary.balanced
          ? t('Both positions are confirmed and balanced.')
          : summary.finalized
            ? t('Check the positions below before trading again.')
            : t('The trade is still being verified. Do not submit it again.')}
      </p>
      {[
        { name: siteName, leg: attempt.kuest },
        { name: 'Polymarket', leg: attempt.polymarket },
      ].map(({ name, leg }) => (
        <div key={name} className="mt-2">
          <p>
            {name}: {status(leg)}
          </p>
          {typeof leg.error === 'string' && leg.error && (
            <p className="break-words text-muted-foreground">{leg.error}</p>
          )}
          {leg.orderId && (
            <p className="break-all text-muted-foreground">
              {t('Order')}: {leg.orderId}
            </p>
          )}
        </div>
      ))}
      {summary.finalized && !summary.balanced && (summary.kuestShares > 0 || summary.polymarketShares > 0) && (
        <p className="mt-2 text-orange-500">
          {t('The positions have different quantities. No automatic trade will be sent to balance them.')}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {!summary.finalized && (attempt.kuest.orderId || attempt.polymarket.orderId) && (
          <Button type="button" size="sm" variant="outline" disabled={isChecking} onClick={onCheck}>
            {isChecking ? t('Checking status') : t('Check status')}
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" disabled={isChecking} onClick={onDismiss}>
          {summary.balanced ? t('Done') : t('I reviewed both positions')}
        </Button>
      </div>
    </div>
  )
}
