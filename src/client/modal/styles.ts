import type { CSSProperties } from 'react'
/**
 * Inline styles for the news modal (no CSS pipeline in the client bundle —
 * plain style objects keep the build simple and the bundle self-contained).
 */

/** Category accent colors (mirrors shared NEWS_CATEGORIES). */
export const CATEGORY_COLORS: Record<string, string> = {
  world: '#2f6fed',
  ai: '#7c3aed',
  science: '#0d9488',
  history: '#b45309',
}

/** Default text/link color for the modal (light theme). */
export const TEXT = '#1f2937'
export const TEXT_MUTED = '#6b7280'
export const BORDER = '#e5e7eb'
export const BG_MODAL = '#ffffff'
export const BG_HEADER = '#f9fafb'
export const ACCENT = '#2f6fed'

/** Modal overlay + shell. */
export const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9999,
  background: 'rgba(15, 23, 42, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif',
  color: TEXT,
}

export const modalStyle: CSSProperties = {
  width: 'min(760px, calc(100vw - 48px))',
  maxHeight: 'min(82vh, 860px)',
  display: 'flex',
  flexDirection: 'column',
  background: BG_MODAL,
  borderRadius: 12,
  boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
  overflow: 'hidden',
}

export const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 16px',
  background: BG_HEADER,
  borderBottom: `1px solid ${BORDER}`,
  flex: 'none',
}

export const tabStyle = (active: boolean): CSSProperties => ({
  border: 'none',
  background: active ? ACCENT : 'transparent',
  color: active ? '#fff' : TEXT_MUTED,
  padding: '5px 12px',
  borderRadius: 999,
  fontSize: 13,
  cursor: 'pointer',
  fontWeight: active ? 600 : 400,
})

export const iconButtonStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: TEXT_MUTED,
  padding: 6,
  borderRadius: 6,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
}

export const bodyStyle: CSSProperties = {
  overflowY: 'auto',
  padding: '12px 16px 20px',
  flex: '1 1 auto',
  minHeight: 0,
}

export const cardStyle: CSSProperties = {
  display: 'flex',
  gap: 12,
  padding: '10px 4px',
  borderBottom: `1px solid ${BORDER}`,
  cursor: 'pointer',
  alignItems: 'flex-start',
}

export const sourceBadgeStyle = (color: string): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11,
  color: color,
  fontWeight: 600,
  marginBottom: 2,
})

export const titleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  lineHeight: 1.45,
  color: TEXT,
  margin: 0,
}

export const summaryStyle: CSSProperties = {
  fontSize: 12.5,
  color: TEXT_MUTED,
  lineHeight: 1.5,
  marginTop: 3,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
}

export const timeStyle: CSSProperties = {
  fontSize: 11,
  color: TEXT_MUTED,
  marginTop: 4,
}

export const thumbStyle: CSSProperties = {
  width: 88,
  height: 66,
  objectFit: 'cover',
  borderRadius: 8,
  flex: 'none',
  background: '#f3f4f6',
}

export const settingsGroupStyle: CSSProperties = {
  marginBottom: 18,
}

export const settingsLabelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: TEXT_MUTED,
  textTransform: 'uppercase',
  letterSpacing: 0.04,
  marginBottom: 8,
  display: 'block',
}

export const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 10px',
  border: `1px solid ${BORDER}`,
  borderRadius: 8,
  fontSize: 13,
  background: '#fff',
  color: TEXT,
}

export const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '7px 0',
  borderBottom: `1px solid ${BORDER}`,
  fontSize: 13,
}

export const primaryButtonStyle: CSSProperties = {
  border: 'none',
  background: ACCENT,
  color: '#fff',
  padding: '7px 16px',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
}

export const ghostButtonStyle: CSSProperties = {
  border: `1px solid ${BORDER}`,
  background: '#fff',
  color: TEXT,
  padding: '6px 14px',
  borderRadius: 8,
  fontSize: 13,
  cursor: 'pointer',
}
