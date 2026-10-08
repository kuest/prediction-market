import { describe, expect, it } from 'bun:test'
import { fileURLToPath } from 'node:url'

describe('shared navigation prerendering', () => {
  it('preserves content and links when pathname is unavailable, then applies route visibility', () => {
    // Isolate module mocks from the other component tests.
    const result = Bun.spawnSync({
      cmd: [process.execPath, fileURLToPath(new URL('../fixtures/platformNavigationPrerender.tsx', import.meta.url))],
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 10000,
    })
    expect(result.exitCode, result.stderr.toString()).toBe(0)

    const output = JSON.parse(result.stdout.toString()) as {
      suspended: Record<string, string>
      staticHtml: string
      homeFooter: string
      categoryFooter: string
      eventFooter: string
      sportsFooter: string
      activeMobileNavigation: string
      disabledAnnouncement: string
    }

    for (const html of Object.values(output.suspended)) {
      expect(html).toContain('<main>Visible market content</main>')
      expect(html).not.toContain('Loading')
    }
    expect(output.suspended.footer).not.toContain('<footer')
    expect(output.suspended.footer).not.toContain('href="/docs"')
    expect(output.suspended.navigation).toContain('href="/crypto"')
    expect(output.suspended.navigation).toContain('Crypto')
    expect(output.suspended.mobile).toContain('href="/new"')
    expect(output.suspended.mobile).not.toContain('aria-current="page"')
    expect(output.suspended.announcement).toContain('Public announcement')
    expect(output.suspended.restrictedAnnouncement).not.toContain('Restricted announcement')
    expect(output.staticHtml).toContain('<main>Visible market content</main>')
    expect(output.staticHtml).not.toContain('<footer')
    expect(output.staticHtml).toContain('href="/crypto"')
    expect(output.staticHtml).toContain('href="/new"')
    expect(output.homeFooter).not.toContain('<footer')
    expect(output.categoryFooter).not.toContain('<footer')
    expect(output.eventFooter).toContain('<footer')
    expect(output.eventFooter).toContain('href="/docs"')
    expect(output.sportsFooter).toContain('<footer')
    expect(output.activeMobileNavigation).toContain('href="/new" aria-current="page"')
    expect(output.disabledAnnouncement).not.toContain('Restricted announcement')
  })
})
