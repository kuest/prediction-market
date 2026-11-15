import type { FormEvent, ReactNode } from 'react'

import {
  AtSignIcon,
  CheckIcon,
  CircleCheckIcon,
  ClockIcon,
  LockKeyholeIcon,
  MailIcon,
  ScanFaceIcon,
  WalletIcon,
  ZapIcon,
} from 'lucide-react'
import { useExtracted } from 'next-intl'
import { useEffect, useRef, useState } from 'react'

import type { SumsubVerificationStatus } from '@/lib/sumsub/types'
import type { User } from '@/types'

import { checkUsernameAvailabilityAction } from '@/app/[locale]/(platform)/_actions/deposit-wallet'
import { FundAccountDialog } from '@/app/[locale]/(platform)/_components/TradingDialogs'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { InputError } from '@/components/ui/input-error'
import { Spinner } from '@/components/ui/spinner'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useSiteIdentity } from '@/hooks/useSiteIdentity'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/utils'

type OnboardingModal = 'username' | 'email' | 'sumsub' | 'enable' | 'enable-status' | 'approve' | 'auto-redeem' | null
type EnableTradingStep = 'idle' | 'enabling' | 'deploying' | 'completed'
type ApprovalsStep = 'idle' | 'signing' | 'completed'
type UsernameAvailabilityState = 'idle' | 'checking' | 'available' | 'taken' | 'error'
type CheckedUsernameAvailabilityState = Exclude<UsernameAvailabilityState, 'idle'>
type UsernameFormatErrorCode =
  | 'too_short'
  | 'too_long'
  | 'invalid_characters'
  | 'starts_with_separator'
  | 'ends_with_separator'

interface UsernameAvailabilityCheck {
  username: string
  state: CheckedUsernameAvailabilityState
}

interface TradingOnboardingDialogsProps {
  activeModal: OnboardingModal
  onModalOpenChange: (modal: Exclude<OnboardingModal, null>, open: boolean) => void
  usernameDefaultValue: string
  usernameError: string | null
  isUsernameSubmitting: boolean
  onUsernameSubmit: (username: string, termsAccepted: boolean) => void
  emailDefaultValue: string
  emailError: string | null
  isEmailSubmitting: boolean
  onEmailSubmit: (email: string) => void
  onEmailSkip: () => void
  sumsubStatus: SumsubVerificationStatus
  onSumsubStatusChange: (status: SumsubVerificationStatus) => void
  enableTradingStep: EnableTradingStep
  enableTradingError: string | null
  onCreateDepositWallet: () => void
  onEnableTradingAuth: () => void
  hasDeployedDepositWallet: boolean
  hasTradingAuth: boolean
  hasTokenApprovals: boolean
  approvalsStep: ApprovalsStep
  tokenApprovalError: string | null
  onApproveTokens: () => void
  autoRedeemStep: ApprovalsStep
  autoRedeemError: string | null
  onApproveAutoRedeem: () => void
  fundModalOpen: boolean
  onFundOpenChange: (open: boolean) => void
  onFundDeposit: () => void
  depositModalOpen: boolean
  onDepositOpenChange: (open: boolean) => void
  withdrawModalOpen: boolean
  onWithdrawOpenChange: (open: boolean) => void
  user: User | null
  canBuyMeld: boolean
}

function OnboardingDialogShell({
  open,
  onOpenChange,
  icon,
  title,
  description,
  children,
  dismissible = true,
  dialogContentClassName = 'max-w-md border bg-background p-8',
  drawerContentClassName = 'max-h-[90vh] w-full bg-background px-4 pt-4 pb-6',
  headerClassName = 'space-y-3 text-center',
  titleClassName = 'text-center text-2xl font-bold text-foreground',
  descriptionClassName = 'text-center text-base text-muted-foreground',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  icon?: ReactNode
  title: string
  description?: string | null
  children: ReactNode
  dismissible?: boolean
  dialogContentClassName?: string
  drawerContentClassName?: string
  headerClassName?: string
  titleClassName?: string
  descriptionClassName?: string
}) {
  const isMobile = useIsMobile()

  function handleOpenChange(nextOpen: boolean) {
    if (!dismissible && !nextOpen) {
      return
    }
    onOpenChange(nextOpen)
  }

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange} dismissible={dismissible}>
        <DrawerContent className={drawerContentClassName}>
          <DrawerHeader className={headerClassName}>
            {icon}
            <DrawerTitle className={titleClassName}>{title}</DrawerTitle>
            {description && <DrawerDescription className={descriptionClassName}>{description}</DrawerDescription>}
          </DrawerHeader>
          {children}
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog
      open={open}
      disablePointerDismissal={!dismissible}
      onOpenChange={(nextOpen, eventDetails) => {
        if (!dismissible && !nextOpen) {
          eventDetails.cancel()
        }
        handleOpenChange(nextOpen)
      }}
    >
      <DialogContent className={dialogContentClassName} showCloseButton={dismissible}>
        <DialogHeader className={headerClassName}>
          {icon}
          <DialogTitle className={titleClassName}>{title}</DialogTitle>
          {description && <DialogDescription className={descriptionClassName}>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

interface UsernameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultValue: string
  error: string | null
  isSubmitting: boolean
  onSubmit: (username: string, termsAccepted: boolean) => void
}

