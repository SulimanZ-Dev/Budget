import { ipcMain } from 'electron'
import { getPluginManager } from '../plugins/plugin-manager'

/**
 * Register IPC handlers for plugin management
 */
export function registerPluginHandlers(): void {
  const pluginManager = getPluginManager()

  // Discover all available plugins
  ipcMain.handle('plugins:discover', async () => {
    return await pluginManager.discoverPlugins()
  })

  // Load a plugin
  ipcMain.handle('plugins:load', async (_, pluginId: string) => {
    return await pluginManager.loadPlugin(pluginId)
  })

  // Unload a plugin
  ipcMain.handle('plugins:unload', async (_, pluginId: string) => {
    return await pluginManager.unloadPlugin(pluginId)
  })

  // Reload a plugin
  ipcMain.handle('plugins:reload', async (_, pluginId: string) => {
    return await pluginManager.reloadPlugin(pluginId)
  })

  // Get loaded plugins
  ipcMain.handle('plugins:loaded', () => {
    return pluginManager.getLoadedPlugins()
  })
}

// Made with Bob
