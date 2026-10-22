import { t } from './i18n'
import { ValidationError } from './validation-error'

const invalid = (): never => {
  throw new ValidationError(
    'TJA_ENCODING_INVALID',
    t('messages.cannotDetectTjaEncodingOrTheFileContainsDamagedCharactersSaveIt'),
  )
}
const clean = (text: string, strict = true) => {
  for (const char of text) {
    const point = char.codePointAt(0)!
    if (
      point === 0xfffd ||
      point === 0 ||
      (strict && ((point < 32 && ![9, 10, 13].includes(point)) || (point >= 127 && point <= 159)))
    )
      return false
  }
  return true
}
const utf8 = (text: string, sourceEncoding: string) => ({
  data: new TextEncoder().encode(text.replace(/^\uFEFF/u, '')),
  sourceEncoding,
})
function decode(data: Uint8Array, encoding: string, strict = true): string | null {
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(data)
    return clean(text, strict) ? text : null
  } catch {
    return null
  }
}
function waveMatches(text: string, name: string) {
  const wave = text
    .match(/^\s*WAVE\s*:([^\r\n]*)/m)?.[1]
    .split('//', 1)[0]
    .trim()
  return wave?.normalize('NFC') === name.normalize('NFC')
}
function utf32(data: Uint8Array, littleEndian: boolean) {
  if (data.length % 4) return invalid()
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const text: string[] = []
  for (let i = 4; i < data.length; i += 4) {
    const point = view.getUint32(i, littleEndian)
    if (point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) return invalid()
    text.push(String.fromCodePoint(point))
  }
  const value = text.join('')
  if (!clean(value, false)) return invalid()
  return utf8(value, littleEndian ? 'UTF-32 LE' : 'UTF-32 BE')
}

export async function normalizeTja(data: Uint8Array, audioName: string) {
  const starts = (...prefix: number[]) => prefix.every((byte, i) => data[i] === byte)
  // Test UTF-32 before UTF-16 because the little-endian BOMs share a prefix.
  if (starts(0xff, 0xfe, 0, 0)) return utf32(data, true)
  if (starts(0, 0, 0xfe, 0xff)) return utf32(data, false)
  for (const [bom, encoding] of [
    [[0xef, 0xbb, 0xbf], 'utf-8'],
    [[0xff, 0xfe], 'utf-16le'],
    [[0xfe, 0xff], 'utf-16be'],
  ] as const) {
    if (!starts(...bom)) continue
    const text = decode(data, encoding, false)
    if (text === null) return invalid() // Never guess past an invalid explicit BOM.
    return utf8(text, encoding.toUpperCase())
  }
  // ISO-2022-JP escape sequences are otherwise valid ASCII/UTF-8 bytes.
  if (data.includes(0x1b)) {
    const text = decode(data, 'iso-2022-jp')
    if (text === null) return invalid()
    return utf8(text, 'ISO-2022-JP')
  }
  if (data.includes(0)) {
    const unicode = ['utf-16le', 'utf-16be']
      .map((encoding) => ({ encoding, text: decode(data, encoding, false) }))
      .filter((item) => item.text !== null && /^\s*TITLE:/m.test(item.text))
    if (unicode.length !== 1) return invalid()
    return utf8(unicode[0].text!, unicode[0].encoding.toUpperCase())
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data)
    // Valid Unicode has no statistical ambiguity; preserve existing characters.
    if (!clean(text, false)) return invalid()
    return utf8(text, 'UTF-8')
  } catch (error) {
    if (error instanceof ValidationError) throw error
  }

  // UTF-8 uploads never load the statistical detector. Inspect text-bearing
  // lines so long runs of numeric notes don't drown out short chart metadata.
  const { detectAll } = await import('jschardet')
  let binary = ''
  for (let i = 0; i < data.length; i += 8192)
    binary += String.fromCharCode(...data.subarray(i, i + 8192))
  const sample = binary
    .split('\n')
    .filter((line) => /[\u0080-\u00ff]/u.test(line))
    .join('\n')
  const scores = new Map<string, number>()
  for (const result of detectAll(sample, { minimumThreshold: 0 })) {
    try {
      const encoding = new TextDecoder(result.encoding).encoding
      const key = encoding === 'gbk' ? 'gb18030' : encoding
      scores.set(key, Math.max(scores.get(key) ?? 0, result.confidence))
    } catch {
      /* Unsupported browser decoders are not conversion candidates. */
    }
  }
  const encodings = new Set(['shift_jis', 'gb18030', 'big5', 'euc-jp', 'euc-kr', ...scores.keys()])
  const candidates = new Map<string, { text: string; encoding: string; score: number }>()
  for (const encoding of encodings) {
    const value = decode(data, encoding)
    if (value === null) continue
    const score = scores.get(encoding) ?? 0
    if (!candidates.has(value) || candidates.get(value)!.score < score)
      candidates.set(value, { text: value, encoding, score })
  }
  const all = [...candidates.values()]
  const matching = all.filter((candidate) => waveMatches(candidate.text, audioName))
  // The selected Unicode filename provides stronger evidence than a language
  // guess, especially for short Shift-JIS or Chinese metadata.
  const choices = (matching.length ? matching : all).sort((a, b) => b.score - a.score)
  const best = choices[0]
  if (!best) return invalid()
  const minimum = ['shift_jis', 'gb18030', 'big5', 'euc-jp', 'euc-kr'].includes(best.encoding)
    ? 0.65
    : 0.9
  if (
    matching.length !== 1 &&
    (best.score < minimum || (choices[1] && best.score - choices[1].score < 0.1))
  )
    return invalid()
  return utf8(best.text, best.encoding.toUpperCase().replace('_', '-'))
}
