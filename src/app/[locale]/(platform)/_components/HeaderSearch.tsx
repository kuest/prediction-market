'use client'

import type { Route } from 'next'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react'

import { SearchIcon, XIcon } from 'lucide-react'
import { useExtracted } from 'next-intl'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'

import { SearchResults } from '@/app/[locale]/(platform)/_components/SearchResults'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { useSearch } from '@/hooks/useSearch'
import { useSiteIdentity } from '@/hooks/useSiteIdentity'
import { useRouter } from '@/i18n/navigation'
import { buildPredictionResultsPath } from '@/lib/prediction-search'
import { cn } from '@/lib/utils'

const SearchDiscoveryContent = dynamic(() => import('@/app/[locale]/(platform)/_components/SearchDiscoveryContent'))

interface HeaderSearchProps {
  autoFocus?: boolean
  emptyState?: ReactNode
  focusTrigger?: number
  onNavigate?: () => void
  onPredictionResultsNavigate?: (href: Route) => void
  showDesktopDiscovery?: boolean
}

function useHeaderSearchRefs() {
  const searchRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const blurFrameRef = useRef<number | null>(null)
  const pointerDownInsideRef = useRef(false)

  return { searchRef, inputRef, blurFrameRef, pointerDownInsideRef }
}

function useHeaderSearchFocusState() {
  const [hasFocusWithin, setHasFocusWithin] = useState(false)
  const [isResultsDismissed, setIsResultsDismissed] = useState(false)

  return { hasFocusWithin, setHasFocusWithin, isResultsDismissed, setIsResultsDismissed }
}

function useSlashFocusShortcut(inputRef: RefObject<HTMLInputElement | null>) {
  useEffect(
    function bindSlashFocusShortcut() {
      function handleSlashShortcut(event: KeyboardEvent) {
        if (event.key !== '/') {
          return
        }

        const target = event.target as HTMLElement | null
        const tagName = target?.tagName?.toLowerCase()
        const isEditable = tagName === 'input' || tagName === 'textarea' || target?.isContentEditable

        if (event.metaKey || event.ctrlKey || event.altKey || isEditable) {
          return
        }

        event.preventDefault()
        inputRef.current?.focus()
      }

      window.addEventListener('keydown', handleSlashShortcut)
      return function unbindSlashFocusShortcut() {
        window.removeEventListener('keydown', handleSlashShortcut)
      }
    },
    [inputRef],
  )
}

function useExternalFocusTrigger(focusTrigger: number | undefined, inputRef: RefObject<HTMLInputElement | null>) {
  useEffect(
    function focusInputOnExternalTrigger() {
      if (!focusTrigger) {
        return
      }

      if (document.activeElement === inputRef.current) {
        return
      }

      const timeoutId = window.setTimeout(() => {
        inputRef.current?.focus({ preventScroll: true })
      }, 40)

      return function cancelFocusTimeout() {
        window.clearTimeout(timeoutId)
      }
    },
    [focusTrigger, inputRef],
  )
}

function useDismissSearchOnOutsidePointerDown({
  showAttachedDropdown,
  isManagedSearchSurface,
  hideResults,
  clearPendingBlurFrame,
  setHasFocusWithin,
  setIsResultsDismissed,
  searchRef,
  inputRef,
  pointerDownInsideRef,
}: {
  showAttachedDropdown: boolean
  isManagedSearchSurface: boolean
  hideResults: () => void
  clearPendingBlurFrame: () => void
  setHasFocusWithin: (value: boolean) => void
  setIsResultsDismissed: (value: boolean) => void
  searchRef: RefObject<HTMLDivElement | null>
  inputRef: RefObject<HTMLInputElement | null>
  pointerDownInsideRef: RefObject<boolean>
}) {
  useEffect(
    function bindOutsidePointerDownDismiss() {
      function handlePointerDown(event: PointerEvent) {
        if (!showAttachedDropdown) {
          return
        }

        const isInsideSearch = searchRef.current?.contains(event.target as Node) ?? false
        pointerDownInsideRef.current = isInsideSearch

        if (isInsideSearch) {
          return
        }

        clearPendingBlurFrame()
        setHasFocusWithin(false)
        setIsResultsDismissed(true)
        hideResults()
        inputRef.current?.blur()
      }

      if (isManagedSearchSurface) {
        return
      }

      document.addEventListener('pointerdown', handlePointerDown)
      return function unbindOutsidePointerDownDismiss() {
        document.removeEventListener('pointerdown', handlePointerDown)
      }
    },
    [
      hideResults,
      isManagedSearchSurface,
      showAttachedDropdown,
      clearPendingBlurFrame,
      setHasFocusWithin,
      setIsResultsDismissed,
      searchRef,
      inputRef,
      pointerDownInsideRef,
    ],
  )
}

