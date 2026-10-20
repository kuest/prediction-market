import type { Metadata } from 'next'

import { ArrowRightIcon, BookOpenIcon } from 'lucide-react'
import { getExtracted } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { isAddress, zeroAddress } from 'viem'

import SettingsSdkApiKeysContent from '@/app/[locale]/(platform)/settings/_components/SettingsSdkApiKeysContent'
import SettingsSdkDownloadsContent from '@/app/[locale]/(platform)/settings/_components/SettingsSdkDownloadsContent'
import SettingsSdkMarketMakerDownloadsContent from '@/app/[locale]/(platform)/settings/_components/SettingsSdkMarketMakerDownloadsContent'
import { Button } from '@/components/ui/button'
import { Link } from '@/i18n/navigation'
import { addressToBuilderCode } from '@/lib/builder-code'
import { DEFAULT_FEE_RECEIVER_WALLET_ADDRESS } from '@/lib/contracts'
import { SettingsRepository } from '@/lib/db/queries/settings'
import { UserRepository } from '@/lib/db/queries/user'
import { getBlockedCountriesFromSettings } from '@/lib/geoblock-settings'
import { resolvePublicRuntimeEnv } from '@/lib/public-runtime-config.shared'
import resolveSiteUrl from '@/lib/site-url'
import { cn } from '@/lib/utils'

export const instant = false

export async function generateMetadata(): Promise<Metadata> {
  const t = await getExtracted()

  return {
    title: t('SDK Downloads'),
  }
}

export default async function SdkDownloadsSettingsPage() {
  const t = await getExtracted()

  const user = await UserRepository.getCurrentUser({ disableCookieCache: true, minimal: true })
  if (!user) {
    notFound()
  }

  const { data: allSettings } = await SettingsRepository.getSettings()
  const siteUrl = resolveSiteUrl(process.env)
  const { sdkDownloadUrl } = resolvePublicRuntimeEnv(process.env)
  const feeReceiverSetting = allSettings?.general?.fee_recipient_wallet?.value
  const feeReceiver =
    feeReceiverSetting && isAddress(feeReceiverSetting) && feeReceiverSetting.toLowerCase() !== zeroAddress
      ? feeReceiverSetting
      : DEFAULT_FEE_RECEIVER_WALLET_ADDRESS
  const builderCode = addressToBuilderCode(feeReceiver)
  const geoblock = getBlockedCountriesFromSettings(allSettings ?? undefined).length > 0

  function buildSdkDownloadUrl(language: 'python' | 'rust' | 'typescript', sdk: 'unified' | 'clob' | 'relayer') {
    const url = new URL('/download', sdkDownloadUrl)
    url.searchParams.set('sdk', sdk)
    url.searchParams.set('language', language)
    url.searchParams.set('site_url', siteUrl)

    if (sdk !== 'relayer') {
      url.searchParams.set('builder_code', builderCode)
      url.searchParams.set('geoblock', geoblock ? 'true' : 'false')
    }

    return url.toString()
  }

  function buildMarketMakerDownloadUrl(language: 'python' | 'rust' | 'typescript') {
    const url = new URL('/download', sdkDownloadUrl)
    url.searchParams.set('bundle', 'market-maker')
    url.searchParams.set('language', language)
    url.searchParams.set('site_url', siteUrl)
    url.searchParams.set('builder_code', builderCode)
    url.searchParams.set('geoblock', geoblock ? 'true' : 'false')

    return url.toString()
  }

  return (
    <section className="grid gap-8">
      <SettingsSdkApiKeysContent />

      <div className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t('SDK Downloads')}</h1>
        <p className="text-muted-foreground">
          {t(
            'Build trading bots and integrations with personalized SDK bundles. The CLOB client handles orderbook trading, while the Relayer client helps route and execute signed actions.',
          )}
        </p>
      </div>

      <div className="mx-auto w-full max-w-5xl lg:mx-0">
        <SettingsSdkDownloadsContent
          generatingLabel={t('Generating...')}
          cards={[
            {
              id: 'python-client',
              title: t('Python'),
              description: t('For trading bots, services, and workflow automation.'),
              logoSrc: '/images/sdks/python.svg',
              actions: [
                {
                  id: 'python-sdk',
                  label: t('SDK'),
                  href: buildSdkDownloadUrl('python', 'unified'),
                  variant: 'outline',
                },
              ],
            },
            {
              id: 'rust-client',
              title: t('Rust'),
              description: t('For high-performance bots, services, and workflow automation.'),
              logoSrc: '/images/sdks/rust.svg',
              actions: [
                {
                  id: 'rust-clob',
                  label: t('CLOB'),
                  href: buildSdkDownloadUrl('rust', 'clob'),
                  variant: 'outline',
                },
                {
                  id: 'rust-relayer',
                  label: t('Relayer'),
                  href: buildSdkDownloadUrl('rust', 'relayer'),
                  variant: 'outline',
                },
              ],
            },
            {
              id: 'typescript-client',
              title: t('TypeScript'),
              description: t('For web apps, bots, Node.js services, and workflow automation.'),
              logoSrc: '/images/sdks/typescript.svg',
              actions: [
                {
                  id: 'typescript-sdk',
                  label: t('SDK'),
                  href: buildSdkDownloadUrl('typescript', 'unified'),
                  variant: 'outline',
                },
              ],
            },
          ]}
        />
      </div>

      <div
        className={cn(
          `mx-auto flex w-full max-w-5xl flex-col gap-4 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6 lg:mx-0`,
        )}
      >
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <BookOpenIcon className="size-5" />
          </div>
          <div className="grid gap-1">
            <h2 className="text-base font-semibold tracking-tight">{t('Build with the SDKs')}</h2>
            <p className="max-w-3xl text-sm text-muted-foreground">
              {t('Read the SDK documentation for CLOB trading, relayer wallet actions, and market maker workflows.')}
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="w-full sm:w-auto"
          nativeButton={false}
          render={
            <Link href="/docs/api-reference/clients-sdks">
              {t('Open documentation')}
              <ArrowRightIcon className="size-4" />
            </Link>
          }
        />
      </div>

      <div className="mx-auto grid w-full max-w-5xl gap-4 lg:mx-0">
        <div className="grid gap-2">
          <h2 className="text-xl font-semibold tracking-tight">{t('Market Maker Examples')}</h2>
          <p className="text-sm text-muted-foreground">
            {t(
              'Use these market maker examples as practical references to understand SDK workflows and shape your own bots, logic, and strategies for new markets.',
            )}
          </p>
        </div>

        <SettingsSdkMarketMakerDownloadsContent
          downloadLabel={t('Download')}
          generatingLabel={t('Generating...')}
          items={[
            {
              id: 'py-market-maker',
              label: t('{language} Market Maker', { language: 'Python' }),
              href: buildMarketMakerDownloadUrl('python'),
              logoSrc: '/images/sdks/python.svg',
            },
            {
              id: 'rust-market-maker',
              label: t('{language} Market Maker', { language: 'Rust' }),
              href: buildMarketMakerDownloadUrl('rust'),
              logoSrc: '/images/sdks/rust.svg',
            },
            {
              id: 'typescript-market-maker',
              label: t('{language} Market Maker', { language: 'TypeScript' }),
              href: buildMarketMakerDownloadUrl('typescript'),
              logoSrc: '/images/sdks/typescript.svg',
            },
          ]}
        />
      </div>
    </section>
  )
}