type UsernameDialogFormProps = Omit<UsernameDialogProps, 'onOpenChange'>

function UsernameDialog({ open, onOpenChange, defaultValue, error, isSubmitting, onSubmit }: UsernameDialogProps) {
  const t = useExtracted()

  return (
    <OnboardingDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={t('Choose a username')}
      description={t('You can update this later.')}
      dismissible={false}
    >
      <UsernameDialogForm
        key={open ? 'open' : 'closed'}
        open={open}
        defaultValue={defaultValue}
        error={error}
        isSubmitting={isSubmitting}
        onSubmit={onSubmit}
      />
    </OnboardingDialogShell>
  )
}

function UsernameDialogForm({ open, defaultValue, error, isSubmitting, onSubmit }: UsernameDialogFormProps) {
  const t = useExtracted()
  const [usernameInput, setUsernameInput] = useState<string | null>(null)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [availabilityCheck, setAvailabilityCheck] = useState<UsernameAvailabilityCheck | null>(null)
  const username = usernameInput ?? defaultValue
  const trimmedUsername = username.trim()
  const localFormatErrorCode = resolveUsernameFormatErrorCode(trimmedUsername)
  const localFormatError = formatLocalUsernameFormatError(localFormatErrorCode)
  const normalizedDefaultUsername = defaultValue.trim().toLowerCase()
  const matchesDefaultUsername =
    normalizedDefaultUsername.length > 0 && trimmedUsername.toLowerCase() === normalizedDefaultUsername
  const activeAvailabilityCheck = availabilityCheck?.username === trimmedUsername ? availabilityCheck : null
  const availabilityState = resolveUsernameAvailabilityState({
    activeAvailabilityCheck,
    localFormatErrorCode,
    matchesDefaultUsername,
    trimmedUsername,
  })
  const availabilityMessage = formatUsernameAvailabilityMessage(availabilityState)
  const canSubmit =
    !isSubmitting && termsAccepted && trimmedUsername.length > 0 && !localFormatError && availabilityState !== 'taken'

  useEffect(
    function checkUsernameAvailability() {
      if (!open || localFormatErrorCode || !trimmedUsername || matchesDefaultUsername) {
        return
      }

      let cancelled = false
      const checkedUsername = trimmedUsername
      const timeoutId = window.setTimeout(() => {
        setAvailabilityCheck({ username: checkedUsername, state: 'checking' })

        void checkUsernameAvailabilityAction({ username: checkedUsername })
          .then((result) => {
            if (cancelled) {
              return
            }

            if (result.available === true) {
              setAvailabilityCheck({ username: checkedUsername, state: 'available' })
              return
            }

            if (result.available === false || result.code === 'username_taken') {
              setAvailabilityCheck({ username: checkedUsername, state: 'taken' })
              return
            }

            setAvailabilityCheck({ username: checkedUsername, state: 'error' })
          })
          .catch(() => {
            if (!cancelled) {
              setAvailabilityCheck({ username: checkedUsername, state: 'error' })
            }
          })
      }, 350)

      return () => {
        cancelled = true
        window.clearTimeout(timeoutId)
      }
    },
    [localFormatErrorCode, matchesDefaultUsername, open, trimmedUsername],
  )

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) {
      return
    }
    onSubmit(trimmedUsername, termsAccepted)
  }

  function handleUsernameChange(value: string) {
    setUsernameInput(value)
    setAvailabilityCheck(null)
  }

  function formatLocalUsernameFormatError(code: UsernameFormatErrorCode | null) {
    if (code === 'too_short') {
      return t('Username must be at least 3 characters long.')
    }
    if (code === 'too_long') {
      return t('Username must be at most 42 characters long.')
    }
    if (code === 'invalid_characters') {
      return t('Only letters, numbers, dots, and hyphens are allowed.')
    }
    if (code === 'starts_with_separator') {
      return t('Username cannot start with a dot or hyphen.')
    }
    if (code === 'ends_with_separator') {
      return t('Username cannot end with a dot or hyphen.')
    }
    return null
  }

  function formatUsernameAvailabilityMessage(state: UsernameAvailabilityState) {
    if (state === 'available') {
      return t('Username is available.')
    }
    if (state === 'checking') {
      return t('Checking username availability...')
    }
    if (state === 'taken') {
      return t('That username is already taken.')
    }
    if (state === 'error') {
      return t('We could not check username availability. Try again.')
    }
    return null
  }

  return (
    <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
      <div className="relative">
        <AtSignIcon
          className={cn(`pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground`)}
        />
        <Input
          value={username}
          onChange={(event) => handleUsernameChange(event.target.value)}
          placeholder={t('username')}
          className="h-14 pl-12 text-lg"
          maxLength={42}
          disabled={isSubmitting}
          autoFocus
        />
      </div>

      <label className="flex items-start gap-3 text-sm text-muted-foreground">
        <Checkbox
          checked={termsAccepted}
          onCheckedChange={(checked) => setTermsAccepted(checked === true)}
          disabled={isSubmitting}
          className="mt-0.5"
        />
        <span>
          {t('I agree to the')}{' '}
          <Link
            href="/tos"
            target="_blank"
            prefetch={false}
            rel="noopener noreferrer"
            className="font-medium text-primary hover:underline"
          >
            {t('terms of service')}
          </Link>
        </span>
      </label>

      {error && <InputError message={error} />}
      {!error && localFormatError && <InputError message={localFormatError} />}
      {!error &&
        !localFormatError &&
        availabilityMessage &&
        (availabilityState === 'available' ? (
          <p className="flex items-center gap-1.5 text-sm font-medium text-primary">
            <CircleCheckIcon className="size-4" />
            {availabilityMessage}
          </p>
        ) : availabilityState === 'checking' ? (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            {availabilityMessage}
          </p>
        ) : (
          <InputError message={availabilityMessage} />
        ))}

      <Button type="submit" className="h-12 w-full text-base" disabled={!canSubmit}>
        {isSubmitting ? <Spinner className="size-4" /> : t('Continue')}
      </Button>
    </form>
  )
}

