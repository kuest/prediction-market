'use server'

import { and, asc, eq, inArray } from 'drizzle-orm'
import { revalidatePath, updateTag } from 'next/cache'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

import type { SportsVertical } from '@/lib/sports-vertical'

import { cacheTags } from '@/lib/cache-tags'
import { UserRepository } from '@/lib/db/queries/user'
import { sports_menu_items } from '@/lib/db/schema/events/tables'
import { db } from '@/lib/drizzle'
import { slugifyText } from '@/lib/slug'
import { isMenuRowForVertical } from '@/lib/sports-menu-vertical'

const SidebarCategoryInputSchema = z.object({
  id: z.string().min(1).max(200).nullable(),
  name: z.string().trim().min(1, 'Category name is required.').max(80),
  slug: z
    .string()
    .trim()
    .min(1, 'Slug is required.')
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and hyphens only.'),
  enabled: z.boolean(),
  featured: z.boolean(),
  position: z.number().int().nonnegative(),
  nestedPosition: z.number().int().nonnegative(),
  parentId: z.string().min(1).max(200).nullable(),
})

const SidebarCategoriesInputSchema = z
  .array(SidebarCategoryInputSchema)
  .min(1, 'At least one sidebar category is required.')
  .max(300)
  .superRefine((categories, context) => {
    const ids = new Set<string>()

    categories.forEach((category, index) => {
      if (category.id && ids.has(category.id)) {
        context.addIssue({
          code: 'custom',
          message: 'Duplicate categories are not allowed.',
          path: [index, 'id'],
        })
      }
      if (category.id) {
        ids.add(category.id)
      }
    })
  })

export interface AdminSportsSidebarCategory {
  id: string
  name: string
  slug: string
  enabled: boolean
  featured: boolean
  position: number
  nestedPosition: number
  parentId: string | null
  canHaveChildren: boolean
}

export interface SportsSidebarCategoriesResult {
  success: boolean
  data?: AdminSportsSidebarCategory[]
  error?: string
}

export interface SportsSidebarCategoryInput {
  id: string | null
  name: string
  slug: string
  enabled: boolean
  featured: boolean
  position: number
  nestedPosition: number
  parentId: string | null
}

interface SportsMenuAdminRow {
  id: string
  item_type: string
  label: string | null
  href: string | null
  icon_url: string | null
  menu_slug: string | null
  sort_order: number
  enabled: boolean
  sidebar_category: boolean
  sidebar_enabled: boolean
  sidebar_featured: boolean
  sidebar_sort_order: number
  parent_id: string | null
}

const fallbackSportsIconUrl = '/images/sports/menu/soccer.svg'

const sportsCategoryIconUrls: Record<string, string> = {
  motorsports: '/images/sports/menu/formula-1.svg',
  poker: '/images/sports/menu/poker.svg',
  rugby: '/images/sports/menu/full/group-rugby.svg',
  'table-tennis': '/images/sports/menu/full/group-table-tennis.svg',
  ufc: '/images/sports/menu/full/sub-ufc-ufc-ufc-games.svg',
}

function getRowSlug(row: SportsMenuAdminRow, vertical: SportsVertical) {
  if (row.menu_slug) {
    return row.menu_slug
  }

  if (vertical === 'esports' && row.href?.startsWith('/esports/')) {
    return row.href.split('/').filter(Boolean).at(-1) ?? ''
  }

  return ''
}

function toAdminCategory(row: SportsMenuAdminRow, vertical: SportsVertical): AdminSportsSidebarCategory {
  return {
    id: row.id,
    name: row.label ?? '',
    slug: getRowSlug(row, vertical),
    enabled: row.sidebar_enabled,
    featured: row.sidebar_featured,
    position: row.sidebar_sort_order,
    nestedPosition: row.sort_order,
    parentId: row.parent_id,
    canHaveChildren: row.parent_id === null,
  }
}

function sortAdminCategories(categories: AdminSportsSidebarCategory[]) {
  return categories.toSorted((a, b) => {
    if (a.featured !== b.featured) {
      return Number(b.featured) - Number(a.featured)
    }
    if (a.featured) {
      return a.position - b.position || a.name.localeCompare(b.name)
    }
    if (Boolean(a.parentId) !== Boolean(b.parentId)) {
      return Number(Boolean(a.parentId)) - Number(Boolean(b.parentId))
    }
    if (a.parentId && b.parentId) {
      return a.parentId.localeCompare(b.parentId) || a.nestedPosition - b.nestedPosition || a.name.localeCompare(b.name)
    }

    return a.position - b.position || a.name.localeCompare(b.name)
  })
}

