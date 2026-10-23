export function colorsMatch(
  first: string | null,
  second: string | null,
): boolean {
  if (first === null || second === null) return first === second
  return first.toUpperCase() === second.toUpperCase()
}
