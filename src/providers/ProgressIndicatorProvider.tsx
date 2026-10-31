'use client'

import type { ReactNode } from 'react'

import { useEffect, useRef } from 'react'

import { subscribeNavigationProgress } from '@/lib/navigation-progress'

import './progress-indicator.css'

function ProgressIndicatorProvider({ children }: { children: ReactNode }) {
  const bar = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = bar.current
    if (!element) {
      return
    }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let active: symbol | undefined
    let delay: ReturnType<typeof setTimeout> | undefined
    let fade: ReturnType<typeof setTimeout> | undefined
    let hide: ReturnType<typeof setTimeout> | undefined
    let watchdog: ReturnType<typeof setTimeout> | undefined
    let trickle: ReturnType<typeof setInterval> | undefined
    let progress = 0

    function clearTimers() {
      clearTimeout(delay)
      clearTimeout(fade)
      clearTimeout(hide)
      clearTimeout(watchdog)
      clearInterval(trickle)
    }

    function reset() {
      clearTimers()
      active = undefined
      element!.hidden = true
      element!.style.opacity = '0'
      element!.style.transform = 'translateX(-100%)'
    }

    function finish() {
      clearTimers()
      active = undefined
      if (element!.hidden) {
        return
      }
      element!.style.transform = 'translateX(0)'
      fade = setTimeout(() => {
        element!.style.opacity = '0'
        hide = setTimeout(reset, 200)
      }, 200)
    }

    const unsubscribe = subscribeNavigationProgress(({ token, pending }) => {
      if (!pending) {
        if (active === token) {
          finish()
        }
        return
      }

      const wasVisible = !element.hidden
      clearTimers()
      active = token
      // Retain visible progress when a second navigation supersedes the first.
      if (wasVisible) {
        element.style.opacity = '1'
      }
      delay = setTimeout(
        () => {
          progress = wasVisible ? Math.min(progress, 0.9) : 0.08
          element.hidden = false
          element.style.opacity = '1'
          element.style.transform = `translateX(${(progress - 1) * 100}%)`
          trickle = setInterval(() => {
            if (reducedMotion.matches) {
              return
            }
            const step = progress < 0.2 ? 0.1 : progress < 0.5 ? 0.04 : progress < 0.8 ? 0.02 : 0.005
            progress = Math.min(0.994, progress + step)
            element.style.transform = `translateX(${(progress - 1) * 100}%)`
          }, 200)
        },
        wasVisible ? 0 : 700,
      )
      // App Router has no global error/cancellation event. Bound any pending
      // indication that never settles, without issuing extra requests.
      watchdog = setTimeout(finish, 30_000)
    })

    window.addEventListener('popstate', reset)
    window.addEventListener('pagehide', reset)
    return () => {
      unsubscribe()
      clearTimers()
      window.removeEventListener('popstate', reset)
      window.removeEventListener('pagehide', reset)
    }
  }, [])

  return (
    <>
      {children}
      <div ref={bar} className="navigation-progress" aria-hidden="true" hidden />
    </>
  )
}

export default ProgressIndicatorProvider
