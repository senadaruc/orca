import { z } from 'zod'
import {
  isUnresolvedOwnerHostId,
  parseExecutionHostId,
  type ExecutionHostId
} from './execution-host'

export const GrazrHostRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local') }).strict(),
  z.object({ kind: z.literal('environment'), environmentId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('ssh'), sshTargetId: z.string().min(1) }).strict()
])

export type GrazrHostRef = z.infer<typeof GrazrHostRefSchema>

export function grazrHostRefFromExecutionHostId(id: ExecutionHostId): GrazrHostRef | null {
  if (isUnresolvedOwnerHostId(id)) {
    return null
  }
  const parsed = parseExecutionHostId(id)
  if (parsed === null) {
    return null
  }
  switch (parsed.kind) {
    case 'local':
      return { kind: 'local' }
    case 'ssh':
      return { kind: 'ssh', sshTargetId: parsed.targetId }
    case 'runtime':
      return { kind: 'environment', environmentId: parsed.environmentId }
  }
}

export function grazrHostKey(ref: GrazrHostRef): string {
  switch (ref.kind) {
    case 'local':
      return 'local'
    case 'environment':
      return `env:${ref.environmentId}`
    case 'ssh':
      return `ssh:${ref.sshTargetId}`
  }
}
