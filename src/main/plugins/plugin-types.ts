/**
 * Plugin Architecture Types
 * 
 * This defines the contract for Budget app plugins, enabling modular feature development
 * with hot-reload support, sandboxed execution, and lifecycle management.
 */

export interface PluginManifest {
  /** Unique plugin identifier (e.g., "habits-tracker", "crypto-portfolio") */
  id: string
  
  /** Human-readable plugin name */
  name: string
  
  /** Plugin version (semver) */
  version: string
  
  /** Plugin description */
  description: string
  
  /** Plugin author */
  author: string
  
  /** Minimum Budget app version required (semver) */
  minAppVersion: string
  
  /** Maximum Budget app version supported (optional, semver) */
  maxAppVersion?: string
  
  /** Plugin entry point (relative to plugin directory) */
  main: string
  
  /** Renderer entry point for UI components (optional) */
  renderer?: string
  
  /** Plugin icon (optional, relative path or lucide icon name) */
  icon?: string
  
  /** Plugin category */
  category: 'finance' | 'productivity' | 'analytics' | 'integration' | 'utility'
  
  /** Required permissions */
  permissions: PluginPermission[]
  
  /** Database tables this plugin will create/manage */
  tables?: string[]
  
  /** IPC channels this plugin will register */
  ipcChannels?: string[]
  
  /** Navigation routes this plugin adds */
  routes?: PluginRoute[]
  
  /** Settings schema for plugin configuration */
  settings?: PluginSettingSchema[]
  
  /** Plugin dependencies (other plugin IDs) */
  dependencies?: string[]
  
  /** Plugin homepage/repository URL */
  homepage?: string
  
  /** License identifier (SPDX) */
  license?: string
}

export interface PluginRoute {
  /** Route path (e.g., "/habits", "/crypto") */
  path: string
  
  /** Display name in navigation */
  label: string
  
  /** Icon name (lucide-react) */
  icon: string
  
  /** Whether to show in main navigation */
  showInNav: boolean
  
  /** Navigation order (lower = higher priority) */
  order?: number
}

export interface PluginSettingSchema {
  /** Setting key */
  key: string
  
  /** Setting label */
  label: string
  
  /** Setting type */
  type: 'string' | 'number' | 'boolean' | 'select' | 'multiselect'
  
  /** Default value */
  default: unknown
  
  /** Description/help text */
  description?: string
  
  /** Options for select/multiselect */
  options?: Array<{ label: string; value: string | number }>
  
  /** Validation rules */
  validation?: {
    required?: boolean
    min?: number
    max?: number
    pattern?: string
  }
}

export type PluginPermission =
  | 'database:read'
  | 'database:write'
  | 'filesystem:read'
  | 'filesystem:write'
  | 'network:fetch'
  | 'notifications'
  | 'clipboard'
  | 'shell:execute'

export interface PluginContext {
  /** Plugin manifest */
  manifest: PluginManifest
  
  /** Plugin data directory */
  dataDir: string
  
  /** App version */
  appVersion: string
  
  /** Logger instance */
  logger: PluginLogger
  
  /** Database access (if permitted) */
  db?: PluginDatabaseAPI
  
  /** IPC registration */
  ipc: PluginIpcAPI
  
  /** Settings access */
  settings: PluginSettingsAPI
  
  /** Event emitter for plugin lifecycle */
  events: PluginEventEmitter
}

export interface PluginLogger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

export interface PluginDatabaseAPI {
  /** Execute a SELECT query (read-only) */
  query<T = unknown>(sql: string, params?: unknown[]): T[]
  
  /** Execute a single-row SELECT query */
  queryOne<T = unknown>(sql: string, params?: unknown[]): T | undefined
  
  /** Execute an INSERT/UPDATE/DELETE query (requires database:write permission) */
  execute(sql: string, params?: unknown[]): { changes: number; lastInsertRowid: number }
  
  /** Run multiple statements in a transaction */
  transaction(fn: () => void): void
}

export interface PluginIpcAPI {
  /** Register an IPC handler (channel must be declared in manifest) */
  handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void
  
  /** Remove an IPC handler */
  removeHandler(channel: string): void
}

export interface PluginSettingsAPI {
  /** Get a plugin setting */
  get<T = unknown>(key: string): T | undefined
  
  /** Set a plugin setting */
  set(key: string, value: unknown): void
  
  /** Get all plugin settings */
  getAll(): Record<string, unknown>
}

export interface PluginEventEmitter {
  /** Emit an event to other plugins */
  emit(event: string, data?: unknown): void
  
  /** Listen to events from other plugins */
  on(event: string, handler: (data: unknown) => void): void
  
  /** Remove event listener */
  off(event: string, handler: (data: unknown) => void): void
}

export interface Plugin {
  /** Plugin activation (called when plugin is loaded) */
  activate(context: PluginContext): Promise<void> | void
  
  /** Plugin deactivation (called when plugin is unloaded) */
  deactivate?(): Promise<void> | void
  
  /** Plugin configuration update (called when settings change) */
  onConfigChange?(settings: Record<string, unknown>): Promise<void> | void
}

export interface PluginMetadata {
  manifest: PluginManifest
  path: string
  enabled: boolean
  loaded: boolean
  error?: string
}

export interface PluginLoadResult {
  success: boolean
  plugin?: PluginMetadata
  error?: string
}

// Made with Bob