function resolveUsernameAvailabilityState({
  activeAvailabilityCheck,
  localFormatErrorCode,
  matchesDefaultUsername,
  trimmedUsername,
}: {
  activeAvailabilityCheck: UsernameAvailabilityCheck | null
  localFormatErrorCode: UsernameFormatErrorCode | null
  matchesDefaultUsername: boolean
  trimmedUsername: string
}): UsernameAvailabilityState {
  if (localFormatErrorCode || !trimmedUsername) {
    return 'idle'
  }
  if (matchesDefaultUsername) {
    return 'available'
  }
  return activeAvailabilityCheck?.state ?? 'idle'
}

function resolveUsernameFormatErrorCode(username: string): UsernameFormatErrorCode | null {
  if (!username) {
    return null
  }
  if (username.length < 3) {
    return 'too_short'
  }
  if (username.length > 42) {
    return 'too_long'
  }
  if (!/^[A-Z0-9.-]+$/i.test(username)) {
    return 'invalid_characters'
  }
  if (/^[.-]/.test(username)) {
    return 'starts_with_separator'
  }
  if (/[.-]$/.test(username)) {
    return 'ends_with_separator'
  }
  return null
}

function EmailDialog({
  open,
  onOpenChange,
  defaultValue,
  error,
  isSubmitting,
  onSubmit,
  onSkip,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultValue: string
  error: string | null
  isSubmitting: boolean
  onSubmit: (email: string) => void
  onSkip: () => void
}) {
  const t = useExtracted()
  const [emailDraft, setEmailDraft] = useState('')
  const [isEmailEdited, setIsEmailEdited] = useState(false)
  const email = isEmailEdited ? emailDraft : defaultValue

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit(email.trim())
  }

  return (
    <OnboardingDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={t("What's your email?")}
      description={t('Add your email to receive market and trading notifications.')}
      dismissible={false}
      icon={
        <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <MailIcon className="size-8" />
        </div>
      }
    >
      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        <Input
          value={email}
          onChange={(event) => {
            setIsEmailEdited(true)
            setEmailDraft(event.target.value)
          }}
          placeholder={t('Email address')}
          type="email"
          className="h-12 text-base"
          disabled={isSubmitting}
          autoFocus
        />

        {error && <InputError message={error} />}

        <Button type="submit" className="h-12 w-full text-base" disabled={isSubmitting || email.trim().length === 0}>
          {isSubmitting ? <Spinner className="size-4" /> : t('Continue')}
        </Button>

        <button
          type="button"
          className="mx-auto block text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          disabled={isSubmitting}
          onClick={onSkip}
        >
          {t('Do this later')}
        </button>
      </form>
    </OnboardingDialogShell>
  )
}

