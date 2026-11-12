import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { DataPoint } from '@/types/PredictionChartTypes'

import { usePublicRuntimeConfig } from '@/hooks/usePublicRuntimeConfig'
import {
  closeWebSocketWhenReady,
  createWebSocketHeartbeatController,
  createWebSocketReconnectController,
  probeWebSocketWithPong,
} from '@/lib/websocket-reconnect'

import {
  appendLivePriceTransition,
  extractLivePriceUpdates,
  isSnapshotMessage,
  keepWithinLiveWindow,
  livePriceFeedKey,
  LIVE_IDLE_RECOVERY_DISPLAY_MS,
  LIVE_DATA_RETENTION_MS,
  LIVE_PRICE_TRANSITION_MS,
  LIVE_WINDOW_MS,
  MAX_POINTS,
  normalizeLiveChartPrice,
  resolveLiveSeriesIdleRecoverySpan,
  resolveLivePriceTransitionDuration,
  SERIES_KEY,
  shouldResetLiveSeriesAfterIdle,
  writePersistedLivePrice,
} from '../_utils/eventLiveSeriesChartUtils'

interface UseLiveSeriesWebSocketOptions {
  topic: string
  provider: string | null
  windowSeconds: number | null
  eventEndTimestamp: number | null
  subscriptionSymbol: string
  isLiveView: boolean
}

interface LiveSeriesIdleRecovery {
  version: number
  priceSpan: number | null
}

