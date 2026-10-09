'use client'

import { createOpenAPIPage } from 'fumadocs-openapi/ui'
import { Custom } from 'fumadocs-openapi/ui/playground/client'
import { useExtracted } from 'next-intl'
import { useEffect, useMemo } from 'react'

import { OpenAPIPlaygroundResult } from '@/app/[locale]/docs/_components/OpenAPIPlaygroundResult'
import { Input } from '@/components/ui/input'
import { usePublicRuntimeConfig } from '@/hooks/usePublicRuntimeConfig'

function resolveCreatorHostname(siteUrl: string | undefined): string {
  const raw = siteUrl?.trim()
  if (!raw) {
    return ''
  }

  try {
    return new URL(raw).hostname.trim()
  } catch {
    return ''
  }
}

function syncCreatorControllerValue(
  paramName: string,
  creatorHostname: string,
  controller: ReturnType<typeof Custom.useController>,
) {
  if (paramName !== 'creator') {
    return
  }

  if (controller.value !== creatorHostname) {
    controller.setValue(creatorHostname)
  }
}

function GammaParameterField({ fieldName, param }: { fieldName: (string | number)[]; param: any }) {
  const t = useExtracted()
  const { siteUrl } = usePublicRuntimeConfig()
  const creatorHostname = useMemo(() => resolveCreatorHostname(siteUrl), [siteUrl])
  const schema = param.schema ?? {}
  const controller = Custom.useController(fieldName, {
    defaultValue: param.name === 'creator' ? creatorHostname : schema.default,
  })

  useEffect(
    function syncFixedCreatorParameter() {
      syncCreatorControllerValue(param.name, creatorHostname, controller)
    },
    [controller, creatorHostname, param.name],
  )

  const label = (
    <div className="flex items-center gap-1 text-xs font-medium">
      <span className="font-mono">{param.name}</span>
      {param.required ? <span className="text-red-400">*</span> : null}
    </div>
  )

  const description = param.description ? <p className="text-xs text-muted-foreground">{param.description}</p> : null

  if (param.name === 'creator') {
    return (
      <div className="flex flex-col gap-2">
        {label}
        <Input value={creatorHostname} readOnly aria-readonly="true" className="font-mono" />
        <p className="text-xs text-muted-foreground">{t('Fixed to this site in the docs playground.')}</p>
        {description}
      </div>
    )
  }

  const currentValue =
    typeof controller.value === 'string' || typeof controller.value === 'number'
      ? String(controller.value)
      : typeof controller.value === 'boolean'
        ? String(controller.value)
        : ''

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return (
      <div className="flex flex-col gap-2">
        {label}
        <select
          className="flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm"
          value={currentValue}
          onChange={(event) => controller.setValue(event.target.value || undefined)}
        >
          {!param.required ? <option value="">{t('Unset')}</option> : null}
          {schema.enum.map((option: unknown) => {
            const value = String(option)
            return (
              <option key={value} value={value}>
                {value}
              </option>
            )
          })}
        </select>
        {description}
      </div>
    )
  }

  if (schema.type === 'boolean') {
    const currentValue = typeof controller.value === 'boolean' ? String(controller.value) : ''

    return (
      <div className="flex flex-col gap-2">
        {label}
        <select
          className="flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm"
          value={currentValue}
          onChange={(event) => {
            const value = event.target.value
            controller.setValue(value === '' ? undefined : value === 'true')
          }}
        >
          {!param.required ? <option value="">{t('Unset')}</option> : null}
          <option value="true">{t('True')}</option>
          <option value="false">{t('False')}</option>
        </select>
        {description}
      </div>
    )
  }

  const isNumeric = schema.type === 'integer' || schema.type === 'number'

  return (
    <div className="flex flex-col gap-2">
      {label}
      <Input
        type={isNumeric ? 'number' : 'text'}
        step={schema.type === 'integer' ? 1 : undefined}
        value={currentValue}
        onChange={(event) => {
          if (isNumeric) {
            const nextValue = event.target.value
            controller.setValue(nextValue === '' ? undefined : Number(nextValue))
            return
          }

          controller.setValue(event.target.value)
        }}
      />
      {description}
    </div>
  )
}

export default createOpenAPIPage({
  playground: {
    components: {
      ResultDisplay: OpenAPIPlaygroundResult,
    },
    renderParameterField(fieldName, param) {
      return <GammaParameterField fieldName={fieldName} param={param} />
    },
  },
})
