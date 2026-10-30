import { t } from '@sitekit/i18n'
import { courseNames, slotKey } from './courses'
import { useTranslation } from 'react-i18next'
import { endpoints } from '@/api/endpoints'
import { DialogClose } from '@sitekit/components/ui/dialog'
import { Label } from '@sitekit/components/ui/label'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@sitekit/components/ui/tabs'
import { Textarea } from '@sitekit/components/ui/textarea'
import { AudioPlayer } from '@sitekit/components/audio-player'
import { Input } from '@sitekit/components/ui/input'
import { Button } from '@sitekit/components/ui/button'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowCounterClockwiseIcon as RotateCcw } from '@phosphor-icons/react'
import { CategoryPicker } from './categories'
import { api, jsonRequest } from '@sitekit/api/client'
import type { Chart, Locale } from './api/types'
import { useNotification } from '@sitekit/notification-context'
import { Modal } from '@sitekit/notifications'

const getLanguages = () =>
  [
    { code: 'en', label: t('messages.english'), caption: 'English' },
    { code: 'ja', label: t('messages.japanese'), caption: '日本語' },
    { code: 'zh', label: t('messages.chinese'), caption: t('messages.chinese') },
    { code: 'ko', label: t('messages.korean'), caption: '한국어' },
  ] as const
type Language = Locale
type Draft = Record<Language, { title: string; subtitle: string; restore: boolean }>
type Patch = {
  title?: string
  subtitle?: string
  description?: string
  difficultyMakers?: { course: string; side: string; maker: string }[]
  demoStart?: number
  demoEnd?: number
  categoryIds?: string[]
  titleTranslations?: Partial<Record<Locale, string | null>>
  subtitleTranslations?: Partial<Record<Locale, string | null>>
}

