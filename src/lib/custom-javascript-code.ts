const SCRIPT_TAG_PATTERN = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
const SCRIPT_ATTRIBUTE_PATTERN = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
const CUSTOM_JAVASCRIPT_CODE_TAG_PATTERN = /<script\b/i
export const MAX_CUSTOM_JAVASCRIPT_CODES = 12
export const MAX_CUSTOM_JAVASCRIPT_CODE_NAME_LENGTH = 80
export const MAX_CUSTOM_JAVASCRIPT_CODE_SNIPPET_LENGTH = 20_000
export const DEPOSIT_MODAL_OPEN_EVENT = 'kuest:deposit-modal-open'

export const CUSTOM_JAVASCRIPT_CODE_DISABLE_PAGE_OPTIONS = [
  'home',
  'event',
  'portfolio',
  'settings',
  'docs',
  'admin',
] as const
export type CustomJavascriptCodeDisablePage = (typeof CUSTOM_JAVASCRIPT_CODE_DISABLE_PAGE_OPTIONS)[number]
export type CustomJavascriptCodePageBucket = CustomJavascriptCodeDisablePage | 'other'
export const CUSTOM_JAVASCRIPT_CODE_RUN_ON_OPTIONS = [
  ...CUSTOM_JAVASCRIPT_CODE_DISABLE_PAGE_OPTIONS,
  'other',
  'deposit',
] as const
export type CustomJavascriptCodeRunOn = (typeof CUSTOM_JAVASCRIPT_CODE_RUN_ON_OPTIONS)[number]
export const CUSTOM_JAVASCRIPT_CODE_DEFAULT_RUN_ON: CustomJavascriptCodePageBucket[] = [
  ...CUSTOM_JAVASCRIPT_CODE_DISABLE_PAGE_OPTIONS,
  'other',
]
export type CustomJavascriptCodeAttributeValue = string | true

const CUSTOM_JAVASCRIPT_CODE_DISABLE_PAGE_SET = new Set<string>(CUSTOM_JAVASCRIPT_CODE_DISABLE_PAGE_OPTIONS)
const CUSTOM_JAVASCRIPT_CODE_RUN_ON_SET = new Set<string>(CUSTOM_JAVASCRIPT_CODE_RUN_ON_OPTIONS)
const JAVASCRIPT_REGEX_PREFIX_KEYWORD_SET = new Set([
  'await',
  'case',
  'delete',
  'in',
  'instanceof',
  'new',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
])
const JAVASCRIPT_CONTROL_FLOW_KEYWORD_SET = new Set(['catch', 'do', 'else', 'for', 'if', 'switch', 'while', 'with'])

export interface CustomJavascriptCodeConfig {
  name: string
  snippet: string
  runOn: CustomJavascriptCodeRunOn[]
}

export interface ParsedCustomJavascriptCodeTag {
  id: string
  attributes: Record<string, CustomJavascriptCodeAttributeValue>
  content: string | null
}

function normalizeAttributeName(name: string) {
  switch (name.toLowerCase()) {
    case 'crossorigin':
      return 'crossOrigin'
    case 'fetchpriority':
      return 'fetchPriority'
    case 'nomodule':
      return 'noModule'
    case 'referrerpolicy':
      return 'referrerPolicy'
    default:
      return name
  }
}

function parseScriptAttributes(rawAttributes: string) {
  const attributes: Record<string, CustomJavascriptCodeAttributeValue> = {}
  SCRIPT_ATTRIBUTE_PATTERN.lastIndex = 0

  for (
    let match = SCRIPT_ATTRIBUTE_PATTERN.exec(rawAttributes);
    match;
    match = SCRIPT_ATTRIBUTE_PATTERN.exec(rawAttributes)
  ) {
    const rawName = match[1]
    if (!rawName || rawName === '/') {
      continue
    }

    const value = match[2] ?? match[3] ?? match[4]
    attributes[normalizeAttributeName(rawName)] = value === undefined ? true : value
  }

  return attributes
}

function skipJavascriptString(snippet: string, start: number, quote: '"' | "'" | '`') {
  let index = start + 1

  while (index < snippet.length) {
    const character = snippet[index]

    if (character === '\\') {
      index += 2
      continue
    }

    if (character === quote) {
      return index + 1
    }

    index += 1
  }

  return index
}

function isJavascriptIdentifierStart(character: string | undefined) {
  return !!character && /[A-Z_$]/i.test(character)
}

function isJavascriptIdentifierPart(character: string | undefined) {
  return !!character && /[\w$]/.test(character)
}

