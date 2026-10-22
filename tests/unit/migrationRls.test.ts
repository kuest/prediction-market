import { describe, expect, it } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const migrationsDirectory = path.join(process.cwd(), 'src/lib/db/migrations')

function tableNames(sql: string, pattern: RegExp) {
  return [...sql.matchAll(pattern)].map((match) => match[1].toLowerCase())
}

describe('database migrations', () => {
  it('does not activate HOOD or COIN while the new frontend is building', async () => {
    const migration = await readFile(
      path.join(migrationsDirectory, '2026_09_15_017_enable_hood_coin_live_chart_configs.sql'),
      'utf8',
    )
    expect(migration).not.toMatch(/\b(?:UPDATE|INSERT|DELETE)\b/i)
  })

  it('enables row level security for every created table', async () => {
    const migrationFiles = (await readdir(migrationsDirectory)).filter((file) => file.endsWith('.sql')).sort()
    const migrations = await Promise.all(
      migrationFiles.map(async (file) => ({
        file,
        sql: await readFile(path.join(migrationsDirectory, file), 'utf8'),
      })),
    )
    const createdTables = new Map<string, string>()
    const rlsTables = new Set<string>()

    for (const migration of migrations) {
      for (const table of tableNames(
        migration.sql,
        /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?[\w$]+"?\.)?"?([\w$]+)"?/gi,
      )) {
        createdTables.set(table, migration.file)
      }

      for (const table of tableNames(
        migration.sql,
        /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:"?[\w$]+"?\.)?"?([\w$]+)"?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\b/gi,
      )) {
        rlsTables.add(table)
      }
    }

    const missingRls = [...createdTables]
      .filter(([table]) => !rlsTables.has(table))
      .map(([table, migration]) => `${table} (${migration})`)

    expect(missingRls).toEqual([])
  })
})
