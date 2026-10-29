// Each category's colour, after the in-game genre colours (the hues of
// donder-tool.llx.life), lightened so the ink text on a label passes AA in
// both themes. The chart card's stripe takes its first category's colour;
// unknown categories have none.
const colors: Record<string, string> = {
  pop: '#60a5fa',
  anime: '#f472b6',
  game: '#c084fc',
  vocaloid: '#9ca3af',
  'virtual-singer': '#9ca3af',
  variety: '#4ade80',
  classic: '#fbbf24',
  classics: '#fbbf24',
  kids: '#fde047',
  namco: '#f87171',
}

export function categoryColor(id: string): string | undefined {
  return colors[id]
}

export function categoryStripeColor(ids: string[] = []) {
  return colors[ids.find((id) => id in colors) ?? ''] ?? 'var(--hero)'
}