function skipJavascriptIdentifier(snippet: string, start: number) {
  let index = start + 1

  while (index < snippet.length && isJavascriptIdentifierPart(snippet[index])) {
    index += 1
  }

  return index
}

function skipJavascriptNumber(snippet: string, start: number) {
  let index = start

  while (index < snippet.length && /[\d_]/.test(snippet[index])) {
    index += 1
  }

  if (snippet[index] === '.' && /\d/.test(snippet[index + 1] ?? '')) {
    index += 1

    while (index < snippet.length && /[\d_]/.test(snippet[index])) {
      index += 1
    }
  }

  if ((snippet[index] === 'e' || snippet[index] === 'E') && /[+\-\d]/.test(snippet[index + 1] ?? '')) {
    const exponentStart = index
    index += 1

    if (snippet[index] === '+' || snippet[index] === '-') {
      index += 1
    }

    const exponentDigitsStart = index
    while (index < snippet.length && /[\d_]/.test(snippet[index])) {
      index += 1
    }

    if (exponentDigitsStart === index) {
      index = exponentStart
    }
  }

  return index
}

function skipLineComment(snippet: string, start: number) {
  let index = start + 2

  while (index < snippet.length && snippet[index] !== '\n') {
    index += 1
  }

  return index
}

function skipBlockComment(snippet: string, start: number) {
  const endIndex = snippet.indexOf('*/', start + 2)

  return endIndex === -1 ? snippet.length : endIndex + 2
}

function skipJavascriptRegexLiteral(snippet: string, start: number) {
  let index = start + 1
  let inCharacterClass = false

  while (index < snippet.length) {
    const character = snippet[index]

    if (character === '\\') {
      index += 2
      continue
    }

    if (inCharacterClass) {
      if (character === ']') {
        inCharacterClass = false
      }

      index += 1
      continue
    }

    if (character === '[') {
      inCharacterClass = true
      index += 1
      continue
    }

    if (character === '/') {
      index += 1

      while (index < snippet.length && /[A-Z]/i.test(snippet[index])) {
        index += 1
      }

      return index
    }

    index += 1
  }

  return snippet.length
}

function startsWithNonScriptHtml(snippet: string, start: number) {
  if (snippet.startsWith('<!--', start)) {
    return true
  }

  if (snippet[start] !== '<') {
    return false
  }

  const previousCharacter = start > 0 ? snippet[start - 1] : ''
  if (previousCharacter && /[\w$]/.test(previousCharacter)) {
    return false
  }

  let index = start + 1
  if (snippet[index] === '/') {
    index += 1
  }

  const firstTagCharacter = snippet[index]
  if (!firstTagCharacter || !/[A-Z]/i.test(firstTagCharacter)) {
    return false
  }

  const lowerCasedSnippet = snippet.toLowerCase()
  if (lowerCasedSnippet.startsWith('script', index)) {
    const nextCharacter = snippet[index + 'script'.length]
    if (!nextCharacter || /[\s/>]/.test(nextCharacter)) {
      return false
    }
  }

  index += 1
  while (index < snippet.length && /[\w:-]/.test(snippet[index])) {
    index += 1
  }

  return index < snippet.length && /[\s/>]/.test(snippet[index])
}

