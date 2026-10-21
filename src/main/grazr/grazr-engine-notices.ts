import { z } from 'zod'
import type { GrazrNotice } from '../../shared/grazr-api-types'

const NoticeSchema = z.object({ ts: z.string(), title: z.string(), body: z.string() })

// Each line is one JSON notice; a line that is not one is skipped.
export function parseGrazrNotices(stdout: string): GrazrNotice[] {
  return stdout.split('\n').flatMap((line) => {
    try {
      const parsed = NoticeSchema.safeParse(JSON.parse(line))
      return parsed.success ? [parsed.data] : []
    } catch {
      return []
    }
  })
}
