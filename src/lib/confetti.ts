import confetti from 'canvas-confetti'

export function triggerConfetti(color: 'primary' | 'yes' | 'no', event?: any) {
  let origin: { x?: number; y: number } = { y: 0.6 }

  if (event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
    const x = event.clientX / window.innerWidth
    const y = event.clientY / window.innerHeight
    origin = { x, y }
  }

  const colors = {
    yes: ['#10b981', '#059669', '#047857', '#065f46'],
    no: ['#ef4444', '#dc2626', '#b91c1c', '#991b1b'],
    primary: ['#2563eb', '#1d4ed8', '#3b82f6', '#60a5fa'],
  }[color ?? 'primary']

  void confetti({
    particleCount: 120,
    spread: 70,
    decay: 0.92,
    scalar: 0.9,
    origin,
    colors,
  })
}
