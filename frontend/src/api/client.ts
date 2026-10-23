import type { DownloadedFile } from './types'

const NETWORK_MESSAGE =
  "Can't reach the server. Check your connection and try again."
const INVALID_RESPONSE_MESSAGE =
  'The server sent an unexpected response. Try again.'

export interface ApiErrorInit {
  status: number
  code: string
  message: string
  field?: string | null
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly field: string | null

  constructor({ status, code, message, field = null }: ApiErrorInit) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.field = field
  }
}

export interface UploadOptions {
  onProgress?: (progress: number) => void
  signal?: AbortSignal
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  return 'Something went wrong. Please try again.'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function fallbackMessage(status: number): string {
  if (status === 0) return NETWORK_MESSAGE
  if (status === 404) return "We couldn't find that."
  if (status === 405) return "That action isn't available."
  if (status === 422) return 'Some details need attention.'
  if (status >= 500) return 'Something went wrong. Please try again.'
  return "The request didn't go through. Try again."
}

function errorDetailFromBody(
  body: unknown,
): { code: string; message: string; field: string | null } | null {
  if (!isRecord(body) || !isRecord(body.error)) return null
  const { code, message, field } = body.error

  if (typeof code !== 'string' || typeof message !== 'string') return null

  return {
    code,
    message,
    field: typeof field === 'string' ? field : null,
  }
}

function parseErrorText(text: string, status: number): ApiError {
  let body: unknown = null

  if (text.trim()) {
    try {
      body = JSON.parse(text) as unknown
    } catch {
      body = null
    }
  }

  const detail = errorDetailFromBody(body)
  if (detail) {
    return new ApiError({
      status,
      code: detail.code,
      message: detail.message,
      field: detail.field,
    })
  }

  return new ApiError({
    status,
    code: status === 0 ? 'NETWORK_ERROR' : 'REQUEST_FAILED',
    message: fallbackMessage(status),
  })
}

function parseJsonText<T>(text: string, status: number): T {
  if (!text.trim()) {
    throw new ApiError({
      status,
      code: 'INVALID_RESPONSE',
      message: INVALID_RESPONSE_MESSAGE,
    })
  }

  try {
    return JSON.parse(text) as T
  } catch {
    throw new ApiError({
      status,
      code: 'INVALID_RESPONSE',
      message: INVALID_RESPONSE_MESSAGE,
    })
  }
}

async function parseResponseError(response: Response): Promise<ApiError> {
  let text = ''

  try {
    text = await response.text()
  } catch {
    text = ''
  }

  return parseErrorText(text, response.status)
}

async function request(path: string, init: RequestInit): Promise<Response> {
  try {
    const response = await fetch(path, init)
    if (!response.ok) throw await parseResponseError(response)
    return response
  } catch (error) {
    if (error instanceof ApiError || isAbortError(error)) throw error
    throw new ApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: NETWORK_MESSAGE,
    })
  }
}

function withAcceptHeader(init: RequestInit): RequestInit {
  const headers = new Headers(init.headers)
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')
  return { ...init, headers }
}

export async function apiJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await request(path, withAcceptHeader(init))
  const text = await response.text()
  return parseJsonText<T>(text, response.status)
}

export async function apiNoContent(
  path: string,
  init: RequestInit = {},
): Promise<void> {
  await request(path, withAcceptHeader(init))
}

export async function apiBlob(
  path: string,
  init: RequestInit = {},
): Promise<Blob> {
  const response = await request(path, init)

  try {
    return await response.blob()
  } catch {
    throw new ApiError({
      status: response.status,
      code: 'INVALID_RESPONSE',
      message: INVALID_RESPONSE_MESSAGE,
    })
  }
}

function filenameFromContentDisposition(header: string | null): string {
  if (!header) return 'report.pdf'

  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1])
    } catch {
      return utf8Match[1]
    }
  }

  const quotedMatch = header.match(/filename="?([^";]+)"?/i)
  return quotedMatch?.[1] ?? 'report.pdf'
}

export async function apiFile(
  path: string,
  init: RequestInit = {},
): Promise<DownloadedFile> {
  const response = await request(path, init)
  let blob: Blob

  try {
    blob = await response.blob()
  } catch {
    throw new ApiError({
      status: response.status,
      code: 'INVALID_RESPONSE',
      message: INVALID_RESPONSE_MESSAGE,
    })
  }

  return {
    blob,
    filename: filenameFromContentDisposition(
      response.headers.get('Content-Disposition'),
    ),
  }
}

export function uploadFile<T>(
  path: string,
  file: File,
  { onProgress, signal }: UploadOptions = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let settled = false

    const cleanup = () => {
      signal?.removeEventListener('abort', handleAbort)
    }

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }

    const handleAbort = () => {
      xhr.abort()
    }

    xhr.open('POST', path)
    xhr.setRequestHeader('Accept', 'application/json')

    xhr.upload.onprogress = (event) => {
      if (settled || !event.lengthComputable || !onProgress) return
      onProgress(event.loaded / event.total)
    }

    xhr.onload = () => {
      if (xhr.status === 0) {
        finish(() => {
          reject(
            new ApiError({
              status: 0,
              code: 'NETWORK_ERROR',
              message: NETWORK_MESSAGE,
            }),
          )
        })
        return
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        finish(() => {
          try {
            resolve(parseJsonText<T>(xhr.responseText, xhr.status))
          } catch (error) {
            reject(error)
          }
        })
        return
      }

      finish(() => reject(parseErrorText(xhr.responseText, xhr.status)))
    }

    xhr.onerror = () => {
      finish(() => {
        reject(
          new ApiError({
            status: 0,
            code: 'NETWORK_ERROR',
            message: NETWORK_MESSAGE,
          }),
        )
      })
    }

    xhr.onabort = () => {
      finish(() => {
        reject(new DOMException('Upload cancelled.', 'AbortError'))
      })
    }

    if (signal?.aborted) {
      finish(() => {
        reject(new DOMException('Upload cancelled.', 'AbortError'))
      })
      return
    }

    signal?.addEventListener('abort', handleAbort, { once: true })

    const form = new FormData()
    form.append('file', file, file.name || 'photo')
    xhr.send(form)
  })
}
