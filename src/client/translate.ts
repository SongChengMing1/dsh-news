/**
 * Client-side translation helpers shared by the list (card title + summary)
 * and the reading view (article title + body). Framework-free so they are
 * unit-testable without a DOM or React.
 */
import { translateArticle } from './api.ts'

/** Target language for the translation service, from the GUI locale. */
export function targetLanguageFor(locale: string): string {
  return locale === 'en' ? 'en' : 'zh-CN'
}

/**
 * Translate a card's title + summary into a target language (two parallel
 * requests so the split is reliable; each is cached by the Host, so
 * re-translating the same card is free).
 * @param title - the item title.
 * @param summary - the item summary (may be empty).
 * @param to - target language code.
 * @returns the translated title (when present) and summary.
 */
export async function translateCardTexts(
  title: string,
  summary: string,
  to: string,
): Promise<{ title?: string; summary: string }> {
  const titleJob = title.trim() === '' ? undefined : translateArticle(title, to).then((r) => r.text)
  const summaryJob = summary.trim() === '' ? undefined : translateArticle(summary, to).then((r) => r.text)
  const [titleText, summaryText] = await Promise.all([titleJob, summaryJob])
  return { title: titleText, summary: summaryText ?? '' }
}
