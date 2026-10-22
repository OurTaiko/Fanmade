export async function resolvePlayerUrl({
  manifestUrl,
  parentOrigin,
  signal,
}: {
  manifestUrl: string
  parentOrigin: string
  signal: AbortSignal
}): Promise<string> {
  const manifest = new URL(manifestUrl, parentOrigin)
  const response = await fetch(manifest, { cache: 'no-store', credentials: 'omit', signal })
  if (!response.ok) throw new Error('PLAYER_MANIFEST_UNAVAILABLE')
  const build: unknown = await response.json()
  if (
    !build ||
    typeof build !== 'object' ||
    !('path' in build) ||
    typeof build.path !== 'string' ||
    !/^\/player\/[a-f0-9]{16}\/index\.html$/.test(build.path)
  )
    throw new Error('PLAYER_MANIFEST_INVALID')
  // Paths belong to the manifest's CDN, never the embedding website.
  const url = new URL(build.path, manifest)
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('PLAYER_URL_INVALID')
  url.searchParams.set('parentOrigin', parentOrigin)
  return url.href
}
