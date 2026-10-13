// Per-isolate snapshot of growth data that email templates need. Templates are synchronous and only see
// the email context, so the cohort copy is primed here (primeCohort in cohorts.ts) before anything renders
// that uses it: the cohort notice sender always primes first; previews prime through the admin routes.
// Nothing here is ever required: a template without a snapshot falls back to copy without dates.

export interface CohortCopy {
  id: string;
  /** "Monday 3 November" */
  starts: string;
  /** "Friday 24 October" */
  applyBy: string;
  capacity: number;
  open: number;
}

let cohort: CohortCopy | null = null;
let at = 0;

export function setCohortSnapshot(c: CohortCopy | null, now = Date.now()): void {
  cohort = c;
  at = now;
}

/** The next open cohort as last primed in this isolate, or null when unknown or older than an hour. */
export function cohortSnapshot(now = Date.now()): CohortCopy | null {
  return cohort && now - at < 3_600_000 ? cohort : null;
}
