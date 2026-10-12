import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve('public/edit')
const manifest = JSON.parse(await readFile(resolve(root, 'build.json'), 'utf8'))
if (!/^[a-f0-9]{16}$/.test(manifest.version)) throw new Error('Invalid editor build version')
async function verify(path, record) {
  const bytes = await readFile(path)
  if (bytes.length !== record.bytes || createHash('sha256').update(bytes).digest('hex') !== record.sha256) {
    throw new Error('Editor build mismatch (check Git LFS): ' + path)
  }
}
await verify(resolve(root, 'index.html'), manifest.entry)
for (const file of manifest.files) {
  if (file.path.startsWith('/') || file.path.split('/').includes('..')) throw new Error('Invalid editor asset path')
  await verify(resolve(root, 'builds', manifest.version, file.path), file)
}
console.log('Verified OurTaikoEdit ' + manifest.version)
