const moneyWithoutPaise = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const moneyWithPaise = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const UNIT_LABELS: Record<string, string> = {
  sqft: 'sq ft',
  rft: 'rft',
  L: 'L',
  kg: 'kg',
  box: 'box',
}

export function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const paise = Math.round(value * 100)
  const hasPaise = paise % 100 !== 0
  return hasPaise ? moneyWithPaise.format(value) : moneyWithoutPaise.format(value)
}

export function formatNumber(
  value: number,
  maximumFractionDigits = 2,
): string {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(value)
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${Math.round(bytes)} B`

  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${formatNumber(value, 1)} ${units[unitIndex]}`
}

export function formatUnit(unit: string): string {
  return UNIT_LABELS[unit] ?? unit
}

export function formatMeasure(value: number, unit: string): string {
  return `${formatNumber(value, 1)} ${formatUnit(unit)}`
}

export function formatQuantity(value: number, unit: string): string {
  return `${formatNumber(value, 1)} ${formatUnit(unit)}`
}

export function formatPercent(value: number): string {
  return `${formatNumber(value)}%`
}

export function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}
