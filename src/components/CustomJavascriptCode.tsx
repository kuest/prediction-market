'use client'

import { usePathname } from 'next/navigation'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'

import type { CustomJavascriptCodeAttributeValue, CustomJavascriptCodeConfig } from '@/lib/custom-javascript-code'

import {
  DEPOSIT_MODAL_OPEN_EVENT,
  isCustomJavascriptCodeConfiguredToRunOnDepositModal,
  isCustomJavascriptCodeConfiguredToRunOnPathname,
  parseCustomJavascriptCodeTags,
} from '@/lib/custom-javascript-code'

interface CustomJavascriptCodeProps {
  locale: string
  codes: CustomJavascriptCodeConfig[]
}

interface CustomJavascriptCodeWindow extends Window {
  __customJavascriptCodeExecutedSnippets?: Set<string>
  __customJavascriptCodeHasExecutedCode?: boolean
}

function stripLocalePrefix(pathname: string | null, locale: string) {
  if (!pathname) {
    return pathname
  }

  const localePrefix = `/${locale}`
  if (pathname === localePrefix) {
    return '/'
  }

  if (pathname.startsWith(`${localePrefix}/`)) {
    return pathname.slice(localePrefix.length)
  }

  return pathname
}

function resolveDomAttributeName(attributeName: string) {
  switch (attributeName) {
    case 'crossOrigin':
      return 'crossorigin'
    case 'fetchPriority':
      return 'fetchpriority'
    case 'noModule':
      return 'nomodule'
    case 'referrerPolicy':
      return 'referrerpolicy'
    default:
      return attributeName
  }
}

function applyScriptAttribute(
  scriptElement: HTMLScriptElement,
  attributeName: string,
  attributeValue: CustomJavascriptCodeAttributeValue,
) {
  const domAttributeName = resolveDomAttributeName(attributeName)

  if (attributeValue === true) {
    scriptElement.setAttribute(domAttributeName, '')

    if (attributeName === 'async') {
      scriptElement.async = true
    } else if (attributeName === 'defer') {
      scriptElement.defer = true
    } else if (attributeName === 'noModule') {
      scriptElement.noModule = true
    }

    return
  }

  scriptElement.setAttribute(domAttributeName, attributeValue)

  if (attributeName === 'src') {
    scriptElement.src = attributeValue
  } else if (attributeName === 'crossOrigin') {
    scriptElement.crossOrigin = attributeValue
  } else if (attributeName === 'referrerPolicy') {
    scriptElement.referrerPolicy = attributeValue
  } else if (attributeName === 'fetchPriority') {
    scriptElement.fetchPriority = attributeValue as HTMLScriptElement['fetchPriority']
  } else if (attributeName === 'type') {
    scriptElement.type = attributeValue
  }
}

function getCustomJavascriptCodeExecutionRegistry() {
  const customJavascriptCodeWindow = window as CustomJavascriptCodeWindow

  if (!customJavascriptCodeWindow.__customJavascriptCodeExecutedSnippets) {
    customJavascriptCodeWindow.__customJavascriptCodeExecutedSnippets = new Set<string>()
  }

  return customJavascriptCodeWindow.__customJavascriptCodeExecutedSnippets
}

function hasExecutedCustomJavascriptCode() {
  const customJavascriptCodeWindow = window as CustomJavascriptCodeWindow

  return customJavascriptCodeWindow.__customJavascriptCodeHasExecutedCode === true
}

function markCustomJavascriptCodeExecuted() {
  const customJavascriptCodeWindow = window as CustomJavascriptCodeWindow
  customJavascriptCodeWindow.__customJavascriptCodeHasExecutedCode = true
}

function executeCustomJavascriptCodes(codes: CustomJavascriptCodeConfig[]) {
  if (codes.length === 0) {
    return
  }

  const executionRegistry = getCustomJavascriptCodeExecutionRegistry()

  for (const code of codes) {
    const executionKey = code.snippet.trim()
    if (executionRegistry.has(executionKey)) {
      continue
    }

    const parsedTags = parseCustomJavascriptCodeTags(code.snippet)
    const appendedScriptElements: HTMLScriptElement[] = []

    try {
      for (const parsedTag of parsedTags) {
        const scriptElement = document.createElement('script')
        scriptElement.setAttribute('data-custom-javascript-code', code.name)

        let hasAsyncAttribute = false
        let hasDeferAttribute = false
        let hasSrcAttribute = false

        for (const [attributeName, attributeValue] of Object.entries(parsedTag.attributes)) {
          if (attributeName === 'async') {
            hasAsyncAttribute = true
          } else if (attributeName === 'defer') {
            hasDeferAttribute = true
          } else if (attributeName === 'src') {
            hasSrcAttribute = true
          }

          applyScriptAttribute(scriptElement, attributeName, attributeValue)
        }

        if (parsedTag.content) {
          scriptElement.text = parsedTag.content
        }

        if (hasSrcAttribute && !hasAsyncAttribute && !hasDeferAttribute) {
          scriptElement.async = false
        }

        document.body.appendChild(scriptElement)
        appendedScriptElements.push(scriptElement)
      }
    } catch (error) {
      for (const scriptElement of appendedScriptElements) {
        scriptElement.remove()
      }

      throw error
    }

    executionRegistry.add(executionKey)
    markCustomJavascriptCodeExecuted()
  }
}