function containsNonScriptHtml(snippet: string) {
  let index = 0
  let expectsExpression = true
  let pendingControlParenthesis = false
  const parenthesisContexts: boolean[] = []

  while (index < snippet.length) {
    const character = snippet[index]
    const nextCharacter = snippet[index + 1]

    if (/\s/.test(character)) {
      index += 1
      continue
    }

    if (character === '"' || character === "'" || character === '`') {
      index = skipJavascriptString(snippet, index, character)
      expectsExpression = false
      pendingControlParenthesis = false
      continue
    }

    if (character === '/' && nextCharacter === '/') {
      index = skipLineComment(snippet, index)
      continue
    }

    if (character === '/' && nextCharacter === '*') {
      index = skipBlockComment(snippet, index)
      continue
    }

    if (character === '/' && expectsExpression) {
      index = skipJavascriptRegexLiteral(snippet, index)
      expectsExpression = false
      pendingControlParenthesis = false
      continue
    }

    if (isJavascriptIdentifierStart(character)) {
      const tokenEnd = skipJavascriptIdentifier(snippet, index)
      const token = snippet.slice(index, tokenEnd)

      index = tokenEnd
      pendingControlParenthesis = JAVASCRIPT_CONTROL_FLOW_KEYWORD_SET.has(token)
      expectsExpression = pendingControlParenthesis || JAVASCRIPT_REGEX_PREFIX_KEYWORD_SET.has(token)
      continue
    }

    if (/\d/.test(character)) {
      index = skipJavascriptNumber(snippet, index)
      expectsExpression = false
      pendingControlParenthesis = false
      continue
    }

    if (character === '<' && startsWithNonScriptHtml(snippet, index)) {
      return true
    }

    if (character === '(') {
      parenthesisContexts.push(pendingControlParenthesis)
      expectsExpression = true
      pendingControlParenthesis = false
      index += 1
      continue
    }

    if (character === ')') {
      expectsExpression = parenthesisContexts.pop() ?? false
      pendingControlParenthesis = false
      index += 1
      continue
    }

    if (character === '+' || character === '-') {
      const isDoubleOperator = nextCharacter === character

      expectsExpression = isDoubleOperator ? expectsExpression : true
      pendingControlParenthesis = false
      index += isDoubleOperator ? 2 : 1
      continue
    }

    if (
      character === '[' ||
      character === '{' ||
      character === ',' ||
      character === ';' ||
      character === ':' ||
      character === '?' ||
      character === '=' ||
      character === '!' ||
      character === '&' ||
      character === '|' ||
      character === '^' ||
      character === '~' ||
      character === '*' ||
      character === '%' ||
      character === '<' ||
      character === '>'
    ) {
      expectsExpression = true
      pendingControlParenthesis = false
      index += 1
      continue
    }

    if (character === '/' && nextCharacter === '=') {
      expectsExpression = true
      pendingControlParenthesis = false
      index += 2
      continue
    }

    if (character === '/') {
      expectsExpression = true
      pendingControlParenthesis = false
      index += 1
      continue
    }

    if (character === '.' || character === ']' || character === '}') {
      expectsExpression = false
      pendingControlParenthesis = false
      index += 1
      continue
    }

    pendingControlParenthesis = false
    index += 1
  }

  return false
}

function validateCustomJavascriptCodeSnippet(value: unknown, sourceLabel: string) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) {
    return { value: null as string | null, error: `${sourceLabel} is required.` }
  }

  if (normalized.length > MAX_CUSTOM_JAVASCRIPT_CODE_SNIPPET_LENGTH) {
    return {
      value: null as string | null,
      error: `${sourceLabel} must be at most ${MAX_CUSTOM_JAVASCRIPT_CODE_SNIPPET_LENGTH.toLocaleString()} characters.`,
    }
  }

  if (containsNonScriptHtml(normalized) && !CUSTOM_JAVASCRIPT_CODE_TAG_PATTERN.test(normalized)) {
    return {
      value: null as string | null,
      error: `${sourceLabel} must be raw JavaScript or a provider <script> snippet.`,
    }
  }

  return { value: normalized, error: null as string | null }
}

function normalizeCustomJavascriptCodeName(value: unknown, sourceLabel: string) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) {
    return { value: null as string | null, error: `${sourceLabel} is required.` }
  }

  if (normalized.length > MAX_CUSTOM_JAVASCRIPT_CODE_NAME_LENGTH) {
    return {
      value: null as string | null,
      error: `${sourceLabel} must be at most ${MAX_CUSTOM_JAVASCRIPT_CODE_NAME_LENGTH} characters.`,
    }
  }

  return { value: normalized, error: null as string | null }
}

function normalizeCustomJavascriptCodeDisabledOn(value: unknown, sourceLabel: string) {
  if (value === undefined || value === null) {
    return { value: [] as CustomJavascriptCodeDisablePage[], error: null as string | null }
  }

  if (!Array.isArray(value)) {
    return { value: [] as CustomJavascriptCodeDisablePage[], error: `${sourceLabel} is invalid.` }
  }

  const deduped: CustomJavascriptCodeDisablePage[] = []
  const seen = new Set<CustomJavascriptCodeDisablePage>()

  for (const entry of value) {
    if (typeof entry !== 'string') {
      return { value: [] as CustomJavascriptCodeDisablePage[], error: `${sourceLabel} is invalid.` }
    }

    if (!CUSTOM_JAVASCRIPT_CODE_DISABLE_PAGE_SET.has(entry)) {
      return { value: [] as CustomJavascriptCodeDisablePage[], error: `${sourceLabel} is invalid.` }
    }

    const normalizedEntry = entry as CustomJavascriptCodeDisablePage

    if (seen.has(normalizedEntry)) {
      continue
    }

    seen.add(normalizedEntry)
    deduped.push(normalizedEntry)
  }

  return { value: deduped, error: null as string | null }
}

