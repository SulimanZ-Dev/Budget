# Budget App Plugin System

The Budget app features a powerful plugin architecture that enables modular feature development with hot-reload support, sandboxed execution, and comprehensive lifecycle management.

## Table of Contents

- [Overview](#overview)
- [Plugin Structure](#plugin-structure)
- [Creating a Plugin](#creating-a-plugin)
- [Plugin Manifest](#plugin-manifest)
- [Plugin API](#plugin-api)
- [Permissions](#permissions)
- [Best Practices](#best-practices)
- [Example Plugin](#example-plugin)

## Overview

Plugins extend Budget's functionality by:
- Adding new pages and navigation routes
- Creating custom database tables
- Registering IPC handlers for main-renderer communication
- Providing configurable settings
- Integrating with the core app through events

### Key Features

- **Sandboxed Execution**: Plugins run with explicit permissions
- **Hot Reload**: Reload plugins without restarting the app
- **Type Safety**: Full TypeScript support with typed APIs
- **Lifecycle Management**: Activate/deactivate hooks for resource cleanup
- **Event System**: Inter-plugin communication via events
- **Settings Management**: Built-in configuration storage

## Plugin Structure

```
plugins/
└── my-plugin/
    ├── plugin.json          # Plugin manifest
    ├── index.ts             # Main entry point
    ├── renderer.tsx         # UI components (optional)
    ├── data/                # Plugin data directory (auto-created)
    └── README.md            # Plugin documentation
```

## Creating a Plugin

### 1. Create Plugin Directory

```bash
mkdir -p %APPDATA%/BudgetApp/plugins/my-plugin
cd %APPDATA%/BudgetApp/plugins/my-plugin
```

### 2. Create `plugin.json`

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "A sample plugin for Budget",
  "author": "Your Name",
  "minAppVersion": "1.0.0",
  "main": "index.js",
  "renderer": "renderer.js",
  "icon": "Package",
  "category": "utility",
  "permissions": [
    "database:read",
    "database:write"
  ],
  "tables": ["my_plugin_data"],
  "ipcChannels": ["my-plugin:getData"],
  "routes": [
    {
      "path": "/my-plugin",
      "label": "My Plugin",
      "icon": "Package",
      "showInNav": true,
      "order": 100
    }
  ],
  "settings": [
    {
      "key": "apiKey",
      "label": "API Key",
      "type": "string",
      "default": "",
      "description": "Your API key for external service",
      "validation": {
        "required": true
      }
    }
  ]
}
```

### 3. Create `index.ts` (Main Process)

```typescript
import type { Plugin, PluginContext } from '@/main/plugins/plugin-types'

export const plugin: Plugin = {
  async activate(context: PluginContext) {
    context.logger.info('Plugin activated!')

    // Create database table
    if (context.db) {
      context.db.execute(`
        CREATE TABLE IF NOT EXISTS my_plugin_data (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          value TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `)
    }

    // Register IPC handler
    context.ipc.handle('my-plugin:getData', async () => {
      if (!context.db) return []
      return context.db.query('SELECT * FROM my_plugin_data')
    })

    // Listen to app events
    context.events.on('transaction:created', (data) => {
      context.logger.info('New transaction created:', data)
    })

    // Get plugin settings
    const apiKey = context.settings.get<string>('apiKey')
    if (apiKey) {
      context.logger.info('API key configured')
    }
  },

  async deactivate() {
    console.log('Plugin deactivated')
  },

  async onConfigChange(settings) {
    console.log('Settings changed:', settings)
  }
}
```

### 4. Create `renderer.tsx` (UI Components)

```typescript
import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export function MyPluginPage() {
  const [data, setData] = useState([])

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    const result = await window.api.plugins.invoke('my-plugin:getData')
    setData(result)
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">My Plugin</h1>
      <Card className="p-4">
        <p>Plugin data count: {data.length}</p>
        <Button onClick={loadData} className="mt-4">
          Refresh
        </Button>
      </Card>
    </div>
  )
}
```

## Plugin Manifest

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique plugin identifier (kebab-case) |
| `name` | string | Human-readable plugin name |
| `version` | string | Plugin version (semver) |
| `description` | string | Brief description of plugin functionality |
| `author` | string | Plugin author name |
| `minAppVersion` | string | Minimum Budget app version required |
| `main` | string | Entry point file (relative path) |
| `category` | string | Plugin category (see below) |
| `permissions` | string[] | Required permissions array |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `maxAppVersion` | string | Maximum compatible app version |
| `renderer` | string | UI component entry point |
| `icon` | string | Lucide icon name or path |
| `tables` | string[] | Database tables plugin manages |
| `ipcChannels` | string[] | IPC channels plugin registers |
| `routes` | Route[] | Navigation routes to add |
| `settings` | Setting[] | Plugin configuration schema |
| `dependencies` | string[] | Other plugin IDs required |
| `homepage` | string | Plugin homepage/repository URL |
| `license` | string | License identifier (SPDX) |

### Categories

- `finance` - Financial tracking and analysis
- `productivity` - Task management and workflows
- `analytics` - Data visualization and insights
- `integration` - External service integrations
- `utility` - General utilities and tools

## Plugin API

### Context Object

The `PluginContext` object provides access to app functionality:

```typescript
interface PluginContext {
  manifest: PluginManifest      // Plugin manifest
  dataDir: string                // Plugin data directory
  appVersion: string             // Current app version
  logger: PluginLogger           // Logging interface
  db?: PluginDatabaseAPI         // Database access (if permitted)
  ipc: PluginIpcAPI              // IPC registration
  settings: PluginSettingsAPI    // Settings management
  events: PluginEventEmitter     // Event system
}
```

### Logger API

```typescript
context.logger.debug('Debug message', { data })
context.logger.info('Info message')
context.logger.warn('Warning message')
context.logger.error('Error message', error)
```

### Database API

```typescript
// Read operations (requires database:read permission)
const rows = context.db.query<MyType>('SELECT * FROM my_table WHERE id = ?', [id])
const row = context.db.queryOne<MyType>('SELECT * FROM my_table WHERE id = ?', [id])

// Write operations (requires database:write permission)
const result = context.db.execute(
  'INSERT INTO my_table (name, value) VALUES (?, ?)',
  ['test', 'value']
)
console.log(result.lastInsertRowid)

// Transactions
context.db.transaction(() => {
  context.db.execute('INSERT INTO my_table (name) VALUES (?)', ['item1'])
  context.db.execute('INSERT INTO my_table (name) VALUES (?)', ['item2'])
})
```

### IPC API

```typescript
// Register handler (channel must be in manifest.ipcChannels)
context.ipc.handle('my-plugin:action', async (event, arg1, arg2) => {
  return { success: true, data: 'result' }
})

// Remove handler
context.ipc.removeHandler('my-plugin:action')
```

### Settings API

```typescript
// Get setting
const apiKey = context.settings.get<string>('apiKey')

// Set setting
context.settings.set('apiKey', 'new-key-value')

// Get all settings
const allSettings = context.settings.getAll()
```

### Events API

```typescript
// Emit event to other plugins
context.events.emit('my-plugin:data-updated', { id: 123 })

// Listen to events
context.events.on('transaction:created', (data) => {
  console.log('Transaction created:', data)
})

// Remove listener
const handler = (data) => console.log(data)
context.events.on('some-event', handler)
context.events.off('some-event', handler)
```

## Permissions

Plugins must declare required permissions in their manifest:

| Permission | Description |
|------------|-------------|
| `database:read` | Read from SQLite database |
| `database:write` | Write to SQLite database |
| `filesystem:read` | Read files from plugin data directory |
| `filesystem:write` | Write files to plugin data directory |
| `network:fetch` | Make HTTP requests |
| `notifications` | Show system notifications |
| `clipboard` | Access clipboard |
| `shell:execute` | Execute shell commands (restricted) |

### Permission Best Practices

1. **Request minimum permissions** - Only request what you need
2. **Document permission usage** - Explain why each permission is required
3. **Handle permission errors** - Gracefully handle missing permissions
4. **Validate user input** - Always sanitize data before database operations

## Best Practices

### 1. Error Handling

```typescript
export const plugin: Plugin = {
  async activate(context: PluginContext) {
    try {
      // Plugin initialization
      context.logger.info('Initializing plugin...')
      
      // Your code here
      
    } catch (error) {
      context.logger.error('Failed to activate plugin:', error)
      throw error // Re-throw to prevent partial activation
    }
  }
}
```

### 2. Resource Cleanup

```typescript
let intervalId: NodeJS.Timeout | null = null

export const plugin: Plugin = {
  async activate(context: PluginContext) {
    // Start background task
    intervalId = setInterval(() => {
      context.logger.debug('Background task running')
    }, 60000)
  },

  async deactivate() {
    // Clean up resources
    if (intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
  }
}
```

### 3. Type Safety

```typescript
interface MyData {
  id: number
  name: string
  value: string
}

export const plugin: Plugin = {
  async activate(context: PluginContext) {
    context.ipc.handle('my-plugin:getData', async (): Promise<MyData[]> => {
      if (!context.db) return []
      return context.db.query<MyData>('SELECT * FROM my_plugin_data')
    })
  }
}
```

### 4. Settings Validation

```typescript
export const plugin: Plugin = {
  async activate(context: PluginContext) {
    const apiKey = context.settings.get<string>('apiKey')
    
    if (!apiKey) {
      context.logger.warn('API key not configured')
      return
    }
    
    if (apiKey.length < 10) {
      context.logger.error('Invalid API key format')
      throw new Error('Invalid API key')
    }
  }
}
```

## Example Plugin

See the Habits Tracker plugin in `plugins/habits-tracker/` for a complete working example that demonstrates:

- Database table creation and management
- IPC handler registration
- UI component integration
- Settings management
- Event handling
- Proper error handling and cleanup

## Plugin Development Workflow

1. **Create plugin directory** in `%APPDATA%/BudgetApp/plugins/`
2. **Write plugin.json** manifest
3. **Implement plugin logic** in TypeScript
4. **Build plugin** (`tsc` or your build tool)
5. **Load plugin** via Settings > Plugins in the app
6. **Test functionality** and iterate
7. **Hot reload** during development with the reload button

## Debugging

Enable plugin debug logging:

```typescript
export const plugin: Plugin = {
  async activate(context: PluginContext) {
    context.logger.debug('Detailed debug information')
    context.logger.info('Plugin state:', { someState })
  }
}
```

Check logs in:
- Development: Console output
- Production: `%APPDATA%/BudgetApp/logs/`

## Publishing Plugins

1. **Test thoroughly** with different app versions
2. **Document features** in README.md
3. **Add screenshots** of UI components
4. **Specify dependencies** clearly
5. **Version semantically** (semver)
6. **Share on GitHub** or plugin registry

## Support

- **Issues**: Report bugs in the main Budget repository
- **Discussions**: Ask questions in GitHub Discussions
- **Examples**: Browse community plugins for inspiration

---

**Happy plugin development!** 🚀