async function loadMenuRows() {
  return db
    .select({
      id: sports_menu_items.id,
      item_type: sports_menu_items.item_type,
      label: sports_menu_items.label,
      href: sports_menu_items.href,
      icon_url: sports_menu_items.icon_url,
      menu_slug: sports_menu_items.menu_slug,
      sort_order: sports_menu_items.sort_order,
      enabled: sports_menu_items.enabled,
      sidebar_category: sports_menu_items.sidebar_category,
      sidebar_enabled: sports_menu_items.sidebar_enabled,
      sidebar_featured: sports_menu_items.sidebar_featured,
      sidebar_sort_order: sports_menu_items.sidebar_sort_order,
      parent_id: sports_menu_items.parent_id,
    })
    .from(sports_menu_items)
    .where(eq(sports_menu_items.enabled, true))
    .orderBy(asc(sports_menu_items.sort_order), asc(sports_menu_items.id))
}

function resolveManageableMenuRows(rows: SportsMenuAdminRow[], vertical: SportsVertical) {
  const verticalRows = rows.filter((row) => isMenuRowForVertical(row, vertical))
  const topLevelCategoryIds = new Set(
    verticalRows.filter((row) => row.sidebar_category && !row.parent_id).map((row) => row.id),
  )

  return verticalRows.filter(
    (row) =>
      (row.item_type === 'link' || row.item_type === 'group') &&
      Boolean(row.label) &&
      Boolean(getRowSlug(row, vertical)) &&
      (row.sidebar_category || Boolean(row.parent_id && topLevelCategoryIds.has(row.parent_id))),
  )
}

async function loadManageableMenuRows(vertical: SportsVertical) {
  return resolveManageableMenuRows(await loadMenuRows(), vertical)
}

function resolveNewCategoryIconUrl(
  category: SportsSidebarCategoryInput,
  parent: SportsMenuAdminRow | null,
  rows: SportsMenuAdminRow[],
  vertical: SportsVertical,
) {
  if (vertical === 'esports') {
    return parent?.icon_url ?? '/images/sports/menu/full/group-esports.svg'
  }

  const sportsRowsWithIcons = rows.filter(
    (row) =>
      isMenuRowForVertical(row, 'sports') &&
      Boolean(row.icon_url) &&
      (row.icon_url !== fallbackSportsIconUrl || row.menu_slug === 'soccer'),
  )
  const matchingRows = sportsRowsWithIcons.filter(
    (row) => row.menu_slug === category.slug || row.href === `/sports/${category.slug}/games`,
  )
  if (parent) {
    const matchingRow = matchingRows.find((row) => row.icon_url !== parent.icon_url) ?? matchingRows[0]
    return matchingRow?.icon_url ?? parent.icon_url ?? sportsCategoryIconUrls[category.slug] ?? fallbackSportsIconUrl
  }

  const matchingGroup = sportsRowsWithIcons.find(
    (row) => row.item_type === 'group' && row.parent_id === null && slugifyText(row.label ?? '') === category.slug,
  )

  return (
    matchingGroup?.icon_url ??
    matchingRows[0]?.icon_url ??
    sportsCategoryIconUrls[category.slug] ??
    fallbackSportsIconUrl
  )
}

async function listSidebarCategories(vertical: SportsVertical) {
  const rows = await loadManageableMenuRows(vertical)
  return sortAdminCategories(rows.map((row) => toAdminCategory(row, vertical)))
}

function findDuplicateSlugError(
  categories: SportsSidebarCategoryInput[],
  existingById: Map<string, SportsMenuAdminRow>,
  vertical: SportsVertical,
) {
  if (vertical === 'esports') {
    const scopedSlugs = new Set<string>()
    for (const category of categories) {
      const existingParentId = category.id
        ? (existingById.get(category.id)?.parent_id ?? category.parentId)
        : category.parentId
      const scopedSlug = `${existingParentId ?? 'top-level'}:${category.slug}`
      if (scopedSlugs.has(scopedSlug)) {
        return `The slug "${category.slug}" is already used under this parent.`
      }
      scopedSlugs.add(scopedSlug)
    }
    return null
  }

  const categoriesBySlug = new Map<string, SportsSidebarCategoryInput[]>()
  for (const category of categories) {
    const matchingCategories = categoriesBySlug.get(category.slug) ?? []
    matchingCategories.push(category)
    categoriesBySlug.set(category.slug, matchingCategories)
  }

  for (const [slug, matchingCategories] of categoriesBySlug) {
    if (matchingCategories.length === 1) {
      continue
    }

    if (matchingCategories.length !== 2) {
      return `The slug "${slug}" is already used in this sidebar.`
    }

    const [firstCategory, secondCategory] = matchingCategories
    const firstParentId = firstCategory.id
      ? (existingById.get(firstCategory.id)?.parent_id ?? firstCategory.parentId)
      : firstCategory.parentId
    const secondParentId = secondCategory.id
      ? (existingById.get(secondCategory.id)?.parent_id ?? secondCategory.parentId)
      : secondCategory.parentId
    const isParentAndChild = firstParentId === secondCategory.id || secondParentId === firstCategory.id
    if (!isParentAndChild) {
      return `The slug "${slug}" is already used in this sidebar.`
    }
  }

  return null
}

