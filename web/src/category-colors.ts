// The stripe colour a chart card takes from its first category; unknown
// categories fall back to the site's hero colour.
const colors: Record<string, string> = {
  game: '#68d0d7',
  variety: '#f3b13c',
  'virtual-singer': '#b99ae8',
  vocaloid: '#b99ae8',
  pop: '#f77fab',
  anime: '#ff6651',
  namco: '#ff6651',
  classic: '#8fd16a',
  classics: '#8fd16a',
  kids: '#ffd36b',
}

export function categoryColor(ids: string[] = []) {
  return colors[ids.find((id) => id in colors) ?? ''] ?? 'var(--hero)'
}
