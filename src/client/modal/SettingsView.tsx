/**
 * Settings view: built-in sources grouped by category with enable/disable
 * toggles, custom source add/remove, and option form (TTL, image proxy,
 * summary-only, RSSHub instance). Changes are staged in a draft and applied
 * atomically on Save.
 */
import { createElement, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { BUILTIN_SOURCES } from '../../shared/sources.ts'
import { NEWS_CATEGORIES, type NewsCategory, type NewsSource } from '../../shared/types.ts'
import type { NewsConfig } from '../config.ts'
import { NEWS_NS, type NewsKey } from '../locales.ts'
import {
  ghostButtonStyle,
  inputStyle,
  primaryButtonStyle,
  rowStyle,
  settingsGroupStyle,
  settingsLabelStyle,
  TEXT_MUTED,
} from './styles.ts'

interface SettingsViewProps {
  t: TranslateNS<typeof NEWS_NS>
  config: NewsConfig
  onChange: (config: NewsConfig) => void
}

const EMPTY_SOURCE: Omit<NewsSource, 'id'> & { id: string } = {
  id: '', name: '', url: '', category: 'world', language: 'zh', builtin: false,
}

export function SettingsView(props: SettingsViewProps): ReturnType<typeof createElement> {
  const { t, config, onChange } = props
  const [draft, setDraft] = useState<NewsConfig>(() => ({
    customSources: config.customSources.map((s) => ({ ...s })),
    disabledSources: [...config.disabledSources],
    rsshubInstance: config.rsshubInstance,
    imageProxy: config.imageProxy ?? true,
    ttlMinutes: config.ttlMinutes ?? 15,
    summaryOnly: config.summaryOnly ?? false,
  }))
  const [newSource, setNewSource] = useState<typeof EMPTY_SOURCE>({ ...EMPTY_SOURCE })
  const [formError, setFormError] = useState<string>('')
  const [saved, setSaved] = useState(false)

  const toggleBuiltin = (id: string): void => {
    const disabled = draft.disabledSources.includes(id)
    setDraft({
      ...draft,
      disabledSources: disabled
        ? draft.disabledSources.filter((x) => x !== id)
        : [...draft.disabledSources, id],
    })
  }

  const removeCustom = (id: string): void => {
    setDraft({ ...draft, customSources: draft.customSources.filter((s) => s.id !== id) })
  }

  const addCustom = (): void => {
    const url = newSource.url.trim()
    if (url === '' || newSource.name.trim() === '') {
      setFormError(t('settings.invalidUrl'))
      return
    }
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      setFormError(t('settings.invalidUrl'))
      return
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      setFormError(t('settings.invalidUrl'))
      return
    }
    if (draft.customSources.some((s) => s.url === url)) {
      setFormError(t('settings.duplicateUrl'))
      return
    }
    setDraft({
      ...draft,
      customSources: [
        ...draft.customSources,
        {
          id: url,
          name: newSource.name.trim(),
          url,
          category: newSource.category as NewsCategory,
          language: newSource.language.trim() === '' ? 'zh' : newSource.language.trim(),
          builtin: false,
        },
      ],
    })
    setNewSource({ ...EMPTY_SOURCE })
    setFormError('')
  }

  const save = (): void => {
    onChange({
      customSources: draft.customSources,
      disabledSources: draft.disabledSources,
      rsshubInstance: draft.rsshubInstance,
      imageProxy: draft.imageProxy,
      ttlMinutes: draft.ttlMinutes,
      summaryOnly: draft.summaryOnly,
    })
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1500)
  }

  return createElement(
    'div',
    null,
    // Option form
    createElement('div', { style: settingsGroupStyle },
      createElement('label', { style: settingsLabelStyle }, t('settings.ttl')),
      createElement('input', {
        type: 'number',
        min: 1,
        max: 1440,
        style: { ...inputStyle, width: 120 },
        value: String(draft.ttlMinutes ?? 15),
        onChange: (event) => setDraft({ ...draft, ttlMinutes: Math.min(1440, Math.max(1, Number(event.target.value) || 15)) }),
      }),
      createElement('label', { style: { ...settingsLabelStyle, marginTop: 12 } }, t('settings.rsshub')),
      createElement('input', {
        type: 'text',
        placeholder: 'https://rsshub.example.com',
        style: inputStyle,
        value: draft.rsshubInstance ?? '',
        onChange: (event) => setDraft({ ...draft, rsshubInstance: event.target.value }),
      }),
      createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13, cursor: 'pointer' } },
        createElement('input', {
          type: 'checkbox',
          checked: draft.imageProxy ?? true,
          onChange: (event) => setDraft({ ...draft, imageProxy: event.target.checked }),
        }),
        t('settings.imageProxy'),
      ),
      createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 13, cursor: 'pointer' } },
        createElement('input', {
          type: 'checkbox',
          checked: draft.summaryOnly ?? false,
          onChange: (event) => setDraft({ ...draft, summaryOnly: event.target.checked }),
        }),
        t('settings.summaryOnly'),
      ),
    ),

    // Built-in sources grouped by category.
    createElement('div', { style: settingsGroupStyle },
      createElement('span', { style: settingsLabelStyle }, t('settings.sources')),
      NEWS_CATEGORIES.map((category) =>
        createElement('div', { key: category.id },
          createElement('div', { style: { fontSize: 12, fontWeight: 600, color: TEXT_MUTED, margin: '10px 0 4px' } }, t(`tab.${category.id}` as NewsKey)),
          BUILTIN_SOURCES
            .filter((source) => source.category === category.id)
            .map((source) =>
              createElement('label', { key: source.id, style: rowStyle, cursor: 'pointer' },
                createElement('input', {
                  type: 'checkbox',
                  checked: !draft.disabledSources.includes(source.id),
                  onChange: () => toggleBuiltin(source.id),
                }),
                createElement('span', { style: { flex: 1 } }, source.name),
                createElement('span', { style: { fontSize: 11, color: TEXT_MUTED } }, source.language.toUpperCase()),
              ),
            ),
        ),
      ),
    ),

    // Custom sources.
    createElement('div', { style: settingsGroupStyle },
      createElement('span', { style: settingsLabelStyle }, t('settings.customSources')),
      draft.customSources.length === 0
        ? createElement('div', { style: { fontSize: 12, color: TEXT_MUTED, padding: '4px 0' } }, t('settings.customEmpty'))
        : draft.customSources.map((source) =>
          createElement('div', { key: source.id, style: rowStyle },
            createElement('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              createElement('span', { style: { fontWeight: 600 } }, source.name),
              createElement('span', { style: { color: TEXT_MUTED, marginLeft: 8, fontSize: 12 } }, source.url),
            ),
            createElement('button', {
              style: ghostButtonStyle,
              onClick: () => removeCustom(source.id),
              children: t('settings.remove'),
            }),
          ),
        ),
      // Add form.
      createElement('div', { style: { display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' } },
        createElement('input', {
          style: { ...inputStyle, width: 140 },
          placeholder: t('settings.name'),
          value: newSource.name,
          onChange: (event) => setNewSource({ ...newSource, name: event.target.value }),
        }),
        createElement('input', {
          style: { ...inputStyle, flex: '1 1 200px' },
          placeholder: t('settings.feedUrl'),
          value: newSource.url,
          onChange: (event) => setNewSource({ ...newSource, url: event.target.value }),
        }),
        createElement('select', {
          style: inputStyle,
          value: newSource.category,
          onChange: (event: { target: { value: string } }) => setNewSource({ ...newSource, category: event.target.value as NewsCategory }),
        },
        NEWS_CATEGORIES.map((category) =>
          createElement('option', { key: category.id, value: category.id }, t(`tab.${category.id}` as NewsKey)),
        ),
        ),
        createElement('button', { style: primaryButtonStyle, onClick: addCustom }, t('settings.addSource')),
      ),
      formError !== '' ? createElement('div', { style: { color: '#dc2626', fontSize: 12, marginTop: 6 } }, formError) : null,
    ),

    createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
      createElement('button', { style: primaryButtonStyle, onClick: save }, t('settings.save')),
      saved ? createElement('span', { style: { color: '#059669', fontSize: 12 } }, t('settings.saved')) : null,
    ),
  )
}