function buildUpdatedHref(
  existing: SportsMenuAdminRow,
  category: SportsSidebarCategoryInput,
  vertical: SportsVertical,
  submittedById: Map<string, SportsSidebarCategoryInput>,
  existingById: Map<string, SportsMenuAdminRow>,
) {
  if (vertical === 'esports') {
    if (existing.parent_id) {
      const parentSlug =
        submittedById.get(existing.parent_id)?.slug ??
        getRowSlug(existingById.get(existing.parent_id) ?? existing, vertical)
      return parentSlug ? `/esports/${parentSlug}/${category.slug}` : existing.href
    }

    if (existing.item_type === 'group') {
      return `/esports/${category.slug}/games`
    }

    const section = existing.href?.endsWith('/props') ? 'props' : 'games'
    return `/esports/${category.slug}/${section}`
  }

  if (existing.item_type === 'group') {
    return `/sports/${category.slug}/games`
  }

  if (existing.item_type !== 'link' || !existing.href?.startsWith('/sports/')) {
    return existing.href
  }

  if (!existing.href.endsWith('/games') && !existing.href.endsWith('/props')) {
    return `/sports/${category.slug}`
  }

  const section = existing.href.endsWith('/props') ? 'props' : 'games'
  return `/sports/${category.slug}/${section}`
}

function revalidateSidebar(vertical: SportsVertical) {
  revalidatePath('/[locale]/admin/categories', 'page')
  revalidatePath(`/[locale]/${vertical}`, 'layout')
  updateTag(cacheTags.sportsMenu)
  updateTag(cacheTags.sportsMenuStructure)
}

async function requireAdmin() {
  const currentUser = await UserRepository.getCurrentUser({ minimal: true })
  return Boolean(currentUser?.is_admin)
}

async function getSidebarCategories(vertical: SportsVertical): Promise<SportsSidebarCategoriesResult> {
  try {
    if (!(await requireAdmin())) {
      return { success: false, error: 'Unauthorized. Admin access required.' }
    }

    return {
      success: true,
      data: await listSidebarCategories(vertical),
    }
  } catch (error) {
    console.error(`Failed to load ${vertical} sidebar categories:`, error)
    return { success: false, error: `Failed to load ${vertical} sidebar categories. Please try again.` }
  }
}