function normalizeCustomJavascriptCodeRunOn(value: unknown, sourceLabel: string) {
  if (!Array.isArray(value)) {
    return { value: [] as CustomJavascriptCodeRunOn[], error: `${sourceLabel} is invalid.` }
  }

  const deduped: CustomJavascriptCodeRunOn[] = []
  const seen = new Set<CustomJavascriptCodeRunOn>()

  for (const entry of value) {
    if (typeof entry !== 'string' || !CUSTOM_JAVASCRIPT_CODE_RUN_ON_SET.has(entry)) {
      return { value: [] as CustomJavascriptCodeRunOn[], error: `${sourceLabel} is invalid.` }
    }

    const normalizedEntry = entry as CustomJavascriptCodeRunOn
    if (seen.has(normalizedEntry)) {
      continue
    }

    seen.add(normalizedEntry)
    deduped.push(normalizedEntry)
  }

  return { value: deduped, error: null as string | null }
}

function normalizeCustomJavascriptCodeEntry(value: unknown, index: number) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      value: null as CustomJavascriptCodeConfig | null,
      error: `Custom javascript code ${index + 1} is invalid.`,
    }
  }

  const rawEntry = value as Record<string, unknown>
  const nameValidated = normalizeCustomJavascriptCodeName(rawEntry.name, `Custom javascript code ${index + 1} name`)
  if (nameValidated.error) {
    return { value: null as CustomJavascriptCodeConfig | null, error: nameValidated.error }
  }

  const snippetValidated = validateCustomJavascriptCodeSnippet(
    rawEntry.snippet,
    `Custom javascript code ${index + 1} snippet`,
  )
  if (snippetValidated.error) {
    return { value: null as CustomJavascriptCodeConfig | null, error: snippetValidated.error }
  }

  if (rawEntry.onlyWhenDepositModalOpen !== undefined && typeof rawEntry.onlyWhenDepositModalOpen !== 'boolean') {
    return {
      value: null as CustomJavascriptCodeConfig | null,
      error: `Custom javascript code ${index + 1} deposit modal setting is invalid.`,
    }
  }

  const runOnValidated =
    rawEntry.runOn === undefined
      ? null
      : normalizeCustomJavascriptCodeRunOn(rawEntry.runOn, `Custom javascript code ${index + 1} run on options`)
  if (runOnValidated?.error) {
    return { value: null as CustomJavascriptCodeConfig | null, error: runOnValidated.error }
  }

  const disabledOnValidated = normalizeCustomJavascriptCodeDisabledOn(
    runOnValidated ? rawEntry.legacyDepositDisabledOn : rawEntry.disabledOn,
    `Custom javascript code ${index + 1} disabled pages`,
  )
  if (disabledOnValidated.error) {
    return { value: null as CustomJavascriptCodeConfig | null, error: disabledOnValidated.error }
  }

  const legacyDepositRules = !!runOnValidated && disabledOnValidated.value.length > 0
  const selectedRunOn = runOnValidated
    ? runOnValidated.value
    : CUSTOM_JAVASCRIPT_CODE_DEFAULT_RUN_ON.filter(
        (page) => page === 'other' || !disabledOnValidated.value.includes(page),
      )
  const runOn: CustomJavascriptCodeRunOn[] = runOnValidated
    ? legacyDepositRules && selectedRunOn.includes('deposit')
      ? [
          ...(selectedRunOn.some((context) => context !== 'deposit')
            ? selectedRunOn.filter((context): context is CustomJavascriptCodePageBucket => context !== 'deposit')
            : CUSTOM_JAVASCRIPT_CODE_DEFAULT_RUN_ON
          ).filter((page) => page === 'other' || !disabledOnValidated.value.includes(page)),
          'deposit',
        ]
      : selectedRunOn
    : rawEntry.onlyWhenDepositModalOpen === true
      ? [...selectedRunOn, 'deposit']
      : selectedRunOn

  return {
    value: {
      name: nameValidated.value!,
      snippet: snippetValidated.value!,
      runOn,
    },
    error: null as string | null,
  }
}

export function serializeCustomJavascriptCodes(codes: CustomJavascriptCodeConfig[]) {
  return codes.length > 0 ? JSON.stringify(codes) : ''
}

