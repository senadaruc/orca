import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { translateMain } from '../i18n/main-i18n'

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
  const versionPath = join(root, '..', 'VERSION')
  try {
    return (await readFile(versionPath, 'utf8')).trim()
  } catch (error) {
    throw new Error(
      translateMain(
        'grazr.main.engineVersionUnreadable',
        'Could not read the bundled engine version at {{path}}: {{detail}}',
        { path: versionPath, detail: error instanceof Error ? error.message : String(error) }
      )
    )
  }
}
