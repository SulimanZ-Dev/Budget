import { autoUpdater } from 'electron-updater'
import { app } from 'electron'

export function setupAutoUpdater(): void {
  // Scaffolded but disabled by default — enable in Settings when publish URL is configured
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  if (!app.isPackaged) return

  const enabled = process.env.BUDGET_AUTO_UPDATE === 'true'
  if (!enabled) return

  autoUpdater.checkForUpdatesAndNotify().catch(() => {
    /* silent */
  })
}
