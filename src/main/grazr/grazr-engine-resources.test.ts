import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GRAZR_ENGINE_FILES,
  readGrazrEngineVersion,
  resolveGrazrEngineRoot
} from './grazr-engine-resources'

const REPO_ROOT = resolve(process.cwd())
const DEV_ENGINE_ROOT = join(REPO_ROOT, 'resources', 'grazr', 'engine')

describe('resolveGrazrEngineRoot', () => {
  it('resolves the engine under the packaged resources directory', () => {
    expect(
      resolveGrazrEngineRoot({
        isPackaged: true,
        resourcesPath: '/Applications/Orca.app/Contents/Resources',
        appPath: '/Applications/Orca.app/Contents/Resources/app.asar'
      })
    ).toBe('/Applications/Orca.app/Contents/Resources/grazr/engine')
  })

  it('resolves the engine under the app checkout when not packaged', () => {
    expect(
      resolveGrazrEngineRoot({
        isPackaged: false,
        resourcesPath: '/unused',
        appPath: REPO_ROOT
      })
    ).toBe(DEV_ENGINE_ROOT)
  })
})

describe('bundled grazr engine resources', () => {
  it('reads the vendored engine version from the VERSION file beside the engine', async () => {
    await expect(readGrazrEngineVersion(DEV_ENGINE_ROOT)).resolves.toBe('0.4.7+fork.13')
  })

  it('rejects with a readable message when no version file sits beside the engine', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'grazr-resources-'))
    try {
      await expect(readGrazrEngineVersion(join(workDir, 'engine'))).rejects.toThrow(
        'Could not read the bundled engine version'
      )
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  })

  it('ships every engine module the rotation runtime imports', async () => {
    expect(GRAZR_ENGINE_FILES).toEqual([
      'grazr.py',
      'claude.py',
      'core.py',
      'accounts.py',
      'stores.py',
      'atomic.py',
      'pins.py',
      'shim.py'
    ])
    for (const file of GRAZR_ENGINE_FILES) {
      const metadata = await stat(join(DEV_ENGINE_ROOT, file))
      expect(metadata.isFile(), file).toBe(true)
    }
  })
})
