import type { GrazrHostOutcome } from '../../shared/grazr-api-types'

// Why: the bundled version cannot change while the app runs, so one read serves every status.
export function cachedBundledVersion(read: () => Promise<string>): () => Promise<string> {
  let version: Promise<string> | null = null
  return () => {
    version ??= read()
    return version
  }
}

// Why: only a reachable host with a reported version can be known to be behind the bundled engine.
export function isEngineOutdated(
  outcome: GrazrHostOutcome,
  bundledVersion: string | null
): boolean {
  if (outcome.kind !== 'ok' || bundledVersion === null) {
    return false
  }
  const installed = outcome.report.version?.trim() ?? ''
  return installed !== '' && installed !== bundledVersion
}
