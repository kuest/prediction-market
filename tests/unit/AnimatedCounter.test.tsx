import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'

import { AnimatedCounter } from '@/components/ui/animated-counter'

describe('local animated counter', () => {
  let frames: Map<number, FrameRequestCallback>
  let nextFrame: number
  let reducedMotion: boolean
  let preferenceListeners: Set<() => void>
  const restorers: Array<{ mockRestore: () => void }> = []

  beforeEach(() => {
    frames = new Map()
    nextFrame = 0
    reducedMotion = false
    preferenceListeners = new Set()
    restorers.push(
      spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
        frames.set(++nextFrame, callback)
        return nextFrame
      }),
    )
    restorers.push(
      spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((frame) => {
        frames.delete(frame)
      }),
    )
    restorers.push(
      spyOn(window, 'matchMedia').mockImplementation(
        () =>
          ({
            get matches() {
              return reducedMotion
            },
            addEventListener: (_: string, listener: () => void) => {
              preferenceListeners.add(listener)
            },
            removeEventListener: (_: string, listener: () => void) => {
              preferenceListeners.delete(listener)
            },
          }) as unknown as MediaQueryList,
      ),
    )
  })

  afterEach(() => {
    cleanup()
    for (const restore of restorers.splice(0)) {
      restore.mockRestore()
    }
  })

  it('keeps US grouping, rounding, sign and one accessible selectable text run', () => {
    const view = render(<AnimatedCounter value={-1234.567} includeCommas />)
    expect(view.container.querySelector('.animated-counter-selection')?.textContent).toBe('-1,234.57')
    expect(view.container.querySelectorAll('.animated-counter-glyph:not([aria-hidden])')).toHaveLength(0)
    view.rerender(<AnimatedCounter value={9.96} includeDecimals={false} />)
    expect(view.container.querySelector('.animated-counter-selection')?.textContent).toBe('10')
    view.rerender(<AnimatedCounter value={0.06} decimalPrecision={1} />)
    expect(view.container.querySelector('.animated-counter-selection')?.textContent).toBe('0.1')
    view.rerender(<AnimatedCounter value={-0} />)
    expect(view.container.querySelector('.animated-counter-selection')?.textContent).toBe('0.00')
  })

  it('avoids layout reads and observer churn for equivalent inline styles', () => {
    const OriginalObserver = globalThis.ResizeObserver
    const observe = mock()
    const disconnect = mock()
    globalThis.ResizeObserver = class {
      observe = observe
      disconnect = disconnect
      unobserve() {}
    }
    let view: ReturnType<typeof render> | undefined
    try {
      view = render(<AnimatedCounter value={12.5} digitStyles={{ fontWeight: 600, lineHeight: '1' }} />)
      const selection = view.container.querySelector('.animated-counter-selection') as HTMLElement
      const layoutRead = mock(() => 40)
      Object.defineProperty(selection, 'offsetWidth', { configurable: true, get: layoutRead })
      expect(observe).toHaveBeenCalledTimes(1)

      view.rerender(<AnimatedCounter value={12.5} digitStyles={{ fontWeight: 600, lineHeight: '1' }} />)
      view.rerender(<AnimatedCounter value={12.5} digitStyles={{ lineHeight: '1', fontWeight: 600 }} />)
      expect(layoutRead).not.toHaveBeenCalled()
      expect(observe).toHaveBeenCalledTimes(1)
      expect(disconnect).not.toHaveBeenCalled()

      view.rerender(<AnimatedCounter value={12.5} digitStyles={{ fontWeight: 700, lineHeight: '1' }} />)
      expect(layoutRead).toHaveBeenCalledTimes(1)
      expect(observe).toHaveBeenCalledTimes(2)
      expect(disconnect).toHaveBeenCalledTimes(1)
    } finally {
      view?.unmount()
      globalThis.ResizeObserver = OriginalObserver
    }
    expect(disconnect).toHaveBeenCalledTimes(2)
  })

  it('renders the correct initial slots on the server and hydrates without starting animations', async () => {
    const container = document.createElement('div')
    const counter = <AnimatedCounter value={12.5} fontSize="1em" />
    container.innerHTML = renderToString(counter)
    document.body.append(container)
    expect(container.querySelector('.animated-counter-selection')?.textContent).toBe('12.50')
    expect(container.querySelector('.animated-counter-column')?.getAttribute('style')).toContain('--counter-digit:0')
    const onRecoverableError = mock()
    let root: ReturnType<typeof hydrateRoot>
    await act(async () => {
      root = hydrateRoot(container, counter, { onRecoverableError })
    })
    expect(onRecoverableError).not.toHaveBeenCalled()
    expect(frames.size).toBe(0)
    act(() => root.unmount())
    expect(preferenceListeners.size).toBe(0)
  })

  it('retargets an in-flight digit and cancels animation frames and listeners on unmount', () => {
    const view = render(<AnimatedCounter value={0} includeDecimals={false} />)
    view.rerender(<AnimatedCounter value={9} includeDecimals={false} />)
    expect(frames.size).toBe(1)
    const pending = [...frames.values()]
    frames.clear()
    act(() => {
      for (const frame of pending) {
        frame(16)
      }
    })
    const column = view.container.querySelector('.animated-counter-column') as HTMLElement
    const position = column.style.transform
    expect(position).not.toBe('translate3d(0, 900%, 0)')
    view.rerender(<AnimatedCounter value={2} includeDecimals={false} />)
    expect(column.style.transform).toBe(position)
    expect(frames.size).toBe(1)
    for (let tick = 2; tick < 200 && frames.size; tick++) {
      const current = [...frames.values()]
      frames.clear()
      act(() => {
        for (const frame of current) {
          frame(tick * 16)
        }
      })
    }
    expect(column.style.transform).toBe('translate3d(0, 200%, 0)')
    expect(frames.size).toBe(0)
    view.rerender(<AnimatedCounter value={8} includeDecimals={false} />)
    view.unmount()
    expect(frames.size).toBe(0)
    expect(preferenceListeners.size).toBe(0)
  })

  it('snaps to the target when reduced motion is enabled, including during animation', () => {
    const view = render(<AnimatedCounter value={1} includeDecimals={false} />)
    view.rerender(<AnimatedCounter value={8} includeDecimals={false} />)
    reducedMotion = true
    act(() => {
      for (const listener of preferenceListeners) {
        listener()
      }
    })
    expect(frames.size).toBe(0)
    expect((view.container.querySelector('.animated-counter-column') as HTMLElement).style.transform).toBe(
      'translate3d(0, 800%, 0)',
    )
    view.rerender(<AnimatedCounter value={3} includeDecimals={false} />)
    expect(frames.size).toBe(0)
    expect((view.container.querySelector('.animated-counter-column') as HTMLElement).style.transform).toBe(
      'translate3d(0, 300%, 0)',
    )
  })
})