export function EditMetadata({
  chart,
  csrf,
  onSaved,
  onDismiss,
}: {
  chart: Chart
  csrf: string
  onSaved: (chart: Chart) => void
  onDismiss: () => void
}) {
  const { t } = useTranslation()

  const languages = getLanguages()
  const initial = (code: Language) => ({
    title: chart.titleTranslations[code] ?? (code === 'en' ? chart.title : ''),
    subtitle: chart.subtitleTranslations[code] ?? (code === 'en' ? chart.subtitle : ''),
    restore: false,
  })
  const [draft, setDraft] = useState<Draft>(() => ({
    en: initial('en'),
    ja: initial('ja'),
    zh: initial('zh'),
    ko: initial('ko'),
  }))
  // The chart's own title and subtitle, apart from the translations; editing
  // them leaves the stored TJA as it is.
  const [names, setNames] = useState({ title: chart.title, subtitle: chart.subtitle })
  const namesChanged = names.title !== chart.title || names.subtitle !== chart.subtitle
  const [tab, setTab] = useState('categories')
  const [description, setDescription] = useState(chart.description)
  const [makers, setMakers] = useState(
    chart.difficulties.map(({ course, side, maker }) => ({ course, side, maker })),
  )
  const makersChanged = makers.some((d, i) => d.maker !== chart.difficulties[i].maker)
  const [categoryIds, setCategoryIds] = useState<string[]>(chart.categoryIds ?? [])
  const categoriesChanged =
    [...categoryIds].sort().join() !== [...(chart.categoryIds ?? [])].sort().join()
  const [demoStart, setDemoStart] = useState(String(chart.demoStart))
  const [demoEnd, setDemoEnd] = useState(String(chart.demoEnd ?? chart.demoStart + 15))
  const previewChanged =
    Number(demoStart) !== chart.demoStart ||
    Number(demoEnd) !== (chart.demoEnd ?? chart.demoStart + 15)
  const [busy, setBusy] = useState(false)
  const { notify } = useNotification()
  const setError = (message: string) => notify(message, 'error')
  const firstInput = useRef<HTMLButtonElement>(null)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])

  const changed =
    description !== chart.description ||
    makersChanged ||
    categoriesChanged ||
    previewChanged ||
    namesChanged ||
    languages.some(
      ({ code }) =>
        draft[code].restore ||
        draft[code].title !== initial(code).title ||
        draft[code].subtitle !== initial(code).subtitle,
    )
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (request.current || !changed) return
    const patch: Patch = categoriesChanged ? { categoryIds } : {}
    if (description !== chart.description) patch.description = description
    if (makersChanged) {
      if (
        makers.some(
          ({ maker }) =>
            new TextEncoder().encode(maker.trim()).length > 500 ||
            Array.from(maker.trim()).some((char) => {
              const code = char.codePointAt(0)!
              return code < 32 || (code >= 127 && code <= 159)
            }),
        )
      ) {
        setTab('makers')
        setError(t('messages.makerValidation'))
        return
      }
      patch.difficultyMakers = makers
    }
    if (previewChanged) {
      const start = Number(demoStart),
        end = Number(demoEnd)
      if (
        !demoStart.trim() ||
        !demoEnd.trim() ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        start >= chart.duration ||
        end <= start ||
        end > 1215
      ) {
        setTab('preview')
        setError(t('messages.previewRangeInvalid'))
        return
      }
      patch.demoStart = start
      patch.demoEnd = end
    }
    const invalidText = (text: string) =>
      new TextEncoder().encode(text).length > 500 ||
      Array.from(text).some((char) => {
        const code = char.codePointAt(0)!
        return code < 32 || (code >= 127 && code <= 159)
      })
    if (namesChanged) {
      const title = names.title.trim(),
        subtitle = names.subtitle.trim()
      if (!title || invalidText(title) || invalidText(subtitle)) {
        setTab('translations')
        setError(t('messages.titleIsRequired'))
        return
      }
      patch.title = title
      patch.subtitle = subtitle
    }
    for (const { code, label } of languages) {
      const current = draft[code],
        original = initial(code)
      for (const field of ['title', 'subtitle'] as const) {
        if (!current.restore && current[field] === original[field]) continue
        const text = current[field].trim()
        if (
          !current.restore &&
          (new TextEncoder().encode(text).length > 500 ||
            Array.from(text).some((char) => {
              const code = char.codePointAt(0)!
              return code < 32 || (code >= 127 && code <= 159)
            }))
        ) {
          setTab('translations')
          setError(
            t('messages.metadataValidationError', {
              language: label,
              field: field === 'title' ? t('messages.title') : t('messages.subtitle'),
            }),
          )
          return
        }
        if (code === 'en' && !current.restore && field === 'title' && !text) {
          setTab('translations')
          setError(t('messages.englishTitleIsRequired'))
          return
        }
        const key = field === 'title' ? 'titleTranslations' : 'subtitleTranslations'
        patch[key] = {
          ...patch[key],
          [code]: current.restore || (field === 'title' && !text) ? null : text,
        }
      }
    }
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    try {
      const updated = await api<Chart>(endpoints.chart(chart.id), {
        ...jsonRequest('PATCH', patch, csrf),
        signal: controller.signal,
      })
      onSaved(updated)
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message)
    } finally {
      request.current = null
      setBusy(false)
    }
  }
  return (
    <Modal
      title={t('messages.editChartInformation')}
      initialFocus={firstInput}
      busy={busy}
      onDismiss={onDismiss}
      actions={null}
      className="sm:max-w-3xl"
    >
      <form onSubmit={submit} aria-busy={busy} noValidate>
        <div className="space-y-6">
          <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
            <div className="overflow-x-auto pb-1">
              <TabsList
                aria-label={t('messages.editChartInformation')}
                className="grid h-auto! w-full grid-cols-3 rounded-[14px] sm:grid-cols-5"
              >
                {(['categories', 'preview', 'description', 'makers', 'translations'] as const).map(
                  (value) => (
                    <TabsTrigger
                      key={value}
                      className="h-auto py-2"
                      value={value}
                      disabled={busy}
                      ref={value === 'categories' ? firstInput : undefined}
                    >
                      {t(`messages.metadataTab_${value}`)}
                    </TabsTrigger>
                  ),
                )}
              </TabsList>
            </div>
            <TabsContent value="categories" className="pt-3">
              <CategoryPicker value={categoryIds} disabled={busy} onChange={setCategoryIds} />
            </TabsContent>
            <TabsContent value="preview" className="pt-3">
              <fieldset disabled={busy} className="space-y-3 rounded-[14px] border p-4">
                <legend className="px-2 font-medium">{t('messages.previewRange')}</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Label htmlFor="edit-demo-start" className="flex flex-col items-start gap-2">
                    {t('messages.previewStartSeconds')}
                    <Input
                      id="edit-demo-start"
                      type="number"
                      min="0"
                      step="any"
                      required
                      value={demoStart}
                      onChange={(e) => setDemoStart(e.target.value)}
                    />
                  </Label>
                  <Label htmlFor="edit-demo-end" className="flex flex-col items-start gap-2">
                    {t('messages.previewEndSeconds')}
                    <Input
                      id="edit-demo-end"
                      type="number"
                      min="0"
                      max="1215"
                      step="any"
                      required
                      value={demoEnd}
                      onChange={(e) => setDemoEnd(e.target.value)}
                    />
                  </Label>
                </div>
                <AudioPlayer
                  label={t('messages.audioPreview')}
                  src={endpoints.resource(chart, 'audio')}
                  startAt={demoStart.trim() ? Number(demoStart) : NaN}
                  endAt={demoEnd.trim() ? Number(demoEnd) : NaN}
                  knownDuration={chart.duration}
                  disabled={busy || Number(demoEnd) > 1215}
                />
              </fieldset>
            </TabsContent>
            <TabsContent value="description" className="space-y-3 pt-3">
              <Label htmlFor="edit-description">{t('messages.metadataTab_description')}</Label>
              <Textarea
                id="edit-description"
                rows={6}
                maxLength={1000}
                value={description}
                disabled={busy}
                onChange={(e) => setDescription(e.target.value)}
              />
              <p className="text-right text-xs text-muted-foreground">
                {description.length} / 1000
              </p>
            </TabsContent>
            <TabsContent value="makers" className="space-y-4 pt-3">
              {makers.map((d, index) => (
                <div key={slotKey(d)} className="space-y-2">
                  <Label htmlFor={`edit-maker-${slotKey(d)}`}>
                    {courseNames[slotKey(d) as keyof typeof courseNames] ?? slotKey(d)} ★
                    {chart.difficulties[index].level}
                  </Label>
                  <Input
                    id={`edit-maker-${slotKey(d)}`}
                    value={d.maker}
                    maxLength={500}
                    disabled={busy}
                    placeholder={t('messages.notSpecified')}
                    onChange={(e) =>
                      setMakers((current) =>
                        current.map((item) =>
                          slotKey(item) === slotKey(d) ? { ...item, maker: e.target.value } : item,
                        ),
                      )
                    }
                  />
                </div>
              ))}
            </TabsContent>
            <TabsContent value="translations" className="space-y-4 pt-3">
              <fieldset
                className="min-w-0 space-y-4 rounded-[14px] border p-4 [&>legend]:px-2 [&>legend]:font-medium"
                disabled={busy}
              >
                <legend>{t('messages.originalNames')}</legend>
                <div className="grid gap-4 sm:grid-cols-2 [&>label]:flex [&>label]:flex-col [&>label]:items-start [&>label]:gap-2">
                  <Label htmlFor="edit-original-title">
                    {t('messages.title')}
                    <Input
                      id="edit-original-title"
                      value={names.title}
                      required
                      maxLength={500}
                      autoComplete="off"
                      onChange={(e) => setNames((n) => ({ ...n, title: e.target.value }))}
                    />
                  </Label>
                  <Label htmlFor="edit-original-subtitle">
                    {t('messages.subtitle')}
                    <Input
                      id="edit-original-subtitle"
                      value={names.subtitle}
                      maxLength={500}
                      autoComplete="off"
                      placeholder={t('messages.optional')}
                      onChange={(e) => setNames((n) => ({ ...n, subtitle: e.target.value }))}
                    />
                  </Label>
                </div>
                <small className="text-muted-foreground">{t('messages.originalNamesHint')}</small>
              </fieldset>
              {languages.map(({ code, label, caption }) => (
                <fieldset
                  key={code}
                  className="min-w-0 space-y-4 rounded-[14px] border p-4 [&>legend]:px-2 [&>legend]:font-medium [&>legend_span]:ml-2 [&>legend_span]:text-xs [&>legend_span]:text-muted-foreground"
                  disabled={busy}
                >
                  <legend>
                    {label}
                    <span>{caption}</span>
                  </legend>
                  <div className="grid gap-4 sm:grid-cols-2 [&>label]:flex [&>label]:flex-col [&>label]:items-start [&>label]:gap-2">
                    <Label htmlFor={`edit-${code}-title`}>
                      {t('messages.localizedTitle', { language: label })}
                      <Input
                        id={`edit-${code}-title`}
                        value={draft[code].title}
                        required={code === 'en' && !draft[code].restore}
                        disabled={draft[code].restore}
                        maxLength={500}
                        autoComplete="off"
                        placeholder={
                          code === 'en'
                            ? t('messages.originalEnglishTitle')
                            : t('messages.noTranslation')
                        }
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, [code]: { ...d[code], title: e.target.value } }))
                        }
                      />
                    </Label>
                    <Label htmlFor={`edit-${code}-subtitle`}>
                      {t('messages.localizedSubtitle', { language: label })}
                      <Input
                        id={`edit-${code}-subtitle`}
                        value={draft[code].subtitle}
                        disabled={draft[code].restore}
                        maxLength={500}
                        autoComplete="off"
                        placeholder={t('messages.optional')}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            [code]: { ...d[code], subtitle: e.target.value },
                          }))
                        }
                      />
                    </Label>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between [&>small]:text-muted-foreground">
                    <small>
                      {draft[code].restore
                        ? t('messages.restoreTheFileSTitleAndSubtitleWhenSaved')
                        : code === 'en'
                          ? t('messages.englishTitleIsRequiredSubtitleCanBeEmpty')
                          : t(
                              'messages.clearingATranslatedTitleRestoresTheFileSValueSubtitleCanBe',
                            )}
                    </small>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          [code]: { ...d[code], restore: !d[code].restore },
                        }))
                      }
                    >
                      <RotateCcw size={13} />
                      {draft[code].restore
                        ? t('messages.undoLanguageRestore', { language: label })
                        : t('messages.restoreLanguage', { language: label })}
                    </Button>
                  </div>
                </fieldset>
              ))}
            </TabsContent>
          </Tabs>
        </div>
        <footer className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t pt-4 [&>span]:mr-auto">
          <span className="text-sm text-muted-foreground">
            {busy
              ? t('messages.saving')
              : changed
                ? t('messages.unsavedChanges')
                : t('messages.makeChangesToSave')}
          </span>
          <DialogClose
            render={<Button type="button" variant="outline" size="default" />}
            disabled={busy}
          >
            {t('messages.cancel')}
          </DialogClose>
          <Button type="submit" variant="default" size="default" disabled={busy || !changed}>
            {busy ? t('messages.saving2') : t('messages.saveChanges')}
          </Button>
        </footer>
      </form>
    </Modal>
  )
}