export function useLiveSeriesWebSocket({
  topic,
  provider,
  windowSeconds,
  eventEndTimestamp,
  subscriptionSymbol,
  isLiveView,
}: UseLiveSeriesWebSocketOptions) {
  const { wsLiveDataUrl } = usePublicRuntimeConfig()
  const wsUrl = wsLiveDataUrl
  const storageKey = livePriceFeedKey({ topic, provider, window_seconds: windowSeconds })
  const eventEndTimestampRef = useRef(eventEndTimestamp)
  const [data, setData] = useState<DataPoint[]>([])
  const [feedUnavailable, setFeedUnavailable] = useState(false)
  const [marketStatus, setMarketStatus] = useState<'open' | 'closed' | 'unknown' | null>(null)
  const [idleRecovery, setIdleRecovery] = useState<LiveSeriesIdleRecovery | null>(null)
  const [idleRecoveryVersion, setIdleRecoveryVersion] = useState(0)
  const [resumedAtTimestamp, setResumedAtTimestamp] = useState<number | null>(null)
  const [status, setStatus] = useState<'connecting' | 'live' | 'offline'>(() => (wsUrl ? 'connecting' : 'offline'))

  useEffect(
    function syncEventEndTimestampRef() {
      eventEndTimestampRef.current = eventEndTimestamp
    },
    [eventEndTimestamp],
  )

  useLayoutEffect(
    function connectLiveSeriesWebSocket() {
      if (!isLiveView) {
        return
      }

      if (!wsUrl) {
        return
      }
      // Intentionally keep WS active regardless of event close to preserve always-live behavior.
      const resolvedWsUrl = wsUrl

      let isActive = true
      let ws: WebSocket | null = null
      let lastSequence: number | null = null
      let subscriptionRejected = false
      let previousPriceMessageTimestamp: number | null = null
      let lastMessageArrivalTimestamp: number | null = null
      let latestKnownPrice: number | null = null
      let hiddenAtTimestamp: number | null = document.hidden ? Date.now() : null
      let idleRecoveryRequested = false
      let idleRecoveryUntilTimestamp: number | null = null
      let idleRecoveryVersion = 0
      let idleRecoveryClearTimeout: number | null = null
      let pendingRecoveryUpdate: { price: number; timestamp: number } | null = null
      let recoveryLatestSourceTimestamp: number | null = null
      let lastRecoveredSourceTimestamp: number | null = null

      function clearIdleRecoveryTimer() {
        if (idleRecoveryClearTimeout == null) {
          return
        }

        window.clearTimeout(idleRecoveryClearTimeout)
        idleRecoveryClearTimeout = null
      }

      function startIdleRecovery(currentPrice: number, recoveryTimestamp: number) {
        idleRecoveryVersion += 1
        idleRecoveryUntilTimestamp = recoveryTimestamp + LIVE_IDLE_RECOVERY_DISPLAY_MS
        setIdleRecoveryVersion(idleRecoveryVersion)
        setIdleRecovery({
          version: idleRecoveryVersion,
          priceSpan: resolveLiveSeriesIdleRecoverySpan(latestKnownPrice, currentPrice),
        })
        clearIdleRecoveryTimer()
        idleRecoveryClearTimeout = window.setTimeout(() => {
          idleRecoveryClearTimeout = null
          idleRecoveryUntilTimestamp = null
          if (pendingRecoveryUpdate != null) {
            const update = pendingRecoveryUpdate
            pendingRecoveryUpdate = null
            const timestamp = Date.now()
            setData((prev) =>
              appendLivePriceTransition(
                keepWithinLiveWindow(prev, timestamp - LIVE_DATA_RETENTION_MS),
                update.price,
                timestamp,
              ),
            )
            writePersistedLivePrice(storageKey, subscriptionSymbol, update.price, update.timestamp)
          }
          lastRecoveredSourceTimestamp = recoveryLatestSourceTimestamp
          recoveryLatestSourceTimestamp = null
          setIdleRecovery(null)
        }, LIVE_IDLE_RECOVERY_DISPLAY_MS)
      }

      function buildSubscriptionPayload(action: 'subscribe' | 'unsubscribe') {
        return JSON.stringify({
          op: action,
          subscriptions: [
            {
              channel: topic,
              filter: {
                symbol: subscriptionSymbol,
                ...(provider ? { provider } : {}),
                ...(windowSeconds != null ? { window_seconds: windowSeconds } : {}),
              },
            },
          ],
        })
      }

      function handleOpen(socket: WebSocket) {
        if (ws !== socket) {
          return
        }
        lastSequence = null
        setFeedUnavailable(false)
        setMarketStatus(null)
        reconnectController?.markConnected()
        heartbeatController?.markOpen(socket)
        setStatus('connecting')
        socket.send(buildSubscriptionPayload('subscribe'))
      }

      function handleMessage(socket: WebSocket, eventMessage: MessageEvent<string>) {
        if (!isActive || ws !== socket) {
          return
        }
        const arrivalTimestamp = Date.now()

        if (document.hidden) {
          heartbeatController?.markActivity(socket, arrivalTimestamp)
          return
        }

        let payload: any
        try {
          payload = JSON.parse(eventMessage.data)
        } catch {
          return
        }

        if (payload.op === 'pong') {
          heartbeatController?.markActivity(socket, arrivalTimestamp)
          return
        }
        const acknowledgedFilter = payload.filter
        const invalidAcknowledgment =
          payload.op === 'subscribed' &&
          (payload.channel !== topic ||
            (acknowledgedFilter?.symbol != null && acknowledgedFilter.symbol !== subscriptionSymbol) ||
            (provider != null &&
              ((payload.provider != null && payload.provider !== provider) ||
                (acknowledgedFilter?.provider != null && acknowledgedFilter.provider !== provider))) ||
            (windowSeconds != null && acknowledgedFilter?.window_seconds !== windowSeconds))
        if (payload.op === 'error' || invalidAcknowledgment) {
          subscriptionRejected =
            invalidAcknowledgment || payload.code === 'bad_filter' || payload.code === 'source_mismatch'
          setStatus('offline')
          setFeedUnavailable(subscriptionRejected)
          setMarketStatus(null)
          setData([])
          heartbeatController?.clear()
          ws = null
          closeWebSocketWhenReady(socket)
          if (!subscriptionRejected) {
            scheduleReconnect()
          }
          return
        }
        if (payload.op === 'subscribed') {
          heartbeatController?.markActivity(socket, arrivalTimestamp)
          return
        }
        if (payload.v !== 1 || payload.channel !== topic) {
          return
        }
        if (!Number.isSafeInteger(payload.seq) || payload.seq < 1) {
          return
        }
        if (payload.dropped || (lastSequence != null && payload.seq !== lastSequence + 1)) {
          idleRecoveryRequested = true
          setData([])
          setStatus('connecting')
          heartbeatController?.clear()
          ws = null
          closeWebSocketWhenReady(socket)
          scheduleReconnect()
          return
        }
        lastSequence = payload.seq
        const activeEventEndTimestamp = eventEndTimestampRef.current
        const updates = extractLivePriceUpdates(payload, topic, subscriptionSymbol, provider, windowSeconds)
        const normalizedUpdates = updates
          .map((update) => {
            const normalizedPrice = normalizeLiveChartPrice(update.price, topic)
            if (normalizedPrice == null) {
              return null
            }

            return {
              ...update,
              price: normalizedPrice,
            }
          })
          .filter((update): update is { price: number; timestamp: number; symbol: string | null } => update !== null)
          .filter((update) => activeEventEndTimestamp == null || update.timestamp <= activeEventEndTimestamp)

        const messageIsSnapshot = isSnapshotMessage(payload)
        const wsUpdatesForRender = messageIsSnapshot ? normalizedUpdates : normalizedUpdates.slice(-1)

        if (!wsUpdatesForRender.length) {
          return
        }
        heartbeatController?.markActivity(socket, arrivalTimestamp)
        const sourceMarketStatus = payload.payload?.market_status
        setMarketStatus(
          sourceMarketStatus === 'open' || sourceMarketStatus === 'closed' || sourceMarketStatus === 'unknown'
            ? sourceMarketStatus
            : null,
        )

        const latest = wsUpdatesForRender.at(-1)
        if (!latest) {
          return
        }
        const restoresClearedWindow =
          idleRecoveryRequested && messageIsSnapshot && latest.timestamp === lastRecoveredSourceTimestamp
        if (lastRecoveredSourceTimestamp != null) {
          if (
            latest.timestamp < lastRecoveredSourceTimestamp ||
            (latest.timestamp === lastRecoveredSourceTimestamp &&
              latest.price === latestKnownPrice &&
              !restoresClearedWindow)
          ) {
            return
          }
          if (!restoresClearedWindow) {
            lastRecoveredSourceTimestamp = latest.timestamp
          }
        }

        function currentWindowPoints() {
          return wsUpdatesForRender
            .filter(
              (update) => update.timestamp > arrivalTimestamp - LIVE_WINDOW_MS && update.timestamp <= arrivalTimestamp,
            )
            .map((update) => ({ date: new Date(update.timestamp), [SERIES_KEY]: update.price }))
            .slice(-MAX_POINTS)
        }

        if (restoresClearedWindow) {
          idleRecoveryRequested = false
          lastMessageArrivalTimestamp = arrivalTimestamp
          latestKnownPrice = latest.price
          setStatus('live')
          setData(currentWindowPoints)
          return
        }

        const idleGapDetected = shouldResetLiveSeriesAfterIdle(
          lastMessageArrivalTimestamp,
          arrivalTimestamp,
          LIVE_DATA_RETENTION_MS,
        )
        const idleRecoveryIsActive = idleRecoveryUntilTimestamp != null && arrivalTimestamp < idleRecoveryUntilTimestamp
        const shouldReanchorAfterIdle = idleRecoveryRequested || idleGapDetected || idleRecoveryIsActive

        if (idleRecoveryRequested || idleGapDetected) {
          if (!idleRecoveryIsActive) {
            startIdleRecovery(latest.price, arrivalTimestamp)
            recoveryLatestSourceTimestamp = latest.timestamp
          }
          idleRecoveryRequested = false
        }

        lastMessageArrivalTimestamp = arrivalTimestamp
        latestKnownPrice = latest.price

        if (idleRecoveryIsActive && !messageIsSnapshot) {
          // Collapse queued ticks to the newest source value during the resume window.
          if (recoveryLatestSourceTimestamp == null || latest.timestamp >= recoveryLatestSourceTimestamp) {
            pendingRecoveryUpdate = latest
            recoveryLatestSourceTimestamp = latest.timestamp
          }
          return
        }
        if (idleRecoveryIsActive) {
          pendingRecoveryUpdate = null
          recoveryLatestSourceTimestamp = latest.timestamp
        }

        const cadenceTransitionDurationMs = resolveLivePriceTransitionDuration(
          previousPriceMessageTimestamp,
          arrivalTimestamp,
        )
        const transitionStartTimestamp =
          activeEventEndTimestamp == null ? arrivalTimestamp : Math.min(arrivalTimestamp, activeEventEndTimestamp)
        const transitionDurationMs =
          activeEventEndTimestamp == null
            ? cadenceTransitionDurationMs
            : Math.min(cadenceTransitionDurationMs, Math.max(0, activeEventEndTimestamp - transitionStartTimestamp))
        previousPriceMessageTimestamp = arrivalTimestamp

        setStatus('live')
        writePersistedLivePrice(storageKey, subscriptionSymbol, latest.price, latest.timestamp)

        setData((prev) => {
          const cutoff = arrivalTimestamp - LIVE_DATA_RETENTION_MS

          if (shouldReanchorAfterIdle) {
            // A fresh subscription carries actual timestamped prices. Replace the
            // whole visible window; do not draw a flat history across the gap.
            return currentWindowPoints()
          }

          if (messageIsSnapshot) {
            let lastSnapshotTimestamp: number | null = null
            const snapshotPoints: DataPoint[] = []

            for (const update of wsUpdatesForRender) {
              let pointTimestamp = update.timestamp
              if (!Number.isFinite(pointTimestamp)) {
                continue
              }

              pointTimestamp = Math.max(cutoff + 1, Math.min(pointTimestamp, arrivalTimestamp))
              if (lastSnapshotTimestamp !== null && pointTimestamp <= lastSnapshotTimestamp) {
                pointTimestamp = lastSnapshotTimestamp + 1
              }

              snapshotPoints.push({
                date: new Date(pointTimestamp),
                [SERIES_KEY]: update.price,
              })
              lastSnapshotTimestamp = pointTimestamp
            }

            if (snapshotPoints.length > 1 || (snapshotPoints.length === 1 && prev.length === 0)) {
              return snapshotPoints.slice(-MAX_POINTS)
            }
          }

          const latestUpdate = wsUpdatesForRender.at(-1)
          if (!latestUpdate) {
            return prev
          }

          const retainedPoints = keepWithinLiveWindow(prev, cutoff)

          // Treat live values as targets. Future samples are revealed by the existing
          // 30 FPS chart clock, and a new target retakes the current visual price.
          return appendLivePriceTransition(
            retainedPoints,
            latestUpdate.price,
            transitionStartTimestamp,
            transitionDurationMs,
          )
        })
      }

      function handleError() {
        if (isActive) {
          setStatus('offline')
        }
      }

      let reconnectController: ReturnType<typeof createWebSocketReconnectController> | null = null
      let heartbeatController: ReturnType<typeof createWebSocketHeartbeatController> | null = null

      function clearReconnect() {
        reconnectController?.clearReconnect()
      }

      function handleVisibilityChange() {
        const visibilityTimestamp = Date.now()
        if (document.hidden) {
          hiddenAtTimestamp ??= visibilityTimestamp
          if (idleRecoveryUntilTimestamp != null) {
            idleRecoveryRequested = true
          }
          clearIdleRecoveryTimer()
          idleRecoveryUntilTimestamp = null
          pendingRecoveryUpdate = null
          recoveryLatestSourceTimestamp = null
          setIdleRecovery(null)
        } else {
          const hiddenDuration = hiddenAtTimestamp == null ? 0 : visibilityTimestamp - hiddenAtTimestamp
          if (hiddenDuration >= LIVE_PRICE_TRANSITION_MS || idleRecoveryRequested) {
            idleRecoveryRequested = true
            setResumedAtTimestamp(visibilityTimestamp)
            setData([])
            const previousSocket = ws
            if (previousSocket) {
              heartbeatController?.clear()
              clearReconnect()
              ws = null
              closeWebSocketWhenReady(previousSocket)
              connect()
            }
          }
          hiddenAtTimestamp = null
          previousPriceMessageTimestamp = null
          setStatus('connecting')
        }
        reconnectController?.handleVisibilityChange()
      }

      function scheduleReconnect() {
        reconnectController?.scheduleReconnect()
      }

      function handleClose(socket: WebSocket) {
        if (ws !== socket) {
          return
        }
        heartbeatController?.clear()
        if (!isActive) {
          return
        }
        setStatus('offline')
        scheduleReconnect()
      }

      function connect() {
        if (!isActive || subscriptionRejected || ws || document.hidden) {
          return
        }
        const socket = new WebSocket(resolvedWsUrl)
        socket.onopen = () => handleOpen(socket)
        socket.onmessage = (eventMessage) => handleMessage(socket, eventMessage)
        socket.onerror = handleError
        socket.onclose = () => handleClose(socket)
        ws = socket
        heartbeatController?.markConnecting(socket)
      }

      reconnectController = createWebSocketReconnectController({
        connect,
        getWebSocket: () => ws,
        isActive: () => isActive,
        probeWebSocket: (socket) =>
          probeWebSocketWithPong(socket, 5_000, '{"op":"ping"}', (data) => {
            try {
              return typeof data === 'string' && JSON.parse(data).op === 'pong'
            } catch {
              return false
            }
          }),
        resetWebSocket: () => {
          heartbeatController?.clear()
          ws = null
        },
      })
      heartbeatController = createWebSocketHeartbeatController({
        pingMessage: '{"op":"ping"}',
        getWebSocket: () => ws,
        isActive: () => isActive,
        onConnectionLost: (socket) => {
          ws = null
          setStatus('offline')
          closeWebSocketWhenReady(socket)
          scheduleReconnect()
        },
      })

      connect()
      document.addEventListener('visibilitychange', handleVisibilityChange)

      return function cleanupLiveSeriesWebSocket() {
        isActive = false
        setStatus('offline')
        clearIdleRecoveryTimer()
        idleRecoveryUntilTimestamp = null
        pendingRecoveryUpdate = null
        recoveryLatestSourceTimestamp = null
        lastRecoveredSourceTimestamp = null
        setData([])
        setIdleRecovery(null)
        setFeedUnavailable(false)
        setMarketStatus(null)
        setIdleRecoveryVersion(0)
        setResumedAtTimestamp(null)
        heartbeatController.clear()
        clearReconnect()
        document.removeEventListener('visibilitychange', handleVisibilityChange)
        const socket = ws
        if (socket) {
          socket.onopen = null
          socket.onmessage = null
          socket.onerror = null
          socket.onclose = null
          closeWebSocketWhenReady(socket, (currentSocket) => {
            currentSocket.send(buildSubscriptionPayload('unsubscribe'))
            currentSocket.close()
          })
        }
      }
    },
    [provider, windowSeconds, storageKey, topic, isLiveView, wsUrl, subscriptionSymbol],
  )

  return { data, idleRecovery, idleRecoveryVersion, resumedAtTimestamp, status, feedUnavailable, marketStatus }
}
