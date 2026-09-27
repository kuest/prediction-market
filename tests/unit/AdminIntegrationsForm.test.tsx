import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import * as React from 'react'

import AdminIntegrationsForm from '@/app/[locale]/admin/integrations/_components/AdminIntegrationsForm'

void mock.module('next-intl', () => ({
  useExtracted: () => (value: string | { message: string }) => (typeof value === 'string' ? value : value.message),
}))

void mock.module('next/image', () => ({
  default: ({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) =>
    React.createElement('img', {
      src: typeof src === 'string' ? src : undefined,
      alt: alt ?? '',
      ...props,
    }),
}))

void mock.module('@/app/[locale]/admin/integrations/_actions/update-integrations-settings', () => ({
  updateIntegrationsSettingsAction: mock().mockResolvedValue({ error: null }),
}))

const props = {
  locale: 'en',
  googleAnalyticsId: '',
  customJavascriptCodes: [],
  lifiIntegrator: '',
  lifiApiKeyConfigured: false,
  openRouterSettings: {
    defaultModel: '',
    translationModel: '',
    isApiKeyConfigured: false,
    modelOptions: [],
    translationModelOptions: [],
    decisionModelOptions: [],
  },
  sportsSourceSettings: {
    isPandaScoreTokenConfigured: false,
    isTheSportsDbApiKeyConfigured: false,
  },
  arbitrageSettings: {
    enabled: false,
    multiWalletEnabled: false,
  },
  kuestSupportSettings: {
    enabled: true,
    position: 'right' as const,
  },
  sumsubSettings: {
    enabled: false,
    enforcement: 'disabled' as const,
    levelName: '',
    appTokenConfigured: false,
    secretKeyConfigured: false,
    webhookSecretConfigured: false,
  },
  paymentsSettings: {
    enabled: false,
    operatorKeyConfigured: false,
    operatorDomainChanged: false,
  },
}

describe('adminIntegrationsForm', () => {
  afterEach(() => {
    window.history.replaceState(window.history.state, '', window.location.pathname)
  })

  it('allows an accordion opened by a URL fragment to collapse', () => {
    window.history.replaceState(window.history.state, '', '#openrouter')
    render(<AdminIntegrationsForm {...props} />)
    const trigger = screen.getByRole('button', { name: /OpenRouter/ })

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(window.location.hash).toBe('')
  })

  it('reflects an updated saved support widget position', () => {
    const { rerender } = render(<AdminIntegrationsForm {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /Kuest Support/ }))
    const positionSwitch = screen.getByRole('switch', { name: 'Widget position' })
    expect(positionSwitch).toHaveAttribute('data-checked')

    rerender(<AdminIntegrationsForm {...props} kuestSupportSettings={{ enabled: true, position: 'left' }} />)

    fireEvent.click(screen.getByRole('button', { name: /Kuest Support/ }))
    expect(screen.getByRole('switch', { name: 'Widget position' })).toHaveAttribute('data-unchecked')
  })

  it('renders each integration as its own accordion card', () => {
    const { container } = render(<AdminIntegrationsForm {...props} />)

    expect(
      Array.from(container.querySelectorAll('[data-settings-section]')).map((section) =>
        section.getAttribute('data-settings-section'),
      ),
    ).toEqual([
      'google-analytics',
      'openrouter',
      'sumsub',
      'thesportsdb',
      'pandascore',
      'lifi',
      'on-off-ramp-payments',
      'polymarket',
      'kuest-support',
      'custom',
    ])
    expect(screen.getByRole('button', { name: /TheSportsDB/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /PandaScore/ })).toBeInTheDocument()
    expect(container.querySelectorAll('img')).toHaveLength(9)
    expect(container.querySelector('img[src="/images/logos/sumsub.svg"]')).toBeInTheDocument()
    expect(container.querySelector('img[src="/images/logos/meld-icon.svg"]')).toBeInTheDocument()
    expect(container.querySelector('img[src="/images/logos/kuest-icon.svg"]')).toBeInTheDocument()
    expect(container.querySelector('[data-settings-section="custom"] svg')).toBeInTheDocument()
  })

  it('saves Deposit as an exclusive trigger scoped to the selected pages', () => {
    render(<AdminIntegrationsForm {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /Custom Integrations/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add Integration' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Deposit' }))

    expect(document.querySelector('input[name="custom_javascript_codes_json"]')).toHaveValue(
      JSON.stringify([
        {
          name: '',
          snippet: '',
          runOn: ['home', 'event', 'portfolio', 'settings', 'docs', 'admin', 'other', 'deposit'],
        },
      ]),
    )
  })

  it('shows an official destination inside every provider card', () => {
    const { container } = render(<AdminIntegrationsForm {...props} />)
    const providerSections = [
      'google-analytics',
      'openrouter',
      'sumsub',
      'thesportsdb',
      'pandascore',
      'lifi',
      'polymarket',
    ]

    for (const section of providerSections) {
      expect(container.querySelector(`[data-settings-section="${section}"] a[href^="http"]`)).toBeInTheDocument()
    }
  })

  it('offers automatic domain registration and never renders an operator key input', () => {
    render(
      <AdminIntegrationsForm
        {...props}
        paymentsSettings={{ enabled: true, operatorKeyConfigured: true, operatorDomainChanged: false }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /On\/Off Ramp Payments/ }))

    expect(
      screen.getByText('Payments are active. The operator key is encrypted in this site’s server settings.'),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Kuest operator key')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Reverify this domain and replace its operator key' }),
    ).toBeInTheDocument()
  })

  it('allows an administrator to turn payments on before a key is stored', () => {
    render(<AdminIntegrationsForm {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /On\/Off Ramp Payments/ }))

    const enableSwitch = screen.getByRole('switch', { name: 'Enable payments' })
    expect(enableSwitch).not.toBeDisabled()
    expect(document.querySelector('input[name="payments_enabled_changed"]')).toHaveValue('false')
    fireEvent.click(enableSwitch)
    expect(document.querySelector('input[name="payments_enabled_changed"]')).toHaveValue('true')
    expect(
      screen.getByText('Enable and save to verify this site and register its operator automatically.'),
    ).toBeInTheDocument()
  })

  it('shows the domain migration state and the previous return-domain requirement', () => {
    render(
      <AdminIntegrationsForm
        {...props}
        paymentsSettings={{ enabled: false, operatorKeyConfigured: true, operatorDomainChanged: true }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /On\/Off Ramp Payments/ }))

    expect(
      screen.getByText(
        'The site domain changed. Verify the new domain to migrate this operator and rotate its key before payments can resume.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Keep the previous domain serving payment return pages for up to 30 days after a domain migration.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Reverify this domain and replace its operator key' }),
    ).toBeInTheDocument()
  })
})
