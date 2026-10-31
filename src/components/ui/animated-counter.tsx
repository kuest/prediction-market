'use client'

import type { CSSProperties } from 'react'

import { memo, useEffect, useLayoutEffect, useRef } from 'react'

import './animated-counter.css'

// Slot geometry and spring tuning adapted from react-animated-counter 1.10.0.
// Its MIT notice is retained in animated-counter.LICENSE.
interface AnimatedCounterProps {
  value: number
  fontSize?: string
  color?: string
  includeDecimals?: boolean
  decimalPrecision?: number
  includeCommas?: boolean
  containerStyles?: CSSProperties
  digitStyles?: CSSProperties
}

const digits = Array.from({ length: 10 }, (_, digit) => digit)

function Digit({ digit }: { digit: number }) {
  const column = useRef<HTMLSpanElement>(null)
  const motion = useRef({ position: digit, velocity: 0 })

  useEffect(() => {
    const element = column.current
    if (!element) {
      return
    }

    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const state = motion.current
    let frame = 0
    let previousTime: number | undefined

    function paint() {
      element!.style.transform = `translate3d(0, ${state.position * 100}%, 0)`
    }

    function settle() {
      cancelAnimationFrame(frame)
      state.position = digit
      state.velocity = 0
      paint()
    }

    function tick(time: number) {
      const elapsed = previousTime === undefined ? 1 / 60 : Math.min((time - previousTime) / 1000, 1 / 30)
      previousTime = time
      const steps = Math.max(1, Math.ceil(elapsed * 90))
      const step = elapsed / steps
      for (let index = 0; index < steps; index++) {
        state.velocity += ((328 * (digit - state.position) - 22 * state.velocity) / 0.84) * step
        state.position += state.velocity * step
      }
      paint()
      if (Math.abs(digit - state.position) < 0.004 && Math.abs(state.velocity) < 0.004) {
        settle()
      } else {
        frame = requestAnimationFrame(tick)
      }
    }

    function onPreferenceChange() {
      if (preference.matches) {
        settle()
      }
    }

    // Keep the current position on rapid updates, including halfway through a spring.
    state.velocity *= 0.5
    if (preference.matches || state.position === digit) {
      settle()
    } else {
      frame = requestAnimationFrame(tick)
    }
    preference.addEventListener('change', onPreferenceChange)
    return () => {
      cancelAnimationFrame(frame)
      preference.removeEventListener('change', onPreferenceChange)
    }
  }, [digit])

  return (
    <span className="animated-counter-digit">
      <span className="animated-counter-placeholder">0</span>
      <span ref={column} className="animated-counter-column" style={{ '--counter-digit': digit } as CSSProperties}>
        {digits.map((number) => (
          <span key={number} style={{ bottom: `${number * 100}%` }}>
            {number}
          </span>
        ))}
      </span>
    </span>
  )
}

const MemoDigit = memo(Digit)

export const AnimatedCounter = memo(function AnimatedCounter({
  value,
  fontSize = '18px',
  color = 'currentColor',
  includeDecimals = true,
  decimalPrecision = 2,
  includeCommas = false,
  containerStyles,
  digitStyles,
}: AnimatedCounterProps) {
  const precision = includeDecimals ? decimalPrecision : 0
  const rounded = Math.abs(value).toFixed(precision)
  // The existing UI deliberately uses US separators for money and cents in every locale.
  const magnitude = includeCommas
    ? Number(rounded).toLocaleString('en-US', { minimumFractionDigits: precision })
    : rounded
  const text = `${value < 0 ? '-' : ''}${magnitude}`
  const characters = Array.from(magnitude).reverse()
  const selection = useRef<HTMLSpanElement>(null)
  const resolvedFontSize = /^\d+(\.\d+)?$/.test(fontSize.trim()) ? `${fontSize.trim()}px` : fontSize
  const glyphStyle: CSSProperties = { fontSize: resolvedFontSize, color, lineHeight: 1, ...digitStyles }
  // Compare values so equivalent inline styles do not repeat layout reads or replace the observer.
  const digitStyleKey = JSON.stringify(
    Object.entries(digitStyles ?? {})
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)),
  )

  useLayoutEffect(() => {
    const element = selection.current
    const container = element?.parentElement
    if (!element || !container) {
      return
    }
    function fitSelection() {
      element!.style.letterSpacing = '0px'
      const extra = container!.clientWidth - element!.offsetWidth
      element!.style.letterSpacing = `${Math.abs(extra) < 0.25 ? 0 : extra / Math.max(text.length - 1, 1)}px`
    }
    fitSelection()
    const observer = new ResizeObserver(fitSelection)
    observer.observe(container)
    return () => observer.disconnect()
  }, [text, resolvedFontSize, digitStyleKey])

  return (
    <span className="animated-counter" style={containerStyles}>
      <span ref={selection} className="animated-counter-selection" style={glyphStyle}>
        {text}
      </span>
      {characters.map((character, index) => (
        <span
          key={index}
          aria-hidden="true"
          className="animated-counter-glyph"
          style={{
            ...glyphStyle,
            ...((character === '.' || character === ',') && { marginLeft: `calc(-${resolvedFontSize} / 10)` }),
          }}
        >
          {/\d/.test(character) ? <MemoDigit digit={Number(character)} /> : character}
        </span>
      ))}
      {value < 0 && (
        <span
          aria-hidden="true"
          className="animated-counter-glyph"
          style={{ ...glyphStyle, marginRight: `calc(${resolvedFontSize} / 5)` }}
        >
          -
        </span>
      )}
    </span>
  )
})