function EnableTradingDialog({
  open,
  onOpenChange,
  step,
  error,
  onCreateDepositWallet,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  step: EnableTradingStep
  error: string | null
  onCreateDepositWallet: () => void
}) {
  const t = useExtracted()
  const site = useSiteIdentity()
  const isLoading = step === 'enabling' || step === 'deploying'
  const dismissible = Boolean(error)

  return (
    <OnboardingDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={t('Enable Trading')}
      description={t("Let's set up your wallet to trade on {siteName}.", { siteName: site.name })}
      dismissible={dismissible}
      icon={
        <div className="mx-auto flex size-20 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <WalletIcon className="size-10" />
        </div>
      }
    >
      <div className="mt-6 space-y-4">
        {error && <InputError message={error} />}
        <Button
          className="h-12 w-full text-base"
          disabled={isLoading || step === 'completed'}
          onClick={onCreateDepositWallet}
        >
          {isLoading ? (
            <>
              <Spinner className="size-4" />
              {t('Enabling')}
            </>
          ) : (
            t('Enable Trading')
          )}
        </Button>
      </div>
    </OnboardingDialogShell>
  )
}

function EnableTradingStatusDialog({
  open,
  onOpenChange,
  step,
  error,
  hasDeployedDepositWallet,
  hasTradingAuth,
  hasTokenApprovals,
  onEnableTradingAuth,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  step: EnableTradingStep
  error: string | null
  hasDeployedDepositWallet: boolean
  hasTradingAuth: boolean
  hasTokenApprovals: boolean
  onEnableTradingAuth: () => void
}) {
  const t = useExtracted()
  const isSigning = step === 'enabling'
  const dismissible = Boolean(error)

  const timeline = (
    <div className="mt-5 space-y-0">
      <TimelineStep
        title={t('Enable Trading')}
        description={t('Sign a message to generate your API keys')}
        complete={hasTradingAuth}
        trailing={hasTradingAuth ? t('Done') : null}
        action={
          !hasTradingAuth
            ? {
                label: t('Sign'),
                loading: isSigning,
                onClick: onEnableTradingAuth,
              }
            : undefined
        }
        error={!hasTradingAuth ? error : null}
      />
      <TimelineStep
        title={t('Deploy Wallet')}
        description={t('Deploy a smart contract wallet to enable trading')}
        complete={hasDeployedDepositWallet}
        trailing={hasDeployedDepositWallet ? t('Done') : null}
      />
      <TimelineStep
        title={t('Approve Tokens')}
        description={t('Approve token spending for trading')}
        complete={hasTokenApprovals}
        trailing={hasTokenApprovals ? t('Done') : null}
        isLast
      />
    </div>
  )

  return (
    <OnboardingDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={t('Enable Trading')}
      description={null}
      dismissible={dismissible}
      dialogContentClassName="max-w-sm border bg-background p-6"
      headerClassName="space-y-2 text-center"
      titleClassName="text-center text-xl font-bold text-foreground"
    >
      {timeline}
    </OnboardingDialogShell>
  )
}

