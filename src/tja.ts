import { t } from './i18n'
import { parseTjaCourse } from './courses'
import { normalizeTja } from './tja-encoding'
import { ValidationError } from './validation-error'
export { ValidationError } from './validation-error'

export const validationVersion = 'tja-upload-v9'
export const maxTja = 2 * 1024 * 1024
export const maxAudio = 100 * 1024 * 1024
export const maxMovie = 64 * 1024 * 1024
export type Difficulty = {
  course: string
  level: number
  maker: string
}
export type Metadata = {
  isSingle: boolean
  title: string
  subtitle: string
  titleTranslations?: Partial<Record<'en' | 'ja' | 'zh' | 'ko', string>>
  subtitleTranslations?: Partial<Record<'en' | 'ja' | 'zh' | 'ko', string>>
  maker: string
  bpm: number
  offset: number
  demoStart: number
  wave: string
  /** BGMOVIE file name as declared; empty when the chart has no movie. */
  movie: string
  /** MOVIEOFFSET in seconds. */
  movieOffset: number
  difficulties: Difficulty[]
}
const fail = (code: string, message: string, line = 0): never => {
  throw new ValidationError(code, message, line)
}
const bytes = (s: string) => new TextEncoder().encode(s).length
export const isAudioFilename = (name: string) => /\.(ogg|mp3)$/i.test(name)
export const isMovieFilename = (name: string) => /\.(mp4|webm|mov)$/i.test(name)

async function validateAudioHeader(audio: File) {
  const header = new Uint8Array(await audio.slice(0, 10).arrayBuffer())
  if (/\.ogg$/i.test(audio.name)) {
    if (new TextDecoder().decode(header.slice(0, 4)) !== 'OggS')
      fail('AUDIO_INVALID', t('messages.audioIsNotAValidOggFileCheckItsFormat'))
    return
  }
  const id3 =
    header.length === 10 &&
    new TextDecoder().decode(header.slice(0, 3)) === 'ID3' &&
    header[3] >= 2 &&
    header[3] <= 4 &&
    header[4] !== 255 &&
    header.slice(6, 10).every((b) => b < 128)
  if (id3) {
    const tagSize = header.slice(6, 10).reduce((size, b) => size * 128 + b, 0)
    const footer = header[3] === 4 && (header[5] & 16) !== 0 ? 10 : 0
    if (10 + tagSize + footer + 4 <= audio.size) return
  } else if (
    header.length >= 4 &&
    header[0] === 255 &&
    (header[1] & 224) === 224 &&
    ((header[1] >> 3) & 3) !== 1 &&
    ((header[1] >> 1) & 3) === 1 &&
    header[2] >> 4 > 0 &&
    header[2] >> 4 < 15 &&
    ((header[2] >> 2) & 3) !== 3
  )
    return
  // This is a lightweight signature check. The backend validates all frames and decodes the file.
  fail('AUDIO_INVALID', t('messages.audioIsNotAValidMp3FileCheckTheFormatRenamingThe'))
}

