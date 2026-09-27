import { describe, expect, it } from 'bun:test'

import {
  isCustomJavascriptCodeConfiguredToRunOnDepositModal,
  isCustomJavascriptCodeConfiguredToRunOnPathname,
  isCustomJavascriptCodeEnabledOnPathname,
  parseCustomJavascriptCodeTags,
  resolveCustomJavascriptCodePageBucket,
  validateCustomJavascriptCodesJson,
} from '@/lib/custom-javascript-code'

describe('custom javascript code helpers', () => {
  it('parses raw JavaScript into a single inline script tag entry', () => {
    const scripts = parseCustomJavascriptCodeTags('window.CRISP_WEBSITE_ID = "site_123"')

    expect(scripts).toEqual([
      {
        id: 'custom-javascript-code-tag-0',
        attributes: {},
        content: 'window.CRISP_WEBSITE_ID = "site_123"',
      },
    ])
  })

  it('parses multiple script tags and preserves key attributes', () => {
    const scripts = parseCustomJavascriptCodeTags(`
      <script>window.$crisp = [];</script>
      <script async src="https://client.crisp.chat/l.js" crossorigin="anonymous"></script>
    `)

    expect(scripts).toEqual([
      {
        id: 'custom-javascript-code-tag-0',
        attributes: {},
        content: 'window.$crisp = [];',
      },
      {
        id: 'custom-javascript-code-tag-1',
        attributes: {
          async: true,
          crossOrigin: 'anonymous',
          src: 'https://client.crisp.chat/l.js',
        },
        content: null,
      },
    ])
  })

  it('converts legacy disable rules to positive run-on contexts', () => {
    const result = validateCustomJavascriptCodesJson(
      JSON.stringify([
        {
          name: 'Crisp',
          snippet: '<script>window.$crisp = [];</script>',
          disabledOn: ['admin', 'portfolio'],
        },
      ]),
      'Custom javascript code',
    )

    expect(result.error).toBeNull()
    expect(result.value).toEqual([
      {
        name: 'Crisp',
        snippet: '<script>window.$crisp = [];</script>',
        runOn: ['home', 'event', 'settings', 'docs', 'other'],
      },
    ])
  })

  it('converts the legacy deposit-modal trigger and page exclusions to positive run-on contexts', () => {
    const result = validateCustomJavascriptCodesJson(
      JSON.stringify([
        {
          name: 'Deposit chat',
          snippet: '<script src="https://chat.example/widget.js"></script>',
          disabledOn: [],
          onlyWhenDepositModalOpen: true,
        },
      ]),
      'Custom javascript code',
    )

    expect(result.error).toBeNull()
    expect(result.value).toEqual([
      {
        name: 'Deposit chat',
        snippet: '<script src="https://chat.example/widget.js"></script>',
        runOn: ['home', 'event', 'portfolio', 'settings', 'docs', 'admin', 'other', 'deposit'],
      },
    ])
  })

  it('preserves page scope and Deposit-only execution for legacy snippets', () => {
    const result = validateCustomJavascriptCodesJson(
      JSON.stringify([
        {
          name: 'Deposit chat',
          snippet: 'window.chat = true',
          disabledOn: ['admin'],
          onlyWhenDepositModalOpen: true,
        },
      ]),
      'Custom javascript code',
    )

    expect(result.value).toEqual([
      {
        name: 'Deposit chat',
        snippet: 'window.chat = true',
        runOn: ['home', 'event', 'portfolio', 'settings', 'docs', 'other', 'deposit'],
      },
    ])
    expect(isCustomJavascriptCodeConfiguredToRunOnDepositModal(result.value![0]!, '/admin')).toBe(false)
    expect(isCustomJavascriptCodeConfiguredToRunOnDepositModal(result.value![0]!, '/portfolio')).toBe(true)
    expect(isCustomJavascriptCodeConfiguredToRunOnPathname(result.value![0]!, '/portfolio')).toBe(false)
    expect(isCustomJavascriptCodeConfiguredToRunOnDepositModal(result.value![0]!, '/other-page')).toBe(true)
    expect(JSON.parse(result.valueJson)).toEqual(result.value)
  })

  it('runs a Deposit-only config on every page and keeps it modal-only after serialization', () => {
    const result = validateCustomJavascriptCodesJson(
      JSON.stringify([
        {
          name: 'Deposit chat',
          snippet: 'window.chat = true',
          runOn: ['deposit'],
        },
      ]),
      'Custom javascript code',
    )

    expect(result.value).toEqual([{ name: 'Deposit chat', snippet: 'window.chat = true', runOn: ['deposit'] }])
    expect(isCustomJavascriptCodeConfiguredToRunOnDepositModal(result.value![0]!, '/')).toBe(true)
    expect(isCustomJavascriptCodeConfiguredToRunOnDepositModal(result.value![0]!, '/admin')).toBe(true)
    expect(isCustomJavascriptCodeConfiguredToRunOnPathname(result.value![0]!, '/')).toBe(false)
    expect(JSON.parse(result.valueJson)).toEqual(result.value)
  })

  it('rejects an invalid deposit-modal trigger setting', () => {
    const result = validateCustomJavascriptCodesJson(
      JSON.stringify([
        {
          name: 'Deposit chat',
          snippet: 'window.chat = true',
          disabledOn: [],
          onlyWhenDepositModalOpen: 'yes',
        },
      ]),
      'Custom javascript code',
    )

    expect(result.error).toBe('Custom javascript code 1 deposit modal setting is invalid.')
  })

  it('allows raw javascript snippets that include comparison operators', () => {
    const result = validateCustomJavascriptCodesJson(
      JSON.stringify([
        {
          name: 'Counter',
          snippet: 'if (count < 10) { window.count = count + 1 }',
          disabledOn: [],
        },
      ]),
      'Custom javascript code',
    )

    expect(result.error).toBeNull()
    expect(result.value).toEqual([
      {
        name: 'Counter',
        snippet: 'if (count < 10) { window.count = count + 1 }',
        runOn: ['home', 'event', 'portfolio', 'settings', 'docs', 'admin', 'other'],
      },
    ])
  })

  it('allows raw javascript snippets with identifier comparisons', () => {
    const result = validateCustomJavascriptCodesJson(
      JSON.stringify([
        {
          name: 'Guard',
          snippet: 'if (x<Y) { window.guard = true }',
          disabledOn: [],
        },
      ]),
      'Custom javascript code',
    )

    expect(result.error).toBeNull()
    expect(result.value).toEqual([
      {
        name: 'Guard',
        snippet: 'if (x<Y) { window.guard = true }',
        runOn: ['home', 'event', 'portfolio', 'settings', 'docs', 'admin', 'other'],
      },
    ])
  })

  it('allows raw javascript snippets with regex literals that include html-like text', () => {
    const result = validateCustomJavascriptCodesJson(
      JSON.stringify([
        {
          name: 'Pattern guard',
          snippet: 'const htmlPattern = /<(div|span)>/i\nwindow.isHtmlTag = htmlPattern.test(tagName)',
          disabledOn: [],
        },
      ]),
      'Custom javascript code',
    )

    expect(result.error).toBeNull()
    expect(result.value).toEqual([
      {
        name: 'Pattern guard',
        snippet: 'const htmlPattern = /<(div|span)>/i\nwindow.isHtmlTag = htmlPattern.test(tagName)',
        runOn: ['home', 'event', 'portfolio', 'settings', 'docs', 'admin', 'other'],
      },
    ])
  })

  it('allows regex literals after division operators', () => {
    const result = validateCustomJavascriptCodesJson(
      JSON.stringify([
        {
          name: 'Division regex',
          snippet: 'const ratio = 1 / /<(div|span)>/i.test(tagName)',
          disabledOn: [],
        },
      ]),
      'Custom javascript code',
    )

    expect(result.error).toBeNull()
    expect(result.value).toEqual([
      {
        name: 'Division regex',
        snippet: 'const ratio = 1 / /<(div|span)>/i.test(tagName)',
        runOn: ['home', 'event', 'portfolio', 'settings', 'docs', 'admin', 'other'],
      },
    ])
  })

  it('rejects markup that is not raw JavaScript or a script snippet', () => {
    const result = validateCustomJavascriptCodesJson(
      JSON.stringify([
        {
          name: 'Broken',
          snippet: '<div>bad</div>',
          disabledOn: [],
        },
      ]),
      'Custom javascript code',
    )

    expect(result).toEqual({
      value: null,
      valueJson: '',
      error: 'Custom javascript code 1 snippet must be raw JavaScript or a provider <script> snippet.',
    })
  })

  it('rejects non-script html that appears later in the snippet', () => {
    const result = validateCustomJavascriptCodesJson(
      JSON.stringify([
        {
          name: 'Broken later',
          snippet: 'window.ready = true\n<div>bad</div>',
          disabledOn: [],
        },
      ]),
      'Custom javascript code',
    )

    expect(result).toEqual({
      value: null,
      valueJson: '',
      error: 'Custom javascript code 1 snippet must be raw JavaScript or a provider <script> snippet.',
    })
  })

  it('maps pathname buckets and enables scripts only on allowed pages', () => {
    expect(resolveCustomJavascriptCodePageBucket('/')).toBe('home')
    expect(resolveCustomJavascriptCodePageBucket('/portfolio')).toBe('portfolio')
    expect(resolveCustomJavascriptCodePageBucket('/settings')).toBe('settings')
    expect(resolveCustomJavascriptCodePageBucket('/settings/trading')).toBe('settings')
    expect(resolveCustomJavascriptCodePageBucket('/docs')).toBe('docs')
    expect(resolveCustomJavascriptCodePageBucket('/docs/getting-started/how-to-sign-up')).toBe('docs')
    expect(resolveCustomJavascriptCodePageBucket('/admin/theme')).toBe('admin')
    expect(resolveCustomJavascriptCodePageBucket('/event')).toBe('other')
    expect(resolveCustomJavascriptCodePageBucket('/event/will-btc-rise')).toBe('event')

    expect(
      isCustomJavascriptCodeEnabledOnPathname(
        {
          disabledOn: ['admin'],
        },
        '/admin',
      ),
    ).toBe(false)
    expect(
      isCustomJavascriptCodeEnabledOnPathname(
        {
          disabledOn: ['event'],
        },
        '/event/will-btc-rise',
      ),
    ).toBe(false)
    expect(
      isCustomJavascriptCodeEnabledOnPathname(
        {
          disabledOn: ['settings'],
        },
        '/settings/trading',
      ),
    ).toBe(false)
    expect(
      isCustomJavascriptCodeEnabledOnPathname(
        {
          disabledOn: ['docs'],
        },
        '/docs/getting-started/how-to-sign-up',
      ),
    ).toBe(false)
    expect(
      isCustomJavascriptCodeEnabledOnPathname(
        {
          disabledOn: ['portfolio'],
        },
        '/',
      ),
    ).toBe(true)
  })

  it('runs scripts only on selected page contexts', () => {
    const code = { runOn: ['home', 'portfolio'] as ('home' | 'portfolio')[] }

    expect(isCustomJavascriptCodeConfiguredToRunOnPathname(code, '/')).toBe(true)
    expect(isCustomJavascriptCodeConfiguredToRunOnPathname(code, '/portfolio')).toBe(true)
    expect(isCustomJavascriptCodeConfiguredToRunOnPathname(code, '/admin')).toBe(false)
    expect(isCustomJavascriptCodeConfiguredToRunOnPathname(code, '/unlisted-page')).toBe(false)
  })
})
