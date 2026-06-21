import { app, ipcMain } from 'electron'
import { join, dirname } from 'path'
import { readFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'fs'
import { getDatabase } from '../database-encrypted'
import type {
  Plugin,
  PluginManifest,
  PluginContext,
  PluginMetadata,
  PluginLoadResult,
  PluginLogger,
  PluginDatabaseAPI,
  PluginIpcAPI,
  PluginSettingsAPI,
  PluginEventEmitter
} from './plugin-types'

/**
 * PluginManager - Manages plugin lifecycle, discovery, and sandboxing
 */
export class PluginManager {
  private plugins: Map<string, LoadedPlugin> = new Map()
  private pluginsDir: string
  private eventHandlers: Map<string, Set<(data: unknown) => void>> = new Map()

  constructor() {
    this.pluginsDir = join(app.getPath('userData'), 'plugins')
    this.ensurePluginsDirectory()
  }

  private ensurePluginsDirectory(): void {
    if (!existsSync(this.pluginsDir)) {
      mkdirSync(this.pluginsDir, { recursive: true })
    }
  }

  /**
   * Discover all plugins in the plugins directory
   */
  async discoverPlugins(): Promise<PluginMetadata[]> {
    const discovered: PluginMetadata[] = []

    try {
      const entries = readdirSync(this.pluginsDir)

      for (const entry of entries) {
        const pluginPath = join(this.pluginsDir, entry)
        const stat = statSync(pluginPath)

        if (!stat.isDirectory()) continue

        const manifestPath = join(pluginPath, 'plugin.json')
        if (!existsSync(manifestPath)) continue

        try {
          const manifestContent = readFileSync(manifestPath, 'utf-8')
          const manifest: PluginManifest = JSON.parse(manifestContent)

          // Validate manifest
          if (!this.validateManifest(manifest)) {
            console.error(`Invalid manifest for plugin at ${pluginPath}`)
            continue
          }

          // Check if plugin is enabled
          const enabled = await this.isPluginEnabled(manifest.id)

          discovered.push({
            manifest,
            path: pluginPath,
            enabled,
            loaded: this.plugins.has(manifest.id)
          })
        } catch (error) {
          console.error(`Failed to load manifest from ${manifestPath}:`, error)
        }
      }
    } catch (error) {
      console.error('Failed to discover plugins:', error)
    }

    return discovered
  }

  /**
   * Load and activate a plugin
   */
  async loadPlugin(pluginId: string): Promise<PluginLoadResult> {
    try {
      // Check if already loaded
      if (this.plugins.has(pluginId)) {
        return {
          success: false,
          error: 'Plugin already loaded'
        }
      }

      // Find plugin
      const plugins = await this.discoverPlugins()
      const pluginMeta = plugins.find((p) => p.manifest.id === pluginId)

      if (!pluginMeta) {
        return {
          success: false,
          error: 'Plugin not found'
        }
      }

      // Check app version compatibility
      if (!this.isVersionCompatible(pluginMeta.manifest)) {
        return {
          success: false,
          error: `Plugin requires app version ${pluginMeta.manifest.minAppVersion}`
        }
      }

      // Load plugin module
      const mainPath = join(pluginMeta.path, pluginMeta.manifest.main)
      if (!existsSync(mainPath)) {
        return {
          success: false,
          error: `Plugin entry point not found: ${pluginMeta.manifest.main}`
        }
      }

      // Dynamic import of plugin
      const pluginModule = require(mainPath) as { default?: Plugin; plugin?: Plugin }
      const plugin = pluginModule.default || pluginModule.plugin

      if (!plugin || typeof plugin.activate !== 'function') {
        return {
          success: false,
          error: 'Plugin does not export a valid activate function'
        }
      }

      // Create plugin context
      const context = this.createPluginContext(pluginMeta)

      // Activate plugin
      await plugin.activate(context)

      // Store loaded plugin
      this.plugins.set(pluginId, {
        manifest: pluginMeta.manifest,
        plugin,
        context,
        path: pluginMeta.path
      })

      // Mark as enabled
      await this.setPluginEnabled(pluginId, true)

      console.log(`Plugin loaded: ${pluginMeta.manifest.name} v${pluginMeta.manifest.version}`)

      return {
        success: true,
        plugin: {
          ...pluginMeta,
          loaded: true,
          enabled: true
        }
      }
    } catch (error) {
      console.error(`Failed to load plugin ${pluginId}:`, error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Unload and deactivate a plugin
   */
  async unloadPlugin(pluginId: string): Promise<boolean> {
    const loaded = this.plugins.get(pluginId)
    if (!loaded) return false

    try {
      // Call deactivate if available
      if (loaded.plugin.deactivate) {
        await loaded.plugin.deactivate()
      }

      // Remove IPC handlers
      for (const channel of loaded.manifest.ipcChannels || []) {
        ipcMain.removeHandler(channel)
      }

      // Remove from loaded plugins
      this.plugins.delete(pluginId)

      console.log(`Plugin unloaded: ${loaded.manifest.name}`)
      return true
    } catch (error) {
      console.error(`Failed to unload plugin ${pluginId}:`, error)
      return false
    }
  }

  /**
   * Reload a plugin (unload + load)
   */
  async reloadPlugin(pluginId: string): Promise<PluginLoadResult> {
    await this.unloadPlugin(pluginId)
    return await this.loadPlugin(pluginId)
  }

  /**
   * Load all enabled plugins
   */
  async loadAllPlugins(): Promise<void> {
    const plugins = await this.discoverPlugins()
    const enabled = plugins.filter((p) => p.enabled)

    for (const plugin of enabled) {
      await this.loadPlugin(plugin.manifest.id)
    }
  }

  /**
   * Get all loaded plugins
   */
  getLoadedPlugins(): PluginMetadata[] {
    return Array.from(this.plugins.values()).map((p) => ({
      manifest: p.manifest,
      path: p.path,
      enabled: true,
      loaded: true
    }))
  }

  /**
   * Create plugin context with sandboxed APIs
   */
  private createPluginContext(pluginMeta: PluginMetadata): PluginContext {
    const dataDir = join(this.pluginsDir, pluginMeta.manifest.id, 'data')
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true })
    }

    const logger = this.createLogger(pluginMeta.manifest.id)
    const db = this.createDatabaseAPI(pluginMeta.manifest)
    const ipc = this.createIpcAPI(pluginMeta.manifest)
    const settings = this.createSettingsAPI(pluginMeta.manifest.id)
    const events = this.createEventEmitter(pluginMeta.manifest.id)

    return {
      manifest: pluginMeta.manifest,
      dataDir,
      appVersion: app.getVersion(),
      logger,
      db,
      ipc,
      settings,
      events
    }
  }

  private createLogger(pluginId: string): PluginLogger {
    const prefix = `[Plugin:${pluginId}]`
    return {
      debug: (msg, ...args) => console.debug(prefix, msg, ...args),
      info: (msg, ...args) => console.info(prefix, msg, ...args),
      warn: (msg, ...args) => console.warn(prefix, msg, ...args),
      error: (msg, ...args) => console.error(prefix, msg, ...args)
    }
  }

  private createDatabaseAPI(manifest: PluginManifest): PluginDatabaseAPI | undefined {
    const hasReadPerm = manifest.permissions.includes('database:read')
    const hasWritePerm = manifest.permissions.includes('database:write')

    if (!hasReadPerm && !hasWritePerm) return undefined

    const db = getDatabase()

    return {
      query: <T = unknown>(sql: string, params?: unknown[]): T[] => {
        if (!hasReadPerm) throw new Error('Plugin does not have database:read permission')
        return db.prepare(sql).all(...(params || [])) as T[]
      },
      queryOne: <T = unknown>(sql: string, params?: unknown[]): T | undefined => {
        if (!hasReadPerm) throw new Error('Plugin does not have database:read permission')
        return db.prepare(sql).get(...(params || [])) as T | undefined
      },
      execute: (sql: string, params?: unknown[]) => {
        if (!hasWritePerm) throw new Error('Plugin does not have database:write permission')
        const result = db.prepare(sql).run(...(params || []))
        return {
          changes: result.changes,
          lastInsertRowid: Number(result.lastInsertRowid)
        }
      },
      transaction: (fn: () => void) => {
        if (!hasWritePerm) throw new Error('Plugin does not have database:write permission')
        db.transaction(fn)()
      }
    }
  }

  private createIpcAPI(manifest: PluginManifest): PluginIpcAPI {
    const allowedChannels = new Set(manifest.ipcChannels || [])

    return {
      handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
        if (!allowedChannels.has(channel)) {
          throw new Error(`Plugin not authorized to register IPC channel: ${channel}`)
        }
        ipcMain.handle(channel, handler)
      },
      removeHandler: (channel: string) => {
        if (!allowedChannels.has(channel)) {
          throw new Error(`Plugin not authorized to remove IPC channel: ${channel}`)
        }
        ipcMain.removeHandler(channel)
      }
    }
  }

  private createSettingsAPI(pluginId: string): PluginSettingsAPI {
    const db = getDatabase()
    const settingsKey = `plugin:${pluginId}`

    return {
      get: <T = unknown>(key: string): T | undefined => {
        const row = db
          .prepare('SELECT value FROM settings WHERE key = ?')
          .get(`${settingsKey}:${key}`) as { value: string } | undefined
        if (!row) return undefined
        try {
          return JSON.parse(row.value) as T
        } catch {
          return undefined
        }
      },
      set: (key: string, value: unknown) => {
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
          `${settingsKey}:${key}`,
          JSON.stringify(value)
        )
      },
      getAll: (): Record<string, unknown> => {
        const rows = db
          .prepare('SELECT key, value FROM settings WHERE key LIKE ?')
          .all(`${settingsKey}:%`) as Array<{ key: string; value: string }>

        const settings: Record<string, unknown> = {}
        for (const row of rows) {
          const key = row.key.replace(`${settingsKey}:`, '')
          try {
            settings[key] = JSON.parse(row.value)
          } catch {
            settings[key] = row.value
          }
        }
        return settings
      }
    }
  }

  private createEventEmitter(pluginId: string): PluginEventEmitter {
    return {
      emit: (event: string, data?: unknown) => {
        const handlers = this.eventHandlers.get(event)
        if (handlers) {
          handlers.forEach((handler) => {
            try {
              handler(data)
            } catch (error) {
              console.error(`Error in event handler for ${event}:`, error)
            }
          })
        }
      },
      on: (event: string, handler: (data: unknown) => void) => {
        if (!this.eventHandlers.has(event)) {
          this.eventHandlers.set(event, new Set())
        }
        this.eventHandlers.get(event)!.add(handler)
      },
      off: (event: string, handler: (data: unknown) => void) => {
        const handlers = this.eventHandlers.get(event)
        if (handlers) {
          handlers.delete(handler)
        }
      }
    }
  }

  private validateManifest(manifest: PluginManifest): boolean {
    return !!(
      manifest.id &&
      manifest.name &&
      manifest.version &&
      manifest.main &&
      manifest.minAppVersion &&
      Array.isArray(manifest.permissions)
    )
  }

  private isVersionCompatible(manifest: PluginManifest): boolean {
    const appVersion = app.getVersion()
    // Simple version check - in production, use semver library
    return appVersion >= manifest.minAppVersion
  }

  private async isPluginEnabled(pluginId: string): Promise<boolean> {
    const db = getDatabase()
    const row = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(`plugin:${pluginId}:enabled`) as { value: string } | undefined

    if (!row) return false
    try {
      return JSON.parse(row.value) === true
    } catch {
      return false
    }
  }

  private async setPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
    const db = getDatabase()
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      `plugin:${pluginId}:enabled`,
      JSON.stringify(enabled)
    )
  }
}

interface LoadedPlugin {
  manifest: PluginManifest
  plugin: Plugin
  context: PluginContext
  path: string
}

// Singleton instance
let pluginManager: PluginManager | null = null

export function getPluginManager(): PluginManager {
  if (!pluginManager) {
    pluginManager = new PluginManager()
  }
  return pluginManager
}

// Made with Bob