export function safeFilename(s: string) {
  return (
    !!s &&
    s !== '.' &&
    s !== '..' &&
    bytes(s) <= 240 &&
    s.trim() === s &&
    !Array.from(s).some((c) => {
      const n = c.codePointAt(0)!
      return n < 32 || (n >= 127 && n <= 159)
    }) &&
    !/[/\\:"<>|?*]/u.test(s)
  )
}
export function parseTja(data: Uint8Array, encoding: string, audioName: string): Metadata {
  const m: Metadata = {
    isSingle: true,
    title: '',
    subtitle: '',
    maker: '',
    bpm: 0,
    offset: 0,
    demoStart: 0,
    wave: '',
    movie: '',
    movieOffset: 0,
    difficulties: [],
  }
  if (!data.length || data.length > maxTja)
    fail('FILE_SIZE_INVALID', t('messages.tjaMustNotBeEmptyOrExceed2Mib'))
  if (!['utf-8', 'shift-jis'].includes(encoding))
    fail('TJA_ENCODING_INVALID', t('messages.unsupportedTextEncoding'))
  let text = ''
  try {
    text = new TextDecoder(encoding === 'shift-jis' ? 'shift_jis' : 'utf-8', { fatal: true })
      .decode(data)
      .replace(/^\uFEFF/, '')
  } catch {
    fail('TJA_ENCODING_INVALID', t('messages.cannotDecodeTextSaveAsUtf8AndSelectAgain'))
  }
  if (text.includes('\uFFFD') || text.includes('\u0000'))
    fail('TJA_ENCODING_INVALID', t('messages.textContainsUnrecognizedCharacters'))
  let waveLine = 0,
    waves = 0,
    started = false,
    inBlock = false,
    hasNotes = false,
    course = 'Oni',
    level = 0,
    style = 'Single'
  const coursesSeen = new Set<string>()
  const seen = new Set<string>()
  for (const [index, raw] of text.replace(/\r\n/g, '\n').split('\n').entries()) {
    const line = index + 1
    if (bytes(raw) > 65536) fail('TJA_STRUCTURE_INVALID', t('messages.aLineExceeds64Kib'), line)
    const s = raw.split('//', 1)[0].trim()
    if (!s) continue
    if (s.startsWith('#NEXTSONG'))
      fail(
        'TJA_RESOURCE_UNSUPPORTED',
        t('messages.songSwitchingAndAdditionalResourcesAreNotSupported'),
        line,
      )
    if (s.startsWith('#START')) {
      if (!['#START', '#START P1', '#START P2'].includes(s) || inBlock || level === 0)
        fail('TJA_STRUCTURE_INVALID', t('messages.eachChartNeedsLevel110AndItsOwnStartEnd'), line)
      started = true
      inBlock = true
      hasNotes = false
      const player = s.slice(6).trim()
      const single = style === 'Single' && !player
      if (!single && !player) fail('TJA_PLAYER_REQUIRED', t('messages.doublePlayerRequired'), line)
      if (m.difficulties.length && m.isSingle !== single)
        fail('TJA_MODE_MIXED', t('messages.mixedChartModes'), line)
      m.isSingle = single
      const courseKey = player ? `${course}_${player === 'P1' ? '1p' : '2p'}` : course
      if (coursesSeen.has(courseKey))
        fail('TJA_DIFFICULTY_DUPLICATE', t('messages.duplicateCourse'), line)
      coursesSeen.add(courseKey)
      m.difficulties.push({ course: courseKey, level, maker: m.maker })
      continue
    }
    if (s === '#END') {
      if (!inBlock || !hasNotes)
        fail('TJA_STRUCTURE_INVALID', t('messages.emptyChartBlockOrEndWithoutStart'), line)
      inBlock = false
      continue
    }
    const colon = s.indexOf(':')
    if (colon < 0) {
      if (inBlock && !s.startsWith('#') && /[0-9]/.test(s)) hasNotes = true
      continue
    }
    const key = s.slice(0, colon).trim(),
      value = s.slice(colon + 1).trim(),
      upper = key.toUpperCase()
    if (upper === 'WAVE') {
      if (key !== 'WAVE') fail('TJA_WAVE_INVALID', t('messages.useUppercaseWave'), line)
      waves++
      if (waves > 1) fail('TJA_WAVE_DUPLICATE', t('messages.waveCanOnlyBeDeclaredOnce'), line)
      if (started)
        fail('TJA_WAVE_SCOPE_INVALID', t('messages.waveMustAppearBeforeTheFirstStart'), line)
      waveLine = line
      m.wave = value
      continue
    }
    if (['LYRICS', 'BGIMAGE'].includes(upper) && value)
      fail('TJA_RESOURCE_UNSUPPORTED', t('messages.onlyTjaWithASingleOggOrMp3IsAccepted'), line)
    if (upper === 'BGMOVIE' || upper === 'MOVIEOFFSET') {
      // The server rewrites or reads these headers back, so they must be unambiguous.
      if (key !== upper || started || seen.has(key))
        fail('TJA_MOVIE_INVALID', t('messages.movieHeaderScopeError', { field: upper }), line)
      seen.add(key)
      if (key === 'BGMOVIE') {
        if (value && (!safeFilename(value) || !isMovieFilename(value)))
          fail('TJA_MOVIE_PATH_INVALID', t('messages.movieFilenameInvalid'), line)
        m.movie = value
      } else if (value) {
        const n = Number(value)
        if (!/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(value) || !(Math.abs(n) <= 1200))
          fail('TJA_MOVIE_OFFSET_INVALID', t('messages.movieOffsetInvalid'), line)
        m.movieOffset = n
      }
      continue
    }
    if (upper === 'STYLE') {
      const parsed = {
        single: 'Single',
        '0': 'Single',
        double: 'Double',
        duet: 'Double',
        '1': 'Double',
      }[value.toLowerCase()]
      if (!parsed || inBlock) fail('TJA_STRUCTURE_INVALID', t('messages.invalidChartStyle'), line)
      style = parsed!
      continue
    }
    if (upper === 'COURSE') {
      if (['tower', 'dan', '5', '6'].includes(value.toLowerCase()))
        fail(
          'TJA_COURSE_UNSUPPORTED',
          t('messages.towerAndDanChartsAreNotSupportedRemoveThoseBlocksAndUpload'),
          line,
        )
      const parsed = parseTjaCourse(value)
      if (!parsed || inBlock || key !== 'COURSE')
        fail(
          'TJA_STRUCTURE_INVALID',
          t('messages.useUppercaseCourseWithEasyNormalHardOniEditOr04'),
          line,
        )
      course = parsed!
      style = 'Single'
      level = 0
      continue
    }
    if (key === 'LEVEL') {
      const n = Number(value)
      if (!/^[+-]?[0-9]+$/.test(value) || !Number.isInteger(n) || n < 1 || n > 10 || inBlock)
        fail('TJA_STRUCTURE_INVALID', t('messages.levelMustBeAnIntegerFrom1To10'), line)
      level = n
      continue
    }
    const localized = /^(TITLE|SUBTITLE)(EN|JA|ZH|KO)$/.exec(key)
    if (localized) {
      if (started || seen.has(key))
        fail('TJA_STRUCTURE_INVALID', t('messages.metadataScopeError', { field: key }), line)
      if (bytes(value) > 500)
        fail('TJA_STRUCTURE_INVALID', t('messages.metadataFieldIsTooLong'), line)
      seen.add(key)
      const field = localized[1] === 'TITLE' ? 'titleTranslations' : 'subtitleTranslations'
      const language = localized[2].toLowerCase() as 'en' | 'ja' | 'zh' | 'ko'
      m[field] = { ...m[field], [language]: value }
      continue
    }
    if (['TITLE', 'SUBTITLE', 'MAKER', 'BPM', 'OFFSET', 'DEMOSTART'].includes(key)) {
      if (started || seen.has(key))
        fail('TJA_STRUCTURE_INVALID', t('messages.metadataScopeError', { field: key }), line)
      seen.add(key)
      if (bytes(value) > 500)
        fail('TJA_STRUCTURE_INVALID', t('messages.metadataFieldIsTooLong'), line)
      switch (key) {
        case 'TITLE':
          m.title = value
          break
        case 'SUBTITLE':
          m.subtitle = value
          break
        case 'MAKER':
          m.maker = value
          break
        default: {
          const n = Number(value)
          if (!/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(value) || !Number.isFinite(n))
            fail('TJA_STRUCTURE_INVALID', t('messages.finiteNumberRequired', { field: key }), line)
          if (key === 'BPM') m.bpm = n
          if (key === 'OFFSET') m.offset = n
          if (key === 'DEMOSTART') m.demoStart = n
        }
      }
    }
  }
  if (!waves || !m.wave)
    fail('TJA_WAVE_MISSING', t('messages.tjaNeedsANonemptyWaveAudioReference'), waveLine)
  if (!safeFilename(m.wave) || !isAudioFilename(m.wave))
    fail(
      'TJA_WAVE_PATH_INVALID',
      t('messages.waveMustBeAnOggOrMp3FilenameWithoutPathsOrQuotes'),
      waveLine,
    )
  if (!safeFilename(audioName))
    fail(
      'UPLOAD_FILENAME_INVALID',
      t('messages.uploadFilenamesCannotContainPathsOrSpecialCharacters'),
    )
  if (m.wave.normalize('NFC') !== audioName.normalize('NFC'))
    throw new ValidationError(
      'TJA_AUDIO_MISMATCH',
      t('messages.audioFilenameMismatch', {
        line: waveLine,
        expected: m.wave,
        actual: audioName,
      }),
      waveLine,
      m.wave,
      audioName,
    )
  if (!m.title || m.bpm <= 0 || inBlock || !m.difficulties.length)
    fail('TJA_STRUCTURE_INVALID', t('messages.titleAPositiveBpmAndCompleteChartBlocksAreRequired'))
  m.titleTranslations = { en: m.title, ...m.titleTranslations }
  m.subtitleTranslations = { en: m.subtitle, ...m.subtitleTranslations }
  return m
}
export type PreparedTja = Metadata & { file: File; sourceEncoding: string }
export async function prepareTja(tja: File, audioName: string): Promise<PreparedTja> {
  if (!safeFilename(tja.name) || !/\.tja$/i.test(tja.name) || !isAudioFilename(audioName))
    fail('UPLOAD_FILES_INVALID', t('messages.selectOneTjaChartAndOneOggOrMp3AudioFile'))
  if (!tja.size || tja.size > maxTja)
    fail('FILE_SIZE_INVALID', t('messages.filesMustNotBeEmptyTjaUpTo2MibAudioUp'))
  const normalized = await normalizeTja(new Uint8Array(await tja.arrayBuffer()), audioName)
  const metadata = parseTja(normalized.data, 'utf-8', audioName)
  return {
    ...metadata,
    sourceEncoding: normalized.sourceEncoding,
    file: new File([normalized.data], tja.name, { type: 'text/plain;charset=utf-8' }),
  }
}

/**
 * A declared BGMOVIE needs its file, under the same name; a replacement may
 * keep the movie the chart already has.
 */
export function validateMovie(metadata: Metadata, movie: File | null, hasStoredMovie = false) {
  if (!movie) {
    if (metadata.movie && !hasStoredMovie)
      fail('TJA_MOVIE_MISSING', t('messages.movieFileRequired', { expected: metadata.movie }))
    return
  }
  if (!metadata.movie) fail('UPLOAD_FILES_INVALID', t('messages.movieNotDeclared'))
  if (!safeFilename(movie.name) || !isMovieFilename(movie.name) || !movie.size)
    fail('UPLOAD_FILES_INVALID', t('messages.movieFileInvalid'))
  if (movie.size > maxMovie) fail('FILE_SIZE_INVALID', t('messages.movieFileInvalid'))
  if (metadata.movie.normalize('NFC') !== movie.name.normalize('NFC'))
    throw new ValidationError(
      'TJA_MOVIE_MISMATCH',
      t('messages.movieFilenameMismatch', { expected: metadata.movie, actual: movie.name }),
      0,
      metadata.movie,
      movie.name,
    )
}

export async function validateFiles(tja: File, audio: File): Promise<PreparedTja> {
  if (!audio.size || audio.size > maxAudio)
    fail('FILE_SIZE_INVALID', t('messages.filesMustNotBeEmptyTjaUpTo2MibAudioUp'))
  const prepared = await prepareTja(tja, audio.name)
  await validateAudioHeader(audio)
  return prepared
}