export function validateCustomJavascriptCodesJson(value: string | null | undefined, sourceLabel: string) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) {
    return {
      value: [] as CustomJavascriptCodeConfig[],
      valueJson: '',
      error: null as string | null,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(normalized)
  } catch {
    return {
      value: null as CustomJavascriptCodeConfig[] | null,
      valueJson: '',
      error: `${sourceLabel} must be valid JSON.`,
    }
  }

  if (!Array.isArray(parsed)) {
    return {
      value: null as CustomJavascriptCodeConfig[] | null,
      valueJson: '',
      error: `${sourceLabel} must be a list of scripts.`,
    }
  }

  if (parsed.length > MAX_CUSTOM_JAVASCRIPT_CODES) {
    return {
      value: null as CustomJavascriptCodeConfig[] | null,
      valueJson: '',
      error: `${sourceLabel} must contain at most ${MAX_CUSTOM_JAVASCRIPT_CODES} scripts.`,
    }
  }

  const normalizedCodes: CustomJavascriptCodeConfig[] = []
  const seenNames = new Set<string>()

  for (const [index, entry] of parsed.entries()) {
    const normalizedEntry = normalizeCustomJavascriptCodeEntry(entry, index)
    if (normalizedEntry.error || !normalizedEntry.value) {
      return {
        value: null as CustomJavascriptCodeConfig[] | null,
        valueJson: '',
        error: normalizedEntry.error ?? `${sourceLabel} is invalid.`,
      }
    }

    const nameKey = normalizedEntry.value.name.toLowerCase()
    if (seenNames.has(nameKey)) {
      return {
        value: null as CustomJavascriptCodeConfig[] | null,
        valueJson: '',
        error: `${sourceLabel} contains duplicate script names.`,
      }
    }

    seenNames.add(nameKey)
    normalizedCodes.push(normalizedEntry.value)
  }

  return {
    value: normalizedCodes,
    valueJson: serializeCustomJavascriptCodes(normalizedCodes),
    error: null as string | null,
  }
}

function normalizePathname(pathname: string | null | undefined) {
  if (!pathname) {
    return '/'
  }

  const normalized = pathname.trim()
  if (!normalized || normalized === '/') {
    return '/'
  }

  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
}

export function resolveCustomJavascriptCodePageBucket(
  pathname: string | null | undefined,
): CustomJavascriptCodePageBucket {
  const normalizedPathname = normalizePathname(pathname)

  if (normalizedPathname === '/') {
    return 'home'
  }

  if (normalizedPathname === '/portfolio' || normalizedPathname.startsWith('/portfolio/')) {
    return 'portfolio'
  }

  if (normalizedPathname === '/settings' || normalizedPathname.startsWith('/settings/')) {
    return 'settings'
  }

  if (normalizedPathname === '/docs' || normalizedPathname.startsWith('/docs/')) {
    return 'docs'
  }

  if (normalizedPathname === '/admin' || normalizedPathname.startsWith('/admin/')) {
    return 'admin'
  }

  if (normalizedPathname.startsWith('/event/')) {
    return 'event'
  }

  return 'other'
}

export function isCustomJavascriptCodeEnabledOnPathname(
  code: { disabledOn: CustomJavascriptCodeDisablePage[] },
  pathname: string | null | undefined,
) {
  const pageBucket = resolveCustomJavascriptCodePageBucket(pathname)
  if (pageBucket === 'other') {
    return true
  }

  return !code.disabledOn.includes(pageBucket)
}

export function isCustomJavascriptCodeConfiguredToRunOnPathname(
  code: Pick<CustomJavascriptCodeConfig, 'runOn'>,
  pathname: string | null | undefined,
) {
  return !code.runOn.includes('deposit') && code.runOn.includes(resolveCustomJavascriptCodePageBucket(pathname))
}

export function isCustomJavascriptCodeConfiguredToRunOnDepositModal(
  code: Pick<CustomJavascriptCodeConfig, 'runOn'>,
  pathname: string | null | undefined,
) {
  const pageBucket = resolveCustomJavascriptCodePageBucket(pathname)
  return code.runOn.includes('deposit') && code.runOn.includes(pageBucket)
}

export function parseCustomJavascriptCodeTags(snippet: string | null | undefined): ParsedCustomJavascriptCodeTag[] {
  const normalized = typeof snippet === 'string' ? snippet.trim() : ''
  if (!normalized) {
    return []
  }

  if (!CUSTOM_JAVASCRIPT_CODE_TAG_PATTERN.test(normalized)) {
    return [
      {
        id: 'custom-javascript-code-tag-0',
        attributes: {},
        content: normalized,
      },
    ]
  }

  const scripts: ParsedCustomJavascriptCodeTag[] = []
  SCRIPT_TAG_PATTERN.lastIndex = 0

  for (let match = SCRIPT_TAG_PATTERN.exec(normalized); match; match = SCRIPT_TAG_PATTERN.exec(normalized)) {
    const content = (match[2] ?? '').trim()
    scripts.push({
      id: `custom-javascript-code-tag-${scripts.length}`,
      attributes: parseScriptAttributes(match[1] ?? ''),
      content: content || null,
    })
  }

  return scripts
}
