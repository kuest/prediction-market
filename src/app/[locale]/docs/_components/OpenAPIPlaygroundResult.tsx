'use client'

import type { ResultDisplayProps } from 'fumadocs-openapi/ui/playground/client'

import { DefaultResultDisplay } from 'fumadocs-openapi/ui/playground/client'
import { useMemo } from 'react'

import { prettifyJsonResponseBody } from '@/lib/openapi-playground-result'

export function OpenAPIPlaygroundResult(props: ResultDisplayProps) {
  const data = useMemo(() => {
    if (props.data.type !== 'response') {
      return props.data
    }

    const body = prettifyJsonResponseBody(props.data.headers.get('Content-Type'), props.data.body)

    if (!body) {
      return props.data
    }

    const headers = new Headers(props.data.headers)
    headers.delete('content-length')

    return {
      ...props.data,
      headers,
      body,
    }
  }, [props.data])

  return <DefaultResultDisplay {...props} data={data} />
}
