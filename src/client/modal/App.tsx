/**
 * The news modal shell: overlay, Esc/close handling, header with category
 * tabs + refresh + settings, and the list/settings views. The reading view
 * arrives in M4.
 *
 * The component stays mounted for the plugin lifetime; `open` is driven by
 * the modal controller. Opening re-checks the feed TTL (silent refresh).
 */
import { createElement, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { BUILTIN_SOURCES } from '../../shared/sources.ts'
import type { NewsItem } from '../../shared/types.ts'
import type { NewsConfig } from '../config.ts'
import { loadConfig, saveConfig } from '../config.ts'
import { fetchFeed } from '../api.ts'
import { applyFeedResponse, EMPTY_FEED, filterByCategory, needsRefresh, type FeedState } from '../feed-state.ts'
import type { NewsModalController } from '../modal-controller.ts'
import { NEWS_NS, type NewsKey } from '../locales.ts'
import { SettingsView } from './SettingsView.tsx'
import { FeedList } from './FeedList.tsx'
import { ReadingView } from './ReadingView.tsx'
import {
  bodyStyle,
  headerStyle,
  iconButtonStyle,
  modalStyle,
  overlayStyle,
  tabStyle,
} from './styles.ts'

export type View = 'list' | 'reading' | 'settings'

interface AppProps {
  controller: NewsModalController
  t: TranslateNS<typeof NEWS_NS>
  getLocaleRevision: () => number
  subscribeLocale: (fn: () => void) => () => void
}

/** Load the feed through the Host, applying the config's proxy/ttl settings. */
async function loadFeed(
  config: NewsConfig,
  ttlMinutes: number,
  onState: (updater: FeedState | ((previous: FeedState) => FeedState)) => void,
): Promise<void> {
  onState((previous) => ({ ...previous, loading: true, error: false }))
  const sources = [
    ...BUILTIN_SOURCES.filter((s) => !config.disabledSources.includes(s.id)),
    ...config.customSources,
  ]
  if (sources.length === 0) {
    onState({ ...EMPTY_FEED, loading: false })
    return
  }
  try {
    const response = await fetchFeed(sources, {
      ttlMinutes,
      imageProxy: config.imageProxy ?? true,
    })
    const names = new Map(sources.map((source) => [source.id, source.name]))
    onState(applyFeedResponse(response, names))
  } catch {
    onState((previous) => ({ ...previous, loading: false, error: true }))
  }
}

/** Re-render on locale switches (t reads the active locale at call time). */
function useLocaleRevision(getRevision: () => number, subscribe: (fn: () => void) => () => void): void {
  useSyncExternalStore(subscribe, getRevision)
}

export function NewsApp(props: AppProps): ReturnType<typeof createElement> {
  const { controller, t, getLocaleRevision, subscribeLocale } = props
  const open = controller.isOpen()
  useLocaleRevision(getLocaleRevision, subscribeLocale)

  const [view, setView] = useState<View>('list')
  const [category, setCategory] = useState<string>('all')
  const [config, setConfig] = useState<NewsConfig>(() => loadConfig())
  const [feed, setFeed] = useState<FeedState>(EMPTY_FEED)
  const [activeItem, setActiveItem] = useState<NewsItem | undefined>(undefined)

  const configRef = useRef(config)
  configRef.current = config
  const feedRef = useRef(feed)
  feedRef.current = feed
  const ttlMinutes = config.ttlMinutes ?? 15

  const doLoad = (force: boolean): void => {
    const current = configRef.current
    void loadFeed(current, force ? 0 : current.ttlMinutes ?? 15, (updater) => {
      setFeed((previous) => (typeof updater === 'function' ? updater(previous) : updater))
    })
  }
  const loadRef = useRef(doLoad)
  loadRef.current = doLoad

  // On open: silent refresh when the TTL window expired; manual refresh
  // (ttl 0) is handled by the header button.
  useEffect(() => {
    if (open && needsRefresh(feedRef.current, configRef.current.ttlMinutes ?? 15)) {
      loadRef.current(false)
    }
  }, [open])

  // Esc closes the modal.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') controller.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, controller])

  // Close on overlay click (target must be the overlay itself).
  const onOverlayClick = (event: MouseEvent): void => {
    if (event.target === event.currentTarget) controller.close()
  }

  if (!open) {
    return createElement('div', { 'data-dsh-news-modal-hidden': '', style: { display: 'none' } })
  }

  return createElement(
    'div',
    { style: overlayStyle, onClick: onOverlayClick },
    createElement(
      'div',
      { style: modalStyle },
      // Header
      createElement(
        'div',
        { style: headerStyle },
        view === 'settings'
          ? createElement('button', {
            style: { ...iconButtonStyle, fontWeight: 600, color: '#1f2937' },
            onClick: () => setView('list'),
            title: t('settings.back'),
            children: '‹',
          })
          : null,
        createElement('span', { style: { fontSize: 14, fontWeight: 700, marginRight: 4 } }, t('modal.title')),
        // Category tabs
        view === 'list'
          ? createElement(
            'div',
            { style: { display: 'flex', gap: 4, marginLeft: 4, flexWrap: 'wrap' } },
            ['all', 'world', 'ai', 'science', 'history'].map((id) =>
              createElement(
                'button',
                {
                  key: id,
                  style: tabStyle(category === id),
                  onClick: () => setCategory(id),
                  children: t(`tab.${id}` as NewsKey),
                },
              ),
            ),
          )
          : null,
        createElement('div', { style: { flex: 1 } }),
        view === 'list'
          ? createElement('button', {
            style: iconButtonStyle,
            onClick: () => doLoad(true),
            title: t('action.refresh'),
            'aria-label': t('action.refresh'),
            children: createElement('span', { style: { fontSize: 15 } }, '↻'),
          })
          : null,
        createElement('button', {
          style: iconButtonStyle,
          onClick: () => setView(view === 'settings' ? 'list' : 'settings'),
          title: t('action.settings'),
          'aria-label': t('action.settings'),
          children: createElement('span', { style: { fontSize: 15 } }, '⚙'),
        }),
        createElement('button', {
          style: iconButtonStyle,
          onClick: () => controller.close(),
          title: t('modal.close'),
          'aria-label': t('modal.close'),
          children: createElement('span', { style: { fontSize: 15 } }, '✕'),
        }),
      ),
      // Body
      createElement(
        'div',
        { style: bodyStyle },
        view === 'settings'
          ? createElement(SettingsView, {
            t,
            config,
            onChange: (next) => {
              setConfig(next)
              saveConfig(next)
            },
          })
          : view === 'reading' && activeItem !== undefined
            ? createElement(ReadingView, {
              t,
              item: activeItem,
              summaryOnly: config.summaryOnly ?? false,
              onBack: () => setView('list'),
            })
            : createElement(FeedList, {
              t,
              feed,
              category,
              onOpen: (item) => {
                setActiveItem(item)
                setView('reading')
              },
              onRetry: () => doLoad(true),
            }),
      ),
    ),
  )
}
