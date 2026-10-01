import { and, eq, sql } from 'drizzle-orm'
import { cacheLife, cacheTag, updateTag } from 'next/cache'

import type { TermsOfServiceTranslationsPatch } from '@/lib/terms-of-service'
import type { QueryResult } from '@/types'

import { cacheTags } from '@/lib/cache-tags'
import { hasDatabaseEnv } from '@/lib/db/env'
import { upsertTermsOfServiceTranslationsInTransaction } from '@/lib/db/queries/terms-of-service'
import { settings } from '@/lib/db/schema/settings/tables'
import { runQuery } from '@/lib/db/utils/run-query'
import { db } from '@/lib/drizzle'

type SettingsMap = Record<string, Record<string, { value: string; updated_at: string }>>

async function getCachedSettings(): Promise<QueryResult<SettingsMap>> {
  'use cache'
  cacheTag(cacheTags.settings)

  const result = await runQuery(async () => {
    try {
      const data = await db
        .select({
          group: settings.group,
          key: settings.key,
          value: settings.value,
          updated_at: settings.updated_at,
        })
        .from(settings)

      const settingsByGroup: SettingsMap = {}

      for (const setting of data) {
        settingsByGroup[setting.group] ??= {}
        settingsByGroup[setting.group][setting.key] = {
          value: setting.value,
          updated_at: setting.updated_at.toISOString(),
        }
      }

      return { data: settingsByGroup, error: null }
    } catch {
      return { data: null, error: 'Failed to fetch settings.' }
    }
  })

  if (result.error) {
    cacheLife('default')
  } else {
    cacheLife('max')
  }
  return result
}

export const SettingsRepository = {
  async getSettings(): Promise<QueryResult<SettingsMap>> {
    if (!hasDatabaseEnv()) {
      return { data: null, error: 'Database env vars are not configured.' }
    }

    return getCachedSettings()
  },

  async updateSettings(
    settingsArray: Array<{ group: string; key: string; value: string }>,
  ): Promise<QueryResult<Array<typeof settings.$inferSelect>>> {
    return runQuery(async () => {
      const data = await db
        .insert(settings)
        .values(settingsArray)
        .onConflictDoUpdate({
          target: [settings.group, settings.key],
          set: {
            value: sql`EXCLUDED.value`,
          },
        })
        .returning({
          id: settings.id,
          group: settings.group,
          key: settings.key,
          value: settings.value,
          created_at: settings.created_at,
          updated_at: settings.updated_at,
        })

      updateTag(cacheTags.settings)

      return { data, error: null }
    })
  },

  async updateSettingsWithTermsOfService(
    settingsArray: Array<{ group: string; key: string; value: string }>,
    termsOfServiceTranslations: TermsOfServiceTranslationsPatch,
  ): Promise<QueryResult<Array<typeof settings.$inferSelect>>> {
    return runQuery(async () => {
      const data = await db.transaction(async (tx) => {
        const updatedSettings =
          settingsArray.length > 0
            ? await tx
                .insert(settings)
                .values(settingsArray)
                .onConflictDoUpdate({
                  target: [settings.group, settings.key],
                  set: {
                    value: sql`EXCLUDED.value`,
                  },
                })
                .returning({
                  id: settings.id,
                  group: settings.group,
                  key: settings.key,
                  value: settings.value,
                  created_at: settings.created_at,
                  updated_at: settings.updated_at,
                })
            : []

        await upsertTermsOfServiceTranslationsInTransaction(tx, termsOfServiceTranslations)
        return updatedSettings
      })

      updateTag(cacheTags.settings)
      if (Object.keys(termsOfServiceTranslations).length > 0) {
        updateTag(cacheTags.termsOfService)
      }

      return { data, error: null }
    })
  },

  async updateSettingMaxValue(setting: {
    group: string
    key: string
    value: string
  }): Promise<QueryResult<typeof settings.$inferSelect | null>> {
    return runQuery(async () => {
      const rows = await db
        .insert(settings)
        .values(setting)
        .onConflictDoUpdate({
          target: [settings.group, settings.key],
          set: {
            value: sql`GREATEST(${settings.value}, EXCLUDED.value)`,
          },
        })
        .returning()

      updateTag(cacheTags.settings)

      return { data: rows[0] ?? null, error: null }
    })
  },

  async upsertSettingsWithUpdatedAt(
    settingsArray: Array<{ group: string; key: string; value: string; updated_at: Date }>,
  ): Promise<QueryResult<Array<typeof settings.$inferSelect>>> {
    return runQuery(async () => {
      if (settingsArray.length === 0) {
        return { data: [], error: null }
      }

      const data = await db
        .insert(settings)
        .values(settingsArray)
        .onConflictDoUpdate({
          target: [settings.group, settings.key],
          set: {
            value: sql`EXCLUDED.value`,
            updated_at: sql`EXCLUDED.updated_at`,
          },
        })
        .returning({
          id: settings.id,
          group: settings.group,
          key: settings.key,
          value: settings.value,
          created_at: settings.created_at,
          updated_at: settings.updated_at,
        })

      updateTag(cacheTags.settings)

      return { data, error: null }
    })
  },

  async touchSettings(
    settingsArray: Array<{ group: string; key: string }>,
    updatedAt = new Date(),
  ): Promise<QueryResult<Array<typeof settings.$inferSelect>>> {
    return runQuery(async () => {
      if (settingsArray.length === 0) {
        return { data: [], error: null }
      }

      const data = await db.transaction(async (tx) => {
        const touchedRows: Array<typeof settings.$inferSelect> = []

        for (const entry of settingsArray) {
          const rows = await tx
            .update(settings)
            .set({ updated_at: updatedAt })
            .where(and(eq(settings.group, entry.group), eq(settings.key, entry.key)))
            .returning({
              id: settings.id,
              group: settings.group,
              key: settings.key,
              value: settings.value,
              created_at: settings.created_at,
              updated_at: settings.updated_at,
            })

          touchedRows.push(...rows)
        }

        return touchedRows
      })

      updateTag(cacheTags.settings)

      return { data, error: null }
    })
  },

  async deleteSettings(
    settingsArray: Array<{ group: string; key: string }>,
  ): Promise<QueryResult<Array<typeof settings.$inferSelect>>> {
    return runQuery(async () => {
      if (settingsArray.length === 0) {
        return { data: [], error: null }
      }

      const data = await db.transaction(async (tx) => {
        const deletedRows: Array<typeof settings.$inferSelect> = []

        for (const entry of settingsArray) {
          const rows = await tx
            .delete(settings)
            .where(and(eq(settings.group, entry.group), eq(settings.key, entry.key)))
            .returning({
              id: settings.id,
              group: settings.group,
              key: settings.key,
              value: settings.value,
              created_at: settings.created_at,
              updated_at: settings.updated_at,
            })

          deletedRows.push(...rows)
        }

        return deletedRows
      })

      updateTag(cacheTags.settings)

      return { data, error: null }
    })
  },
}