function useCancelPendingBlurOnUnmount(clearPendingBlurFrame: () => void) {
  useEffect(
    function cancelPendingBlurFrameOnUnmount() {
      return function runClearPendingBlurFrame() {
        clearPendingBlurFrame()
      }
    },
    [clearPendingBlurFrame],
  )
}

export default function HeaderSearch({
  autoFocus = false,
  emptyState,
  focusTrigger,
  onNavigate,
  onPredictionResultsNavigate,
  showDesktopDiscovery = true,
}: HeaderSearchProps) {
  const { searchRef, inputRef, blurFrameRef, pointerDownInsideRef } = useHeaderSearchRefs()
  const router = useRouter()
  const {
    query,
    handleQueryChange,
    results,
    isLoading,
    showResults,
    clearSearch,
    hideResults,
    showSearchResults,
    activeTab,
    setActiveTab,
  } = useSearch()
  const { hasFocusWithin, setHasFocusWithin, isResultsDismissed, setIsResultsDismissed } = useHeaderSearchFocusState()
  const isManagedSearchSurface = Boolean(onPredictionResultsNavigate)
  const hasActiveQuery = query.trim().length >= 2
  const showDropdown = hasActiveQuery && (showResults || isLoading.events || isLoading.profiles) && !isResultsDismissed
  const showDiscoveryDropdown =
    showDesktopDiscovery && !emptyState && query.trim().length === 0 && hasFocusWithin && !isResultsDismissed
  const showAttachedDropdown = showDropdown || showDiscoveryDropdown
  const inputBaseClass = showAttachedDropdown ? 'bg-background' : 'bg-secondary'
  const inputBorderClass = showAttachedDropdown ? 'border-border' : 'border-transparent'
  const inputHoverClass = showAttachedDropdown ? 'hover:bg-background' : 'hover:bg-secondary'
  const inputFocusClass = 'focus:bg-background focus-visible:bg-background'
  const site = useSiteIdentity()
  const sitename = `${site.name || 'events and profiles'}`.toLowerCase()
  const t = useExtracted()
  const shouldShowEmptyState = Boolean(emptyState) && query.trim().length === 0 && !showAttachedDropdown

  function handleNavigate() {
    clearSearch()
    setHasFocusWithin(false)
    setIsResultsDismissed(true)
    hideResults()
    inputRef.current?.blur()
    onNavigate?.()
  }

  function navigateToRoute(href: Route) {
    if (onPredictionResultsNavigate) {
      handleNavigate()
      onPredictionResultsNavigate(href)
      return
    }

    handleNavigate()
    router.push(href)
  }

  function navigateToPredictionResults() {
    const nextPath = buildPredictionResultsPath(query)

    if (!nextPath) {
      return
    }

    navigateToRoute(nextPath as Route)
  }

  function navigateToSearchHref(href: Route) {
    navigateToRoute(href)
  }

  const clearPendingBlurFrame = useCallback(() => {
    if (blurFrameRef.current !== null) {
      window.cancelAnimationFrame(blurFrameRef.current)
      blurFrameRef.current = null
    }
  }, [blurFrameRef])

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing || !showAttachedDropdown) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    clearPendingBlurFrame()
    setIsResultsDismissed(true)
    hideResults()
  }

  useSlashFocusShortcut(inputRef)
  useExternalFocusTrigger(focusTrigger, inputRef)
  useDismissSearchOnOutsidePointerDown({
    showAttachedDropdown,
    isManagedSearchSurface,
    hideResults,
    clearPendingBlurFrame,
    setHasFocusWithin,
    setIsResultsDismissed,
    searchRef,
    inputRef,
    pointerDownInsideRef,
  })
  useCancelPendingBlurOnUnmount(clearPendingBlurFrame)

  return (
    <div className="w-full lg:max-w-[600px] lg:min-w-[400px]">
      <div
        className="relative w-full"
        ref={searchRef}
        data-testid="header-search-container"
        onKeyDown={handleSearchKeyDown}
        onFocusCapture={() => {
          clearPendingBlurFrame()
          setHasFocusWithin(true)
          setIsResultsDismissed(false)
        }}
        onBlurCapture={(event) => {
          if (isManagedSearchSurface) {
            return
          }

          clearPendingBlurFrame()
          const nextFocusedElement = event.relatedTarget as Node | null

          if (nextFocusedElement) {
            pointerDownInsideRef.current = false
            const containsFocusedElement = searchRef.current?.contains(nextFocusedElement) ?? false
            setHasFocusWithin(containsFocusedElement)

            if (!containsFocusedElement) {
              setIsResultsDismissed(true)
              hideResults()
            }
            return
          }

          const pointerDownStartedInside = pointerDownInsideRef.current

          blurFrameRef.current = window.requestAnimationFrame(() => {
            blurFrameRef.current = null

            const activeElement = document.activeElement as Node | null
            const containsActiveElement = activeElement ? (searchRef.current?.contains(activeElement) ?? false) : false
            const shouldKeepDropdownOpen = containsActiveElement || pointerDownStartedInside

            setHasFocusWithin(shouldKeepDropdownOpen)

            if (!shouldKeepDropdownOpen) {
              setIsResultsDismissed(true)
              hideResults()
            }

            pointerDownInsideRef.current = false
          })
        }}
      >
        <SearchIcon className="absolute top-1/2 left-4 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          ref={inputRef}
          autoFocus={autoFocus}
          data-testid="header-search-input"
          placeholder={`${t('Search')} ${sitename}`}
          value={query}
          onChange={(e) => {
            setIsResultsDismissed(false)
            handleQueryChange(e.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) {
              return
            }

            event.preventDefault()
            navigateToPredictionResults()
          }}
          onFocus={() => {
            setIsResultsDismissed(false)
            showSearchResults()
          }}
          className={cn(
            'h-12 w-full pr-12 pl-11 shadow-none transition-colors lg:h-10',
            inputBorderClass,
            inputBaseClass,
            { 'rounded-b-none': showAttachedDropdown },
            inputHoverClass,
            'focus-visible:border-border',
            inputFocusClass,
            'focus-visible:ring-0 focus-visible:ring-offset-0',
          )}
        />
        {query.length > 0 ? (
          <button
            type="button"
            className={cn(
              `absolute top-1/2 right-3 inline-flex -translate-y-1/2 items-center justify-center rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground`,
            )}
            onClick={() => {
              clearSearch()
              setIsResultsDismissed(false)
              inputRef.current?.focus()
            }}
            aria-label={t('Clear search')}
          >
            <XIcon className="size-4" />
          </button>
        ) : (
          <Kbd className="absolute top-1/2 right-3 hidden -translate-y-1/2 lg:inline-flex">/</Kbd>
        )}
        {showDropdown && (
          <SearchResults
            results={results}
            isLoading={isLoading}
            activeTab={activeTab}
            query={query}
            onHrefNavigate={onPredictionResultsNavigate ? navigateToSearchHref : undefined}
            onResultClick={handleNavigate}
            onTabChange={setActiveTab}
          />
        )}
        {showDiscoveryDropdown && (
          <div
            className={cn(
              `absolute inset-x-0 top-full z-50 mt-0 rounded-lg rounded-t-none border border-t-0 bg-background shadow-lg`,
            )}
          >
            <SearchDiscoveryContent variant="desktop" onNavigate={handleNavigate} />
          </div>
        )}
      </div>

      {shouldShowEmptyState ? emptyState : null}
    </div>
  )
}
