import { app, ipcMain } from 'electron'
import { cp } from 'node:fs/promises'
import { homedir } from 'node:os'
import { runProcess } from '@orca/process-host'
import { z } from 'zod'
import type { GrazrApi } from '../../shared/grazr-api-types'
import { GrazrHostRefSchema } from '../../shared/grazr-host'
import { createGrazrEngineRunner } from '../grazr/grazr-engine-runner'
import { resolveGrazrEngineRoot } from '../grazr/grazr-engine-resources'
import { resolveGrazrHost } from '../grazr/grazr-host-resolver'
import { createGrazrService } from '../grazr/grazr-service'
import { execCommand } from '../ssh/remote-exec/remote-exec-command'
import { getSshConnectionManager } from '../ssh/targets/ssh-target-registry'
import { listAppRuntimeEnvironments } from './shell-editor-ssh-host'

const HostArgs = z.object({ host: GrazrHostRefSchema }).strict()
const SwapArgs = HostArgs.extend({ name: z.string().min(1).optional() }).strict()
const SetEnabledArgs = HostArgs.extend({ enabled: z.boolean() }).strict()
const InstallArgs = HostArgs.extend({ force: z.boolean() }).strict()

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
    engineRoot: resolveGrazrEngineRoot({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath()
    }),
    copyDir: (from, to) => cp(from, to, { recursive: true, force: true }),
    homedir,
    platform: process.platform
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
