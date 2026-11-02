import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, mock } from 'bun:test'

import { SearchResults } from '@/app/[locale]/(platform)/_components/SearchResults'

import { hoisted } from '../bun-test-helpers'

const mocks = hoisted(() => ({
  usePlatformNavigationData: mock(),
}))

void mock.module('next-intl', () => ({
  useExtracted: () => (value: string) => value,
}))

void mock.module('lucide-react', () => ({
  ArrowRightIcon: () => <svg data-testid="arrow-right-icon" />,
  LoaderIcon: () => <svg data-testid="loader-icon" />,
}))

void mock.module('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

void mock.module('@/app/[locale]/(platform)/_providers/PlatformNavigationProvider', () => ({
  usePlatformNavigationData: mocks.usePlatformNavigationData,
}))

void mock.module('@/components/EventIconImage', () => ({
  default: function MockEventIconImage({ alt }: { alt: string }) {
    return <span>{alt}</span>
  },
}))

void mock.module('@/components/ProfileLink', () => ({
  default: function MockProfileLink() {
    return <span>Profile</span>
  },
}))

describe('searchResults', () => {
  beforeEach(() => {
    mocks.usePlatformNavigationData.mockReturnValue({
      childParentMap: {},
      tags: [
        {
          slug: 'politics',
          name: 'Politics',
          childs: [
            { name: 'Brazil', slug: 'brazil' },
            { name: 'Elections', slug: 'elections' },
          ],
        },
        {
          slug: 'world',
          name: 'World',
          childs: [{ name: 'Brazil', slug: 'brazil' }],
        },
      ],
    })
  })

  it('dedupes matching category chips and routes chips and footer to predictions pages', () => {
    const onResultClick = mock()

    render(
      <SearchResults
        results={{
          events: [
            {
              id: 'event-1',
              slug: 'brazil-presidential-election',
              title: 'Brazil Presidential Election',
              icon_url: 'https://example.com/icon.png',
              markets: [
                {
                  probability: 44,
                },
              ],
            } as any,
          ],
          profiles: [],
        }}
        isLoading={{
          events: false,
          profiles: false,
        }}
        activeTab="events"
        query="BRaZiL"
        onResultClick={onResultClick}
        onTabChange={() => {}}
      />,
    )

    const categoryLinks = screen.getAllByRole('link', { name: 'Brazil' })
    const categoryLink = categoryLinks[0]
    const eventLink = screen.getByRole('link', { name: /Brazil Presidential Election/ })
    const seeAllLink = screen.getByRole('link', { name: 'See all results' })

    expect(categoryLinks).toHaveLength(1)
    expect(categoryLink).toHaveAttribute('href', '/predictions/brazil')
    expect(eventLink).toHaveAttribute('href', '/event/brazil-presidential-election')
    expect(seeAllLink).toHaveAttribute('href', '/predictions/brazil')

    fireEvent.click(categoryLink)
    fireEvent.click(seeAllLink)

    expect(onResultClick).toHaveBeenCalledTimes(2)
  })

  it('renders resolved events with muted title and trailing probability styles', () => {
    render(
      <SearchResults
        results={{
          events: [
            {
              id: 'event-2',
              slug: 'closed-market',
              title: 'Closed Market',
              icon_url: 'https://example.com/icon.png',
              status: 'resolved',
              markets: [
                {
                  probability: 61,
                },
              ],
            } as any,
          ],
          profiles: [],
        }}
        isLoading={{
          events: false,
          profiles: false,
        }}
        activeTab="events"
        query="closed"
        onResultClick={() => {}}
        onTabChange={() => {}}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Closed Market' })).toHaveClass('text-muted-foreground')
    expect(screen.getByText('61%')).toHaveClass('text-muted-foreground')
  })

  it('limits the dropdown event preview to five rows and keeps the see-all link', () => {
    render(
      <SearchResults
        results={{
          events: Array.from({ length: 6 }, (_, index) => ({
            id: `event-${index + 1}`,
            slug: `event-${index + 1}`,
            title: `Event ${index + 1}`,
            icon_url: 'https://example.com/icon.png',
            status: 'active',
            markets: [
              {
                probability: 40 + index,
              },
            ],
          })) as any,
          profiles: [],
        }}
        isLoading={{
          events: false,
          profiles: false,
        }}
        activeTab="events"
        query="event"
        onResultClick={() => {}}
        onTabChange={() => {}}
      />,
    )

    expect(screen.getAllByTestId('search-result-item')).toHaveLength(5)
    expect(screen.getByRole('link', { name: 'See all results' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Event 6/ })).not.toBeInTheDocument()
  })
})
