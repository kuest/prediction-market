import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, jest, spyOn } from 'bun:test'

import { trackNavigationProgress } from '@/lib/navigation-progress'
import ProgressIndicatorProvider from '@/providers/ProgressIndicatorProvider'

import { useFakeTimers, useRealTimers } from '../bun-test-helpers'

function begin(href = '/event/example', attributes: Record<string, string> = {}) {
  const anchor = document.createElement('a')
  anchor.href = href
  for (const [key, value] of Object.entries(attributes)) {
    anchor.setAttribute(key, value)
  }
  return trackNavigationProgress(anchor)
}

function getBar(container: HTMLElement) {
  return container.querySelector('.navigation-progress') as HTMLDivElement
}

describe('local navigation progress', () => {
  let reducedMotion: boolean
  beforeEach(() => {
    reducedMotion = false
    spyOn(window, 'matchMedia').mockImplementation(
      () =>
        ({
          get matches() {
            return reducedMotion
          },
        }) as unknown as MediaQueryList,
    )
    useFakeTimers()
  })
  afterEach(() => {
    cleanup()
    jest.restoreAllMocks()
    useRealTimers()
  })

  it('waits 700ms, finishes and fades without flashing for fast or cancelled navigations', () => {
    const view = render(<ProgressIndicatorProvider>Content</ProgressIndicatorProvider>)
    const bar = getBar(view.container)
    const fast = begin()
    jest.advanceTimersByTime(699)
    expect(bar.hidden).toBe(true)
    fast?.()
    jest.advanceTimersByTime(1000)
    expect(bar.hidden).toBe(true)

    const slow = begin()
    jest.advanceTimersByTime(700)
    expect(bar.hidden).toBe(false)
    expect(bar.style.transform).toBe('translateX(-92%)')
    jest.advanceTimersByTime(800)
    expect(bar.style.transform).not.toBe('translateX(-92%)')
    slow?.()
    expect(bar.style.transform).toBe('translateX(0)')
    jest.advanceTimersByTime(400)
    expect(bar.hidden).toBe(true)
  })

  it('keeps reduced-motion progress static and responds to preference changes', () => {
    reducedMotion = true
    const view = render(<ProgressIndicatorProvider>Content</ProgressIndicatorProvider>)
    const bar = getBar(view.container)
    const finish = begin()
    jest.advanceTimersByTime(700)
    expect(bar.hidden).toBe(false)
    const initial = bar.style.transform
    jest.advanceTimersByTime(1600)
    expect(bar.style.transform).toBe(initial)

    reducedMotion = false
    jest.advanceTimersByTime(200)
    expect(bar.style.transform).not.toBe(initial)
    const current = bar.style.transform
    reducedMotion = true
    jest.advanceTimersByTime(800)
    expect(bar.style.transform).toBe(current)

    finish?.()
    expect(bar.style.transform).toBe('translateX(0)')
    jest.advanceTimersByTime(400)
    expect(bar.hidden).toBe(true)
  })

  it('ignores stale completions and clears old fade timers when a new navigation starts', () => {
    const view = render(<ProgressIndicatorProvider>Content</ProgressIndicatorProvider>)
    const bar = getBar(view.container)
    const first = begin('/first')
    jest.advanceTimersByTime(700)
    const second = begin('/second')
    first?.()
    jest.advanceTimersByTime(700)
    expect(bar.hidden).toBe(false)
    expect(bar.style.opacity).toBe('1')
    second?.()
    jest.advanceTimersByTime(200)
    const third = begin('/third')
    jest.advanceTimersByTime(500)
    expect(bar.hidden).toBe(false)
    expect(bar.style.opacity).toBe('1')
    third?.()
    jest.advanceTimersByTime(400)
    expect(bar.hidden).toBe(true)
  })

  it('skips same-path, hash, query-only, external and explicitly disabled destinations', () => {
    const view = render(<ProgressIndicatorProvider>Content</ProgressIndicatorProvider>)
    for (const href of [
      '/',
      '/?tab=positions',
      '/#details',
      'https://external.test/event',
      'mailto:user@example.test',
    ]) {
      expect(begin(href)).toBeUndefined()
    }
    expect(begin('/event/example', { 'data-disable-progress': 'true' })).toBeUndefined()
    expect(begin('/event/example', { 'data-prevent-progress': 'true' })).toBeUndefined()
    jest.advanceTimersByTime(1000)
    expect(getBar(view.container).hidden).toBe(true)
  })

  it('bounds an unsettled navigation and clears pending progress on back/forward and pagehide', () => {
    const view = render(<ProgressIndicatorProvider>Content</ProgressIndicatorProvider>)
    const bar = getBar(view.container)
    begin()
    jest.advanceTimersByTime(30_400)
    expect(bar.hidden).toBe(true)
    for (const event of ['popstate', 'pagehide']) {
      begin()
      jest.advanceTimersByTime(700)
      window.dispatchEvent(new Event(event))
      expect(bar.hidden).toBe(true)
      jest.advanceTimersByTime(1500)
      expect(bar.hidden).toBe(true)
    }
  })

  it('unsubscribes on unmount and remounts with one bar', () => {
    const first = render(<ProgressIndicatorProvider>Content</ProgressIndicatorProvider>)
    const detachedBar = getBar(first.container)
    begin()
    first.unmount()
    const second = render(<ProgressIndicatorProvider>Content</ProgressIndicatorProvider>)
    begin()
    jest.advanceTimersByTime(1000)
    expect(document.querySelectorAll('.navigation-progress')).toHaveLength(1)
    expect(getBar(second.container).hidden).toBe(false)
    expect(detachedBar.hidden).toBe(true)
  })
})
