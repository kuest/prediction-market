type ProgressEvent = { token: symbol; pending: boolean }

const listeners = new Set<(event: ProgressEvent) => void>()

export function subscribeNavigationProgress(listener: (event: ProgressEvent) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function trackNavigationProgress(anchor: HTMLAnchorElement) {
  const destination = new URL(anchor.href)
  // Match the former shallowRouting option: query/hash-only changes have no bar.
  if (
    destination.origin !== window.location.origin ||
    destination.pathname === window.location.pathname ||
    anchor.closest('[data-disable-progress="true"], [data-prevent-progress="true"]')
  ) {
    return
  }

  const token = Symbol('navigation')
  for (const listener of listeners) {
    listener({ token, pending: true })
  }
  return () => {
    for (const listener of listeners) {
      listener({ token, pending: false })
    }
  }
}
