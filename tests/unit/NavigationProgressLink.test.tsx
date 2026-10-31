import type { ComponentProps } from 'react'

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'

import { subscribeNavigationProgress } from '@/lib/navigation-progress'

let pending = false

void mock.module('next/link', () => ({ useLinkStatus: () => ({ pending }) }))
void mock.module('@/i18n/navigation-base', () => ({
  Link: ({ children, ...props }: ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))

const { default: Link } = await import('@/components/NavigationProgressLink')

describe('navigation progress link', () => {
  afterEach(() => {
    cleanup()
    pending = false
  })

  it('subscribes only while Next reports a pending link and finishes when it settles or unmounts', () => {
    const listener = mock()
    const unsubscribe = subscribeNavigationProgress(listener)
    const view = render(<Link href="/event/example">Example</Link>)
    expect(listener).not.toHaveBeenCalled()
    pending = true
    view.rerender(<Link href="/event/example">Example</Link>)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].pending).toBe(true)
    pending = false
    view.rerender(<Link href="/event/example">Example</Link>)
    expect(listener.mock.calls[1][0]).toEqual({ token: listener.mock.calls[0][0].token, pending: false })
    pending = true
    view.rerender(<Link href="/event/example">Example</Link>)
    view.unmount()
    expect(listener.mock.calls[3][0].pending).toBe(false)
    unsubscribe()
  })

  it('preserves the link ref and user handlers without starting on clicks alone', () => {
    const ref = { current: null as HTMLAnchorElement | null }
    const onClick = mock((event) => event.preventDefault())
    const listener = mock()
    const unsubscribe = subscribeNavigationProgress(listener)
    render(
      <Link ref={ref} href="/event/example" onClick={onClick}>
        Example
      </Link>,
    )
    ref.current?.click()
    expect(ref.current?.getAttribute('href')).toBe('/event/example')
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })
})