function TimelineStep({
  title,
  description,
  complete,
  trailing,
  action,
  error,
  isLast = false,
}: {
  title: string
  description: string
  complete: boolean
  trailing?: string | null
  action?: {
    label: string
    loading: boolean
    onClick: () => void
  }
  error?: string | null
  isLast?: boolean
}) {
  return (
    <div className="grid grid-cols-[1.5rem_1fr_auto] gap-x-3">
      <div className="flex flex-col items-center">
        <div
          className={cn(
            `flex size-6 shrink-0 items-center justify-center rounded-full border text-xs ${
              complete
                ? 'border-primary bg-primary text-primary-foreground'
                : `border-muted-foreground/30 bg-muted text-muted-foreground`
            }`,
          )}
        >
          {complete ? <CheckIcon className="size-3.5" /> : null}
        </div>
        {!isLast && <div className="h-full min-h-10 w-px bg-border" />}
      </div>
      <div className="pb-5">
        <p className={complete ? 'font-medium text-foreground' : 'font-medium text-muted-foreground'}>{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
        {error && <InputError message={error} />}
      </div>
      <div className="pb-5">
        {action ? (
          <Button type="button" size="sm" className="min-w-20" disabled={action.loading} onClick={action.onClick}>
            {action.loading ? <Spinner className="size-4" /> : action.label}
          </Button>
        ) : trailing ? (
          <span className="text-sm font-semibold text-primary">{trailing}</span>
        ) : null}
      </div>
    </div>
  )
}

function ApproveTokensDialog({
  open,
  onOpenChange,
  step,
  error,
  onApproveTokens,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  step: ApprovalsStep
  error: string | null
  onApproveTokens: () => void
}) {
  const t = useExtracted()
  const isLoading = step === 'signing'
  const dismissible = Boolean(error)

  return (
    <OnboardingDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={t('Approve Tokens')}
      description={t('Approve token spending for trading')}
      dismissible={dismissible}
      icon={
        <div className="mx-auto flex size-20 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <WalletIcon className="size-10" />
        </div>
      }
    >
      <div className="mt-6 space-y-4">
        {error && <InputError message={error} />}
        <Button
          className="h-12 w-full text-base"
          disabled={isLoading || step === 'completed'}
          onClick={onApproveTokens}
        >
          {isLoading ? (
            <>
              <Spinner className="size-4" />
              {t('Check your wallet...')}
            </>
          ) : (
            t('Sign')
          )}
        </Button>
      </div>
    </OnboardingDialogShell>
  )
}

function SumsubVerificationDialog({
  open,
  onOpenChange,
  status,
  onStatusChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  status: SumsubVerificationStatus
  onStatusChange: (status: SumsubVerificationStatus) => void
}) {
  const t = useExtracted()

  return (
    <OnboardingDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={t('Verify your identity')}
      description={t('Sumsub securely handles the camera and documents required for identity verification.')}
      icon={
        <div className="mx-auto flex size-20 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <ScanFaceIcon className="size-10" />
        </div>
      }
      dialogContentClassName="max-h-[92vh] max-w-2xl overflow-y-auto border bg-background p-6"
    >
      {open ? <SumsubVerificationContent status={status} onStatusChange={onStatusChange} /> : null}
    </OnboardingDialogShell>
  )
}

function SumsubVerificationContent({
  status,
  onStatusChange,
}: {
  status: SumsubVerificationStatus
  onStatusChange: (status: SumsubVerificationStatus) => void
}) {
  const t = useExtracted()
  const sdkRef = useRef<{ destroy: () => void } | null>(null)
  const sdkLaunchTimeoutRef = useRef<number | null>(null)
  const sdkStartupGenerationRef = useRef(0)
  const statusRef = useRef(status)
  const onStatusChangeRef = useRef(onStatusChange)
  const [isStarting, setIsStarting] = useState(false)
  const [sdkOpen, setSdkOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(
    function syncLatestSumsubDialogState() {
      statusRef.current = status
      onStatusChangeRef.current = onStatusChange
    },
    [onStatusChange, status],
  )

  async function requestAccessToken() {
    const response = await fetch('/api/sumsub/access-token', { method: 'POST' })
    const result = (await response.json()) as { token?: string; error?: string }
    if (!response.ok || !result.token) {
      throw new Error(result.error || t('Verification is temporarily unavailable.'))
    }
    return result.token
  }

  async function startVerification() {
    const startupGeneration = sdkStartupGenerationRef.current + 1
    sdkStartupGenerationRef.current = startupGeneration
    setIsStarting(true)
    setError(null)
    try {
      const token = await requestAccessToken()
      if (sdkStartupGenerationRef.current !== startupGeneration) {
        return
      }
      const snsWebSdk = (await import('@sumsub/websdk')).default
      if (sdkStartupGenerationRef.current !== startupGeneration) {
        return
      }
      sdkRef.current?.destroy()
      const sdk = snsWebSdk
        .init(token, requestAccessToken)
        .withConf({ lang: document.documentElement.lang || 'en' })
        .withOptions({ adaptIframeHeight: true, addViewportTag: false })
        .onMessage((type) => {
          if (type === 'idCheck.onApplicantSubmitted') {
            onStatusChangeRef.current({
              ...statusRef.current,
              status: 'pending',
              updatedAt: new Date().toISOString(),
            })
          }
        })
        .build()
      if (sdkStartupGenerationRef.current !== startupGeneration) {
        sdk.destroy()
        return
      }
      sdkRef.current = sdk
      setSdkOpen(true)
      sdkLaunchTimeoutRef.current = window.setTimeout(() => {
        sdkLaunchTimeoutRef.current = null
        if (sdkStartupGenerationRef.current === startupGeneration) {
          sdk.launch('#sumsub-websdk-container')
        }
      }, 0)
    } catch (caught) {
      if (sdkStartupGenerationRef.current === startupGeneration) {
        setError(caught instanceof Error ? caught.message : t('Verification is temporarily unavailable.'))
      }
    } finally {
      if (sdkStartupGenerationRef.current === startupGeneration) {
        setIsStarting(false)
      }
    }
  }

  useEffect(function destroySumsubSdkOnUnmount() {
    return () => {
      sdkStartupGenerationRef.current += 1
      if (sdkLaunchTimeoutRef.current !== null) {
        window.clearTimeout(sdkLaunchTimeoutRef.current)
        sdkLaunchTimeoutRef.current = null
      }
      sdkRef.current?.destroy()
      sdkRef.current = null
    }
  }, [])

  const stateLabel =
    status.status === 'approved'
      ? t('Identity verified')
      : status.status === 'rejected'
        ? t('Verification rejected')
        : status.status === 'on_hold'
          ? t('Verification is on hold')
          : status.status === 'pending'
            ? t('Verification is under review')
            : status.status === 'error'
              ? t('Verification status is temporarily unavailable')
              : t('Identity verification required')

  return (
    <div className="mt-4 grid gap-4">
      <p
        className={cn(
          'text-center text-sm font-medium',
          status.status === 'rejected'
            ? 'text-destructive'
            : status.status === 'approved'
              ? `text-primary`
              : `text-muted-foreground`,
        )}
      >
        {stateLabel}
      </p>
      {status.status === 'pending' || status.status === 'on_hold' ? (
        <p className="text-center text-sm text-muted-foreground">
          {t('You can close this window while the review continues.')}
        </p>
      ) : null}
      {status.enforcement === 'observe' ? (
        <p className="text-center text-sm text-muted-foreground">
          {t('Verification is optional and will not block your account in Observe only mode.')}
        </p>
      ) : null}
      {error ? <InputError message={error} /> : null}
      <div id="sumsub-websdk-container" className={cn('min-h-96 overflow-hidden rounded-lg', !sdkOpen && 'hidden')} />
      {!sdkOpen && status.status !== 'approved' && status.status !== 'pending' && status.status !== 'on_hold' ? (
        <Button className="h-12 w-full" onClick={startVerification} disabled={isStarting}>
          {isStarting ? <Spinner className="size-4" /> : <ScanFaceIcon className="size-4" />}
          {status.status === 'rejected' ? t('Try verification again') : t('Start verification')}
        </Button>
      ) : null}
    </div>
  )
}

function AutoRedeemDialog({
  open,
  onOpenChange,
  step,
  error,
  onApproveAutoRedeem,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  step: ApprovalsStep
  error: string | null
  onApproveAutoRedeem: () => void
}) {
  const t = useExtracted()
  const isLoading = step === 'signing'

  return (
    <OnboardingDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={t('Get Paid Instantly')}
      description={t('When you win, your payout hits your balance automatically. No more manual steps.')}
      icon={
        <div className="mx-auto flex size-20 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <ZapIcon className="size-10" />
        </div>
      }
    >
      <div className="mt-6 space-y-5">
        <div className="space-y-4 text-left">
          <AutoRedeemBenefit
            icon={<ZapIcon className="size-5" />}
            title={t('One-time approval')}
            description={t("Sign a single transaction and you're set")}
          />
          <AutoRedeemBenefit
            icon={<ClockIcon className="size-5" />}
            title={t('Starts after your next trade')}
            description={t('Manually redeem winnings one last time.')}
          />
          <AutoRedeemBenefit
            icon={<LockKeyholeIcon className="size-5" />}
            title={t('Always on')}
            description={t('Once enabled, it stays on permanently.')}
          />
        </div>

        {error && <InputError message={error} />}

        <Button
          className="h-12 w-full text-base"
          disabled={isLoading || step === 'completed'}
          onClick={onApproveAutoRedeem}
        >
          {isLoading ? (
            <>
              <Spinner className="size-4" />
              {t('Approving...')}
            </>
          ) : (
            t('Enable Auto-Redeem')
          )}
        </Button>
      </div>
    </OnboardingDialogShell>
  )
}

function AutoRedeemBenefit({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <div>
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

export default function TradingOnboardingDialogs({
  activeModal,
  onModalOpenChange,
  usernameDefaultValue,
  usernameError,
  isUsernameSubmitting,
  onUsernameSubmit,
  emailDefaultValue,
  emailError,
  isEmailSubmitting,
  onEmailSubmit,
  onEmailSkip,
  sumsubStatus,
  onSumsubStatusChange,
  enableTradingStep,
  enableTradingError,
  onCreateDepositWallet,
  onEnableTradingAuth,
  hasDeployedDepositWallet,
  hasTradingAuth,
  hasTokenApprovals,
  approvalsStep,
  tokenApprovalError,
  onApproveTokens,
  autoRedeemStep,
  autoRedeemError,
  onApproveAutoRedeem,
  fundModalOpen,
  onFundOpenChange,
  onFundDeposit,
}: TradingOnboardingDialogsProps) {
  return (
    <>
      <UsernameDialog
        open={activeModal === 'username'}
        onOpenChange={(open) => onModalOpenChange('username', open)}
        defaultValue={usernameDefaultValue}
        error={usernameError}
        isSubmitting={isUsernameSubmitting}
        onSubmit={onUsernameSubmit}
      />

      <EmailDialog
        key={activeModal === 'email' ? 'open' : 'closed'}
        open={activeModal === 'email'}
        onOpenChange={(open) => onModalOpenChange('email', open)}
        defaultValue={emailDefaultValue}
        error={emailError}
        isSubmitting={isEmailSubmitting}
        onSubmit={onEmailSubmit}
        onSkip={onEmailSkip}
      />

      <SumsubVerificationDialog
        open={activeModal === 'sumsub'}
        onOpenChange={(open) => onModalOpenChange('sumsub', open)}
        status={sumsubStatus}
        onStatusChange={onSumsubStatusChange}
      />

      <EnableTradingDialog
        open={activeModal === 'enable'}
        onOpenChange={(open) => onModalOpenChange('enable', open)}
        step={enableTradingStep}
        error={enableTradingError}
        onCreateDepositWallet={onCreateDepositWallet}
      />

      <EnableTradingStatusDialog
        open={activeModal === 'enable-status'}
        onOpenChange={(open) => onModalOpenChange('enable-status', open)}
        step={enableTradingStep}
        error={enableTradingError}
        hasDeployedDepositWallet={hasDeployedDepositWallet}
        hasTradingAuth={hasTradingAuth}
        hasTokenApprovals={hasTokenApprovals}
        onEnableTradingAuth={onEnableTradingAuth}
      />

      <ApproveTokensDialog
        open={activeModal === 'approve'}
        onOpenChange={(open) => onModalOpenChange('approve', open)}
        step={approvalsStep}
        error={tokenApprovalError}
        onApproveTokens={onApproveTokens}
      />

      <AutoRedeemDialog
        open={activeModal === 'auto-redeem'}
        onOpenChange={(open) => onModalOpenChange('auto-redeem', open)}
        step={autoRedeemStep}
        error={autoRedeemError}
        onApproveAutoRedeem={onApproveAutoRedeem}
      />

      <FundAccountDialog open={fundModalOpen} onOpenChange={onFundOpenChange} onDeposit={onFundDeposit} />
    </>
  )
}
