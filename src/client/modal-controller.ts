/**
 * Modal open/close controller (framework-free, unit-testable). The sidebar
 * entry and the modal root both bind to this single source of truth.
 */
export class NewsModalController {
  private open = false
  private readonly listeners = new Set<() => void>()

  isOpen(): boolean {
    return this.open
  }

  toggle(): void {
    this.open = !this.open
    this.notify()
  }

  openModal(): void {
    if (this.open) return
    this.open = true
    this.notify()
  }

  close(): void {
    if (!this.open) return
    this.open = false
    this.notify()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch (error) {
        console.error('[dsh-news] listener failed:', error)
      }
    }
  }
}
