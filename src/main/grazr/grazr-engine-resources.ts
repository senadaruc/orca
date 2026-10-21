import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const GRAZR_ENGINE_FILES = [
  'grazr.py',
  'claude.py',
  'core.py',
  'accounts.py',
  'stores.py',
  'atomic.py',
  'pins.py',
  'shim.py'
] as const

export function resolveGrazrEngineRoot(options: {
  isPackaged: boolean
  resourcesPath: string
  appPath: string
}): string {
  return options.isPackaged
    ? join(options.resourcesPath, 'grazr', 'engine')
    : join(options.appPath, 'resources', 'grazr', 'engine')
}

export async function readGrazrEngineVersion(root: string): Promise<string> {
  return (await readFile(join(root, '..', 'VERSION'), 'utf8')).trim()
}
