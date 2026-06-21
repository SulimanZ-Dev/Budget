import { app, shell, BrowserWindow, ipcMain, nativeTheme, Notification } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { closeDatabase } from './database-encrypted'
import { registerIpcHandlers } from './ipc/handlers'
import { registerEncryptionHandlers } from './ipc/encryption-handlers'
import { registerPluginHandlers } from './ipc/plugin-handlers'
import { getPluginManager } from './plugins/plugin-manager'
import { setupAutoUpdater } from './updater'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0b',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0a0b',
      symbolColor: '#fafafa',
      height: 40
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true, // Enable sandbox for security
      contextIsolation: true, // Already enabled - good
      nodeIntegration: false, // Already disabled - good
      webSecurity: true, // Enforce web security
      allowRunningInsecureContent: false, // Block insecure content
      experimentalFeatures: false, // Disable experimental features
      navigateOnDragDrop: false // Prevent navigation on drag-drop
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.budgetapp.desktop')
  
  // Register encryption handlers first (database init happens after unlock)
  registerEncryptionHandlers()
  registerIpcHandlers(() => mainWindow)
  registerPluginHandlers()
  setupAutoUpdater()
  
  // Load plugins after database is unlocked (handled by encryption-handlers)
  // Plugins will be loaded when database:unlocked event is emitted

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:openExternal', (_, url: string) => shell.openExternal(url))
  ipcMain.handle('theme:get', () => nativeTheme.themeSource)
  ipcMain.handle('theme:set', (_, source: 'system' | 'light' | 'dark') => {
    nativeTheme.themeSource = source
    return nativeTheme.shouldUseDarkColors
  })
  ipcMain.handle('notification:show', (_, { title, body }: { title: string; body: string }) => {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show()
    }
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    closeDatabase()
    app.quit()
  }
})

app.on('before-quit', () => {
  closeDatabase()
})
