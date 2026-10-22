import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { parseTja, ValidationError } from './tja'
import { normalizeTja } from './tja-encoding'

it.skipIf(!process.env.ESE_ROOT)(
  'accepts the local ESE single-audio reference corpus',
  async () => {
    const root = process.env.ESE_ROOT!
    let count = 0
    const walk = async (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory() && entry.name !== '.git') {
          await walk(path)
          continue
        }
        if (!entry.name.endsWith('.tja')) continue
        const bytes = readFileSync(path),
          text = bytes.toString('utf-8')
        const wave = text.match(/^WAVE:(.*)$/m)?.[1].trim() ?? ''
        const normalized = await normalizeTja(bytes, wave)
        expect(new TextDecoder().decode(normalized.data), path).toBe(text.replace(/^\uFEFF/u, ''))
        count++
        if (/^\s*COURSE\s*:\s*(Tower|Dan|5|6)\s*(\/\/.*)?$/im.test(text)) {
          try {
            parseTja(bytes, 'utf-8', wave)
            expect.fail(`unsupported course accepted: ${path}`)
          } catch (e) {
            expect(['TJA_COURSE_UNSUPPORTED', 'TJA_RESOURCE_UNSUPPORTED'], path).toContain(
              (e as ValidationError).code,
            )
          }
        } else if (path.endsWith('02 Anime/Together/Together.tja')) {
          expect(() => parseTja(bytes, 'utf-8', wave)).toThrow(ValidationError)
        } else if (text.includes('#NEXTSONG')) {
          try {
            parseTja(bytes, 'utf-8', wave)
            expect.fail(`multi-audio accepted: ${path}`)
          } catch (e) {
            expect((e as ValidationError).code, path).toBe('TJA_RESOURCE_UNSUPPORTED')
          }
        } else expect(parseTja(bytes, 'utf-8', wave).difficulties.length, path).toBeGreaterThan(0)
      }
    }
    await walk(root)
    expect(count).toBeGreaterThan(0)
    console.info(`Validated ${count} local ESE files`)
  },
  30000,
)
