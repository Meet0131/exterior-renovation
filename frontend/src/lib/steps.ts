export const STEPS = [
  { id: 'upload', label: 'Upload' },
  { id: 'regions', label: 'Mark regions' },
  { id: 'materials', label: 'Materials' },
  { id: 'estimate', label: 'Estimate' },
  { id: 'report', label: 'Report' },
] as const

export type Step = (typeof STEPS)[number]['id']

export function isStep(value: string | null | undefined): value is Step {
  return value != null && STEPS.some((step) => step.id === value)
}

export function stepIndex(step: Step): number {
  return STEPS.findIndex((item) => item.id === step)
}

export function stepLabel(step: Step): string {
  return STEPS.find((item) => item.id === step)?.label ?? step
}
