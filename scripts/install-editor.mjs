import { createHash } from 'node:crypto'
import { readdir, readFile, mkdir, copyFile, writeFile } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'

const source = process.argv[2]
if (!source) throw new Error('Usage: node scripts/install-editor.mjs <Unity WebGL build directory>')
const root = resolve(source)
async function filesAt(dir, prefix = '') {
  const result = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = prefix + entry.name
    if (entry.isDirectory()) result.push(...await filesAt(join(dir, entry.name), name + '/'))
    else if (entry.isFile()) result.push(name)
    else throw new Error('Unsupported build entry: ' + name)
  }
  return result.sort()
}
const files = await filesAt(root)
for (const file of ['index.html', 'Build/Web.loader.js', 'Build/Web.framework.js', 'Build/Web.data', 'Build/Web.wasm', 'audio/decode.js']) {
  if (!files.includes(file)) throw new Error('Incomplete editor build: ' + file)
}
const hashes = []
for (const file of files) {
  const bytes = await readFile(join(root, file))
  hashes.push({ path: file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
}
const version = createHash('sha256').update(JSON.stringify(hashes)).digest('hex').slice(0, 16)
const target = resolve('public/edit')
const bundle = join(target, 'builds', version)
for (const file of files) {
  await mkdir(dirname(join(bundle, file)), { recursive: true })
  await copyFile(join(root, file), join(bundle, file))
}
const html = (await readFile(join(root, 'index.html'), 'utf8')).replace('<head>', `<head><base href="/edit/builds/${version}/">`)
await writeFile(join(target, 'index.html'), html)
const entry = Buffer.from(html)
await writeFile(join(target, 'build.json'), JSON.stringify({ version, entry: { bytes: entry.length, sha256: createHash('sha256').update(entry).digest('hex') }, files: hashes }, null, 2) + '\n')
console.log('Installed OurTaikoEdit ' + version + ' at /edit/')
