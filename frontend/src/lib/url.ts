import { isStep, type Step } from './steps'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface UrlState {
  projectId: string | null
  step: Step | null
  imageId: string | null
}

export function isValidUuid(value: string | null | undefined): boolean {
  return value != null && UUID_PATTERN.test(value)
}

export function readUrlState(): UrlState {
  const params = new URL(window.location.href).searchParams
  const rawStep = params.get('step')
  const step = rawStep === 'finishes' ? 'materials' : rawStep

  if (rawStep === 'finishes') replaceStepUrl('materials')

  return {
    projectId: params.get('project'),
    step: isStep(step) ? step : null,
    imageId: params.get('image'),
  }
}

export function replaceProjectUrl(projectId: string, step: Step): void {
  const url = new URL(window.location.href)
  url.pathname = '/'
  url.search = ''
  url.searchParams.set('project', projectId)
  url.searchParams.set('step', step)
  window.history.replaceState({}, '', url)
}

export function pushStepUrl(step: Step): void {
  const url = new URL(window.location.href)
  url.searchParams.set('step', step)
  window.history.pushState({}, '', url)
}

export function replaceStepUrl(step: Step): void {
  const url = new URL(window.location.href)
  url.searchParams.set('step', step)
  window.history.replaceState({}, '', url)
}

export function replaceImageUrl(imageId: string | null): void {
  const url = new URL(window.location.href)
  if (imageId === null) {
    url.searchParams.delete('image')
  } else {
    url.searchParams.set('image', imageId)
  }
  window.history.replaceState({}, '', url)
}

export function clearProjectUrl(): void {
  const url = new URL(window.location.href)
  url.pathname = '/'
  url.search = ''
  window.history.replaceState({}, '', url)
}