async function updateSidebarCategories(
  input: SportsSidebarCategoryInput[],
  vertical: SportsVertical,
): Promise<SportsSidebarCategoriesResult> {
  try {
    const parsed = SidebarCategoriesInputSchema.safeParse(input)
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
    }

    if (!(await requireAdmin())) {
      return { success: false, error: 'Unauthorized. Admin access required.' }
    }

    const menuRows = await loadMenuRows()
    const existingRows = resolveManageableMenuRows(menuRows, vertical)
    const existingById = new Map(existingRows.map((row) => [row.id, row]))

    if (parsed.data.some((category) => category.id && !existingById.has(category.id))) {
      return {
        success: false,
        error: `${vertical === 'sports' ? 'Sports' : 'Esports'} categories changed. Reopen the manager and try again.`,
      }
    }

    const hasChangedParent = parsed.data.some((category) => {
      const existing = category.id ? existingById.get(category.id) : null
      return existing && existing.parent_id !== category.parentId
    })
    if (hasChangedParent) {
      return { success: false, error: 'Existing sidebar categories cannot be moved to another parent.' }
    }

    const hasInvalidNewParent = parsed.data.some((category) => {
      if (category.id || !category.parentId) {
        return false
      }

      const parent = existingById.get(category.parentId)
      return !parent || parent.parent_id !== null || !parent.sidebar_category
    })
    if (hasInvalidNewParent) {
      return {
        success: false,
        error:
          vertical === 'sports'
            ? 'Select a valid parent sport for the nested league.'
            : 'Select a valid parent game for the nested league.',
      }
    }

    const duplicateSlugError = findDuplicateSlugError(parsed.data, existingById, vertical)
    if (duplicateSlugError) {
      return { success: false, error: duplicateSlugError }
    }

    const submittedById = new Map(
      parsed.data.flatMap((category) => (category.id ? [[category.id, category] as const] : [])),
    )

    await db.transaction(async (tx) => {
      const categoryIdsToExpose = existingRows.filter((row) => !row.sidebar_category).map((row) => row.id)
      if (categoryIdsToExpose.length > 0) {
        await tx
          .update(sports_menu_items)
          .set({
            sidebar_category: true,
            updated_at: new Date(),
          })
          .where(inArray(sports_menu_items.id, categoryIdsToExpose))
      }

      for (const category of parsed.data) {
        const existing = category.id ? existingById.get(category.id) : null
        if (existing) {
          const updatedHref = buildUpdatedHref(existing, category, vertical, submittedById, existingById)
          const updatedMenuSlug = vertical === 'esports' && existing.parent_id ? existing.menu_slug : category.slug
          const parent = existing.parent_id ? (existingById.get(existing.parent_id) ?? null) : null
          const resolvedIconUrl = resolveNewCategoryIconUrl(category, parent, menuRows, vertical)
          const shouldRepairIcon =
            !existing.icon_url ||
            (vertical === 'sports' && existing.icon_url === fallbackSportsIconUrl && category.slug !== 'soccer') ||
            Boolean(parent?.icon_url && existing.icon_url === parent.icon_url && resolvedIconUrl !== existing.icon_url)
          const updatedIconUrl = shouldRepairIcon ? resolvedIconUrl : existing.icon_url
          const hasChanges =
            existing.label !== category.name ||
            existing.href !== updatedHref ||
            existing.menu_slug !== updatedMenuSlug ||
            existing.icon_url !== updatedIconUrl ||
            existing.sort_order !== category.nestedPosition ||
            existing.sidebar_enabled !== category.enabled ||
            existing.sidebar_featured !== category.featured ||
            existing.sidebar_sort_order !== category.position
          if (!hasChanges) {
            continue
          }

          await tx
            .update(sports_menu_items)
            .set({
              label: category.name,
              href: updatedHref,
              icon_url: updatedIconUrl,
              menu_slug: updatedMenuSlug,
              h1_title: category.name,
              sort_order: category.nestedPosition,
              sidebar_category: true,
              sidebar_enabled: category.enabled,
              sidebar_featured: category.featured,
              sidebar_sort_order: category.position,
              updated_at: new Date(),
            })
            .where(and(eq(sports_menu_items.id, existing.id), eq(sports_menu_items.enabled, true)))
          continue
        }

        const parent = category.parentId ? existingById.get(category.parentId) : null
        const parentSlug = parent ? (submittedById.get(parent.id)?.slug ?? getRowSlug(parent, vertical)) : null
        const href =
          vertical === 'esports'
            ? parentSlug
              ? `/esports/${parentSlug}/${category.slug}`
              : `/esports/${category.slug}/games`
            : `/sports/${category.slug}/games`
        await tx.insert(sports_menu_items).values({
          id: `sidebar-${vertical}-category-${category.slug}-${randomUUID()}`,
          item_type: 'link',
          label: category.name,
          href,
          icon_url: resolveNewCategoryIconUrl(category, parent ?? null, menuRows, vertical),
          parent_id: category.parentId,
          menu_slug: vertical === 'esports' && category.parentId ? null : category.slug,
          h1_title: category.name,
          mapped_tags: [category.name],
          url_aliases: [],
          games_enabled: true,
          props_enabled: false,
          sort_order: category.nestedPosition,
          enabled: true,
          sidebar_category: true,
          sidebar_enabled: category.enabled,
          sidebar_featured: category.featured,
          sidebar_sort_order: category.position,
        })
      }
    })

    revalidateSidebar(vertical)

    return {
      success: true,
      data: await listSidebarCategories(vertical),
    }
  } catch (error) {
    console.error(`Failed to update ${vertical} sidebar categories:`, error)
    return { success: false, error: `Failed to update ${vertical} sidebar categories. Please try again.` }
  }
}

export async function getSportsSidebarCategoriesAction(): Promise<SportsSidebarCategoriesResult> {
  return getSidebarCategories('sports')
}

export async function updateSportsSidebarCategoriesAction(
  input: SportsSidebarCategoryInput[],
): Promise<SportsSidebarCategoriesResult> {
  return updateSidebarCategories(input, 'sports')
}

export async function getEsportsSidebarCategoriesAction(): Promise<SportsSidebarCategoriesResult> {
  return getSidebarCategories('esports')
}

export async function updateEsportsSidebarCategoriesAction(
  input: SportsSidebarCategoryInput[],
): Promise<SportsSidebarCategoriesResult> {
  return updateSidebarCategories(input, 'esports')
}
