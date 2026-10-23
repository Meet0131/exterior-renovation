import { getErrorMessage } from '../api/client'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export type SaveStateListener = (
  state: SaveState,
  error: string | null,
) => void

/**
 * Keeps one save in flight and coalesces edits that arrive while it runs.
 * Each resource owns its own queue; a whole-set save must never overlap a
 * per-region save for the same photo.
 */
export class SaveQueue {
  private pending: (() => Promise<void>) | null = null
  private inFlight: Promise<boolean> | null = null
  private lastFailed: (() => Promise<void>) | null = null
  private readonly onState: SaveStateListener

  constructor(onState: SaveStateListener) {
    this.onState = onState
  }

  isBusy(): boolean {
    return this.inFlight !== null || this.pending !== null
  }

  hasFailed(): boolean {
    return this.lastFailed !== null
  }

  schedule(task: () => Promise<void>): void {
    this.pending = task
    this.lastFailed = task

    if (this.inFlight === null) {
      this.inFlight = this.run()
    }
  }

  async flush(): Promise<boolean> {
    if (this.inFlight === null && this.pending !== null) {
      this.inFlight = this.run()
    }

    if (this.inFlight === null) return true
    return this.inFlight
  }

  async retry(): Promise<boolean> {
    if (this.lastFailed !== null) {
      this.pending = this.lastFailed
    }

    if (this.inFlight === null && this.pending !== null) {
      this.inFlight = this.run()
    }

    if (this.inFlight === null) return true
    return this.inFlight
  }

  async flushOrRetry(): Promise<boolean> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (this.inFlight === null && this.pending === null) {
        if (this.lastFailed === null) return true
        if (!(await this.retry())) return false
        continue
      }

      const flushed = await this.flush()
      if (flushed) continue

      if (
        this.inFlight === null &&
        this.pending === null &&
        this.lastFailed !== null
      ) {
        if (!(await this.retry())) return false
        continue
      }

      return false
    }

    return (
      this.inFlight === null &&
      this.pending === null &&
      this.lastFailed === null
    )
  }

  reset(): void {
    this.pending = null
    this.lastFailed = null

    if (this.inFlight === null) this.onState('idle', null)
  }

  private async run(): Promise<boolean> {
    this.onState('saving', null)

    try {
      while (this.pending !== null) {
        const task = this.pending
        this.pending = null
        await task()
      }

      this.lastFailed = null
      this.onState('saved', null)
      return true
    } catch (error) {
      const message = getErrorMessage(error)
      this.pending = null
      this.onState('error', message)
      return false
    } finally {
      this.inFlight = null
    }
  }
}
