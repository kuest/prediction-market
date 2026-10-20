import type { Page, TestInfo } from '@playwright/test'

import { instant } from '@next/playwright'
import { expect, test } from '@playwright/test'

const eventPath =
  process.env.INSTANT_NAV_EVENT_PATH ?? '/event/will-the-white-house-call-a-full-lid-by-630-pm-on-october-18-2026'
const eventTitle =
  process.env.INSTANT_NAV_EVENT_TITLE ?? 'Will the White House call a full lid by 6:30 PM on October 18?'
const subcategoryPath = process.env.INSTANT_NAV_SUBCATEGORY_PATH ?? '/politics/trump'
const subcategoryTitle = process.env.INSTANT_NAV_SUBCATEGORY_TITLE ?? 'Trump'
const homeSubcategoryPath = process.env.INSTANT_NAV_HOME_SUBCATEGORY_PATH ?? '/politics/brazil'
const homeSubcategoryTitle = process.env.INSTANT_NAV_HOME_SUBCATEGORY_TITLE ?? 'Brazil'

async function openSource(page: Page, path: string, title: string) {
  await page.goto(path)
  await expect(page.getByRole('heading', { name: title, exact: true }).first()).toBeVisible()
}

async function expectInstantNavigation({
  page,
  testInfo,
  path,
  title,
  scope = 'main',
  trigger = 'hover',
}: {
  page: Page
  testInfo: TestInfo
  path: string
  title: string
  scope?: string
  trigger?: 'hover' | 'focus' | 'touch' | 'click'
}) {
  // The active tab is applied after hydration, when intent handlers are attached.
  await expect(page.locator('#navigation-main-tags a.font-semibold').first()).toBeVisible()
  const link = page.locator(`${scope} a[href="${path}"]`).filter({ visible: true }).first()
  await expect(link).toBeVisible()
  const heading = page.getByRole('heading', { name: title, exact: true }).first()

  async function navigate() {
    if (trigger === 'focus') {
      await link.focus()
      await page.keyboard.press('Enter')
    } else if (trigger === 'touch') {
      await link.tap()
    } else {
      if (trigger === 'hover') {
        await link.hover()
      }
      await link.click()
    }
    await page.waitForURL((url) => url.pathname === path && url.search === '', { timeout: 10_000 })
    await expect(heading).toBeVisible()
    await expect(page.locator('#navigation-main-tags')).toBeVisible()
    if (path === eventPath) {
      await expect(page.locator('#event-content-main').filter({ visible: true })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Rules & Resolution', exact: true }).first()).toBeVisible()
    }
  }

  try {
    await instant(page, async () => {
      try {
        await navigate()
      } finally {
        await page.addStyleTag({ content: 'nextjs-portal { display: none !important }' })
        await page.screenshot({ path: testInfo.outputPath('instant.png') })
      }
    })
  } finally {
    await page.waitForURL((url) => url.pathname === path && url.search === '')
    await expect(heading).toBeVisible()
  }
}

test('home card breadcrumb opens its subcategory instantly on intent', async ({ page }, testInfo) => {
  await openSource(page, '/', 'All markets')
  await expectInstantNavigation({ page, testInfo, path: homeSubcategoryPath, title: homeSubcategoryTitle })
})

test('home event title opens public event content instantly on intent', async ({ page }, testInfo) => {
  await openSource(page, '/', 'All markets')
  await expectInstantNavigation({ page, testInfo, path: eventPath, title: eventTitle })
})

test('subcategory event title opens public event content instantly on intent', async ({ page }, testInfo) => {
  await openSource(page, subcategoryPath, subcategoryTitle)
  await expectInstantNavigation({ page, testInfo, path: eventPath, title: eventTitle })
})

test('event breadcrumb opens its subcategory instantly on intent', async ({ page }, testInfo) => {
  await openSource(page, eventPath, eventTitle)
  await expectInstantNavigation({ page, testInfo, path: subcategoryPath, title: subcategoryTitle })
})

test('event logo returns to the home feed instantly', async ({ page }, testInfo) => {
  await openSource(page, eventPath, eventTitle)
  await expectInstantNavigation({ page, testInfo, path: '/', title: 'All markets', scope: 'header', trigger: 'click' })
})

test('subcategory logo returns to the home feed instantly', async ({ page }, testInfo) => {
  await openSource(page, subcategoryPath, subcategoryTitle)
  await expectInstantNavigation({ page, testInfo, path: '/', title: 'All markets', scope: 'header', trigger: 'click' })
})

test('category sidebar opens its subcategory instantly on intent', async ({ page }, testInfo) => {
  await openSource(page, '/politics', 'Politics')
  await expectInstantNavigation({
    page,
    testInfo,
    path: subcategoryPath,
    title: subcategoryTitle,
    scope: 'nav[aria-label="Politics subcategories"]',
  })
})

test('home event title is ready on keyboard focus and opens with Enter', async ({ page }, testInfo) => {
  await openSource(page, '/', 'All markets')
  await expectInstantNavigation({ page, testInfo, path: eventPath, title: eventTitle, trigger: 'focus' })
})

test.describe('touch navigation', () => {
  test.use({ hasTouch: true })

  test('home event title is ready on touch', async ({ page }, testInfo) => {
    await openSource(page, '/', 'All markets')
    await expectInstantNavigation({ page, testInfo, path: eventPath, title: eventTitle, trigger: 'touch' })
  })
})

test.describe('direct visits without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('home renders its feed', async ({ page }) => {
    await openSource(page, '/', 'All markets')
    await expect(page.getByRole('heading', { name: eventTitle, exact: true }).first()).toBeVisible()
  })

  test('subcategory renders its feed', async ({ page }) => {
    await openSource(page, subcategoryPath, subcategoryTitle)
    await expect(page.getByRole('heading', { name: eventTitle, exact: true }).first()).toBeVisible()
  })

  test('event renders its title and rules', async ({ page }) => {
    await openSource(page, eventPath, eventTitle)
    await expect(page.getByRole('heading', { name: 'Rules & Resolution', exact: true })).toBeVisible()
  })
})
