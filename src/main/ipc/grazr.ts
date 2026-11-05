import { app, BrowserWindow, ipcMain } from 'electron'
import { cp, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import { z } from 'zod'
import type { GrazrApi } from '../../shared/grazr-api-types'
import { GrazrHostRefSchema } from '../../shared/grazr-host'
import {
  GRAZR_SYNC_STATE_CHANGED_CHANNEL,
  type GrazrSyncSnapshot
} from '../../shared/grazr-sync-types'
import { GrazrSyncCoordinator, type GrazrSyncSaved } from '../grazr/grazr-sync-coordinator'
import { listGrazrSyncDevices } from '../grazr/grazr-sync-devices'
import { translateMain } from '../i18n/main-i18n'
import { AtomicSnapshotWriter } from '../persistence/atomic-snapshot-writer'
import { getRuntimeDesktopSurface } from '../runtime/runtime-desktop-surface'
import { createGrazrEngineRunner } from '../grazr/grazr-engine-runner'
import { readGrazrEngineVersion, resolveGrazrEngineRoot } from '../grazr/grazr-engine-resources'
import { resolveGrazrHost } from '../grazr/grazr-host-resolver'
import { createGrazrService } from '../grazr/grazr-service'
import { execCommand } from '../ssh/remote-exec/remote-exec-command'
import {
  getSshConnectionManager,
  listRegisteredSshTargets
} from '../ssh/targets/ssh-target-registry'
import { listAppRuntimeEnvironments } from './shell-editor-ssh-host'

const HostArgs = z.object({ host: GrazrHostRefSchema }).strict()
const SwapArgs = HostArgs.extend({ name: z.string().min(1).optional() }).strict()
const SetEnabledArgs = HostArgs.extend({ enabled: z.boolean() }).strict()
const InstallArgs = HostArgs.extend({ force: z.boolean() }).strict()
const SetAccountsArgs = HostArgs.extend({ names: z.array(z.string().min(1)) }).strict()
const SyncEnabledArgs = z.object({ enabled: z.boolean() }).strict()
const SyncIncludedArgs = z.object({ deviceKey: z.string().min(1), included: z.boolean() }).strict()

const PlannerStateSchema = z.object({
  orderIds: z.array(z.string()),
  activeId: z.string().nullable(),
  changedAt: z.number().nullable()
})
const SavedSchema = z.object({
  enabled: z.boolean(),
  applied: z.boolean(),
  excluded: z.array(z.string()),
  planner: z
    .object({
      lastSeen: z.record(z.string(), PlannerStateSchema),
      target: z
        .object({
          orderIds: z.array(z.string()),
          activeId: z.string().nullable(),
          at: z.number(),
          source: z.string()
        })
        .nullable(),
      pausedUntil: z.number().nullable(),
      bouncing: z.object({ source: z.string(), follower: z.string() }).nullable()
    })
    .nullable(),
  unsettled: z.array(z.string())
})

const SYNC_INTERVAL_MS = 60_000

const getGrazrConnection = (sshTargetId: string) =>
  getSshConnectionManager()?.getConnection(sshTargetId)

export function createAppGrazrService(): GrazrApi {
  return createGrazrService({
    runner: createGrazrEngineRunner({
      runProcess,
      execCommand,
      homedir,
      platform: process.platform
    }),
    resolve: (host) =>
      resolveGrazrHost(host, {
        listEnvironments: listAppRuntimeEnvironments,
        getConnection: getGrazrConnection,
        platform: process.platform
      }),
    getConnection: getGrazrConnection,
    execCommand,
    resolveEngineRoot: () =>
      resolveGrazrEngineRoot({
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        appPath: app.getAppPath()
      }),
    readEngineVersion: readGrazrEngineVersion,
    copyDir: (from, to) => cp(from, to, { recursive: true, force: true }),
    homedir,
    platform: process.platform
  })
}

// A corrupt or old state file reads as no state: the sync is then off until turned on again.
async function loadSyncState(file: string): Promise<GrazrSyncSaved | null> {
  try {
    const parsed = SavedSchema.safeParse(JSON.parse(await readFile(file, 'utf8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function broadcastSyncState(snapshot: GrazrSyncSnapshot): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue
    }
    try {
      window.webContents.send(GRAZR_SYNC_STATE_CHANGED_CHANNEL, snapshot)
    } catch {
      // A renderer can disappear between isDestroyed() and send().
    }
  }
}

export function createAppGrazrSync(grazr: GrazrApi): GrazrSyncCoordinator {
  const file = join(app.getPath('userData'), 'grazr-sync.json')
  const writer = new AtomicSnapshotWriter(() => file, { fileMode: 0o600 })
  return new GrazrSyncCoordinator({
    grazr,
    listDevices: () =>
      listGrazrSyncDevices({
        listSshTargets: listRegisteredSshTargets,
        listEnvironments: listAppRuntimeEnvironments,
        platform: process.platform,
        localName: translateMain('grazr.main.thisComputer', 'This computer')
      }),
    now: () => Date.now() / 1000,
    intervalMs: SYNC_INTERVAL_MS,
    setTimer: (fn, ms) => {
      const timer = setTimeout(fn, ms)
      return () => clearTimeout(timer)
    },
    load: () => loadSyncState(file),
    save: (saved) => writer.write(() => JSON.stringify(saved)),
    notify: (title, body) => {
      getRuntimeDesktopSurface().showNotification({ title, body })
    },
    broadcast: broadcastSyncState
  })
}

export function registerGrazrSyncHandlers(sync: GrazrSyncCoordinator): void {
  ipcMain.handle('grazr:syncState', () => sync.snapshot())
  ipcMain.handle('grazr:syncSetEnabled', (_event, args: unknown) =>
    sync.setEnabled(SyncEnabledArgs.parse(args).enabled)
  )
  ipcMain.handle('grazr:syncApply', () => sync.apply())
  ipcMain.handle('grazr:syncSetIncluded', (_event, args: unknown) => {
    const parsed = SyncIncludedArgs.parse(args)
    return sync.setIncluded(parsed.deviceKey, parsed.included)
  })
  ipcMain.handle('grazr:syncKick', () => {
    sync.kick()
  })
}

export function registerGrazrHandlers(grazr: GrazrApi): void {
  ipcMain.handle('grazr:status', (_event, args: unknown) => grazr.status(HostArgs.parse(args).host))
  ipcMain.handle('grazr:refresh', (_event, args: unknown) =>
    grazr.refresh(HostArgs.parse(args).host)
  )
  ipcMain.handle('grazr:swap', (_event, args: unknown) => {
    const parsed = SwapArgs.parse(args)
    return grazr.swap(parsed.host, parsed.name)
  })
  ipcMain.handle('grazr:setEnabled', (_event, args: unknown) => {
    const parsed = SetEnabledArgs.parse(args)
    return grazr.setEnabled(parsed.host, parsed.enabled)
  })
  ipcMain.handle('grazr:setAccounts', (_event, args: unknown) => {
    const parsed = SetAccountsArgs.parse(args)
    return grazr.setAccounts(parsed.host, parsed.names)
  })
  ipcMain.handle('grazr:install', (_event, args: unknown) => {
    const parsed = InstallArgs.parse(args)
    return grazr.install(parsed.host, parsed.force)
  })
  ipcMain.handle('grazr:uninstall', (_event, args: unknown) =>
    grazr.uninstall(HostArgs.parse(args).host)
  )
  ipcMain.handle('grazr:deploy', (_event, args: unknown) => grazr.deploy(HostArgs.parse(args).host))
  ipcMain.handle('grazr:enrolCommand', (_event, args: unknown) =>
    grazr.enrolCommand(HostArgs.parse(args).host)
  )
  ipcMain.handle('grazr:drainNotices', (_event, args: unknown) =>
    grazr.drainNotices(HostArgs.parse(args).host)
  )
}
