import { afterEach, describe, expect, it, mock } from 'bun:test'

import { hoisted, stubGlobal, unstubAllGlobals } from '../bun-test-helpers'

const confettiMock = hoisted(() => ({
  fn: mock(),
}))

void mock.module('canvas-confetti', () => ({
  default: confettiMock.fn,
}))

describe('utils (confetti/cn)', () => {
  afterEach(() => {
    unstubAllGlobals()
  })

  it('triggerConfetti uses default origin when no event', async () => {
    const { triggerConfetti } = await import('@/lib/confetti')
    confettiMock.fn.mockReset()

    triggerConfetti('yes')

    expect(confettiMock.fn).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: { y: 0.6 },
        colors: expect.any(Array),
      }),
    )
  })

  it('triggerConfetti computes origin from event coords', async () => {
    const { triggerConfetti } = await import('@/lib/confetti')
    confettiMock.fn.mockReset()

    stubGlobal('innerWidth', 1000)
    stubGlobal('innerHeight', 500)

    triggerConfetti('primary', { clientX: 250, clientY: 125 })

    expect(confettiMock.fn).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: { x: 0.25, y: 0.25 },
      }),
    )
  })
})
