'use client'

import { InfoIcon } from 'lucide-react'
import { useExtracted } from 'next-intl'
import Image from 'next/image'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { useAppKit } from '@/hooks/useAppKit'
import { useIsMobile } from '@/hooks/useIsMobile'
import { triggerConfetti } from '@/lib/confetti'
import { cn } from '@/lib/utils'

interface HowItWorksProps {
  displayMode?: 'auto' | 'mobile' | 'desktop'
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
}

interface HowItWorksStep {
  title: string
  description: string
  image: string
  imageAlt: string
  ctaLabel: string
}

function useControlledOpenState(
  controlledOpen: boolean | undefined,
  onOpenChange: ((open: boolean) => void) | undefined,
) {
  const [uncontrolledIsOpen, setUncontrolledIsOpen] = useState(false)
  const isOpen = controlledOpen ?? uncontrolledIsOpen

  function setOpen(nextOpen: boolean) {
    if (controlledOpen === undefined) {
      setUncontrolledIsOpen(nextOpen)
    }
    onOpenChange?.(nextOpen)
  }

  return { isOpen, setOpen }
}

export default function HowItWorks({
  displayMode = 'auto',
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: HowItWorksProps) {
  const t = useExtracted()
  const isMobile = useIsMobile()
  const { open: openAppKit } = useAppKit()
  const { isOpen, setOpen } = useControlledOpenState(controlledOpen, onOpenChange)

  const steps: ReadonlyArray<HowItWorksStep> = [
    {
      title: t('1. Choose a Market'),
      description: t(
        'Buy "Yes" or "No" shares based on what you honestly think will happen. Prices move in real time as other traders trade.',
      ),
      image: '/images/how-it-works/markets.svg',
      imageAlt: t('Illustration showing how to pick a market'),
      ctaLabel: t('Next'),
    },
    {
      title: t('2. Make Your Trade'),
      description: t(
        'Add funds with crypto, card, or bank transfer—then choose your position. Trade on real-world events with full transparency.',
      ),
      image: '/images/how-it-works/trade.svg',
      imageAlt: t('Illustration showing how to place an order'),
      ctaLabel: t('Next'),
    },
    {
      title: t('3. Cash Out 🤑'),
      description: t(
        'Sell your "Yes" or "No" shares anytime, or wait until the market settles. Winning shares redeem for $1 each. Start trading in minutes.',
      ),
      image: '/images/how-it-works/cashout.svg',
      imageAlt: t('Illustration showing how profits work'),
      ctaLabel: t('Get Started'),
    },
  ]

  const shouldUseMobileLayout = displayMode === 'auto' ? isMobile : displayMode === 'mobile'
  const contentKey = isOpen ? 'open' : 'closed'

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
  }

  function handleComplete() {
    triggerConfetti('primary')
    setOpen(false)
    window.setTimeout(() => void openAppKit(), 500)
  }

  if (shouldUseMobileLayout) {
    return (
      <Drawer open={isOpen} onOpenChange={handleOpenChange}>
        {!hideTrigger && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(true)}
            data-testid="how-it-works-trigger-mobile"
          >
            <InfoIcon className="size-4" />
            {t('How it works')}
          </Button>
        )}

        <DrawerContent className="max-h-[95vh] gap-0 overflow-y-auto p-0" data-testid="how-it-works-dialog">
          <HowItWorksContent
            key={contentKey}
            steps={steps}
            imageWrapperClassName="mt-2 h-85 overflow-hidden lg:rounded-t-lg"
            variant="mobile"
            onComplete={handleComplete}
          />
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      {!hideTrigger && (
        <DialogTrigger
          render={<Button type="button" variant="ghost" size="sm" data-testid="how-it-works-trigger-desktop" />}
        >
          <InfoIcon className="size-4" />
          {t('How it works')}
        </DialogTrigger>
      )}

      <DialogContent className="max-h-[95vh] gap-0 overflow-y-auto p-0 sm:max-w-md" data-testid="how-it-works-dialog">
        <HowItWorksContent
          key={contentKey}
          steps={steps}
          imageWrapperClassName="h-85 overflow-hidden rounded-t-lg"
          variant="desktop"
          onComplete={handleComplete}
        />
      </DialogContent>
    </Dialog>
  )
}

interface HowItWorksContentProps {
  imageWrapperClassName: string
  onComplete: () => void
  steps: ReadonlyArray<HowItWorksStep>
  variant: 'mobile' | 'desktop'
}

function useHowItWorksStepNavigation(steps: ReadonlyArray<HowItWorksStep>, onComplete: () => void) {
  const [activeStep, setActiveStep] = useState(0)
  const currentStep = steps[activeStep]
  const isLastStep = activeStep === steps.length - 1

  function handleNext() {
    if (isLastStep) {
      onComplete()
      return
    }

    setActiveStep((step) => Math.min(step + 1, steps.length - 1))
  }

  return { activeStep, currentStep, handleNext }
}

function HowItWorksContent({ imageWrapperClassName, onComplete, steps, variant }: HowItWorksContentProps) {
  const { activeStep, currentStep, handleNext } = useHowItWorksStepNavigation(steps, onComplete)

  return (
    <>
      <div className={imageWrapperClassName}>
        <Image
          src={currentStep.image}
          alt={currentStep.imageAlt}
          width={448}
          height={252}
          unoptimized
          className="size-full object-cover"
        />
      </div>

      <div className="flex flex-col gap-6 p-6">
        <div className="flex items-center justify-center gap-2">
          {steps.map((step, index) => (
            <span
              key={step.title}
              className={cn('h-1.5 w-8 rounded-full bg-muted transition-colors', {
                'bg-primary': index === activeStep,
              })}
            />
          ))}
        </div>

        {variant === 'mobile' ? (
          <DrawerHeader className="gap-2 p-0 text-left">
            <DrawerTitle className="text-xl font-semibold">{currentStep.title}</DrawerTitle>
            <DrawerDescription className="text-sm/relaxed">{currentStep.description}</DrawerDescription>
          </DrawerHeader>
        ) : (
          <DialogHeader className="gap-2">
            <DialogTitle className="text-xl font-semibold">{currentStep.title}</DialogTitle>
            <DialogDescription className="text-sm/relaxed">{currentStep.description}</DialogDescription>
          </DialogHeader>
        )}

        <Button size="lg" className="h-11 w-full" onClick={handleNext} data-testid="how-it-works-next-button">
          {currentStep.ctaLabel}
        </Button>
      </div>
    </>
  )
}