function reloadOnCustomJavascriptCodeChange(
  activeCodeSignature: string,
  previousActiveCodeSignatureRef: { current: string | null },
) {
  const previousActiveCodeSignature = previousActiveCodeSignatureRef.current
  previousActiveCodeSignatureRef.current = activeCodeSignature

  if (previousActiveCodeSignature === null) {
    return
  }

  if (previousActiveCodeSignature === activeCodeSignature) {
    return
  }

  if (!hasExecutedCustomJavascriptCode()) {
    return
  }

  window.location.reload()
}

function useCustomJavascriptCodeExecution(locale: string, codes: CustomJavascriptCodeConfig[]) {
  const pathname = usePathname()
  const localizedPathname = useMemo(() => stripLocalePrefix(pathname, locale), [locale, pathname])
  const interactionCodes = useMemo(
    () => codes.filter((code) => isCustomJavascriptCodeConfiguredToRunOnPathname(code, localizedPathname)),
    [codes, localizedPathname],
  )
  const depositModalCodes = useMemo(
    () => codes.filter((code) => isCustomJavascriptCodeConfiguredToRunOnDepositModal(code, localizedPathname)),
    [codes, localizedPathname],
  )
  const activeCodeSignature = useMemo(
    () =>
      [...new Set([...interactionCodes, ...depositModalCodes])]
        .map((code) => `${code.name}\u0000${code.snippet}\u0000${code.runOn.join(',')}`)
        .sort()
        .join('\u0001'),
    [depositModalCodes, interactionCodes],
  )
  const interactionCodeSignature = useMemo(
    () =>
      interactionCodes
        .map((code) => `${code.name}\u0000${code.snippet}\u0000${code.runOn.join(',')}`)
        .sort()
        .join('\u0001'),
    [interactionCodes],
  )
  const previousActiveCodeSignatureRef = useRef<string | null>(null)
  const [interactionSignature, setInteractionSignature] = useState<string | null>(null)

  useEffect(
    function reloadOnCodeChange() {
      reloadOnCustomJavascriptCodeChange(activeCodeSignature, previousActiveCodeSignatureRef)
    },
    [activeCodeSignature],
  )

  useEffect(
    function executeCodesOnFirstInteraction() {
      if (interactionSignature === interactionCodeSignature || interactionCodes.length === 0) {
        return
      }

      function handleInteraction() {
        setInteractionSignature(interactionCodeSignature)
        executeCustomJavascriptCodes(interactionCodes)
      }

      window.addEventListener('pointerdown', handleInteraction, { once: true, passive: true })
      window.addEventListener('keydown', handleInteraction, { once: true })
      window.addEventListener('touchstart', handleInteraction, { once: true, passive: true })
      window.addEventListener('scroll', handleInteraction, { once: true, passive: true })

      return function cleanupInteractionListeners() {
        window.removeEventListener('pointerdown', handleInteraction)
        window.removeEventListener('keydown', handleInteraction)
        window.removeEventListener('touchstart', handleInteraction)
        window.removeEventListener('scroll', handleInteraction)
      }
    },
    [interactionCodeSignature, interactionCodes, interactionSignature],
  )

  useEffect(
    function executeCodesOnDepositModalOpen() {
      if (depositModalCodes.length === 0) {
        return
      }

      function handleDepositModalOpen() {
        executeCustomJavascriptCodes(depositModalCodes)
      }

      window.addEventListener(DEPOSIT_MODAL_OPEN_EVENT, handleDepositModalOpen)
      return function cleanupDepositModalOpenListener() {
        window.removeEventListener(DEPOSIT_MODAL_OPEN_EVENT, handleDepositModalOpen)
      }
    },
    [depositModalCodes],
  )
}

function CustomJavascriptCodeExecution({ locale, codes }: CustomJavascriptCodeProps) {
  useCustomJavascriptCodeExecution(locale, codes)

  return null
}

export default function CustomJavascriptCode(props: CustomJavascriptCodeProps) {
  return (
    <Suspense fallback={null}>
      <CustomJavascriptCodeExecution {...props} />
    </Suspense>
  )
}
