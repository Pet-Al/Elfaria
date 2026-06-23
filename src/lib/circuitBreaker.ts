/**
 * A tiny circuit breaker (doc roadmap, resilience).
 *
 * Guards a flaky downstream (here: Lavalink source resolution). After
 * `threshold` consecutive failures the circuit "opens" and calls fast-fail for
 * `cooldownMs` instead of hammering a struggling service; the first call after
 * the cooldown is allowed through (half-open) and either closes or re-opens it.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;

  constructor(
    private readonly threshold = 5,
    private readonly cooldownMs = 30_000,
  ) {}

  /** True while the breaker is open (calls should fast-fail). */
  isOpen(): boolean {
    if (this.openedAt === 0) return false;
    if (Date.now() - this.openedAt >= this.cooldownMs) {
      // Cooldown elapsed → half-open: let the next call try.
      this.openedAt = 0;
      this.failures = 0;
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = 0;
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.failures >= this.threshold) this.openedAt = Date.now();
  }
}
