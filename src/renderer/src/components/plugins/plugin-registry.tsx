import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { 
  Package, 
  Download, 
  Trash2, 
  RefreshCw, 
  CheckCircle, 
  XCircle,
  AlertCircle,
  ExternalLink
} from 'lucide-react'

interface PluginMetadata {
  manifest: {
    id: string
    name: string
    version: string
    description: string
    author: string
    category: string
    icon?: string
    homepage?: string
    permissions: string[]
  }
  path: string
  enabled: boolean
  loaded: boolean
  error?: string
}

export function PluginRegistry() {
  const [plugins, setPlugins] = useState<PluginMetadata[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadPlugins()
  }, [])

  async function loadPlugins() {
    setLoading(true)
    try {
      const discovered = await window.api.plugins.discover()
      setPlugins(discovered as PluginMetadata[])
    } catch (error) {
      console.error('Failed to load plugins:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleLoad(pluginId: string) {
    try {
      const result = await window.api.plugins.load(pluginId)
      if (result.success) {
        await loadPlugins()
      } else {
        alert(`Failed to load plugin: ${result.error}`)
      }
    } catch (error) {
      console.error('Failed to load plugin:', error)
    }
  }

  async function handleUnload(pluginId: string) {
    try {
      await window.api.plugins.unload(pluginId)
      await loadPlugins()
    } catch (error) {
      console.error('Failed to unload plugin:', error)
    }
  }

  async function handleReload(pluginId: string) {
    try {
      const result = await window.api.plugins.reload(pluginId)
      if (result.success) {
        await loadPlugins()
      } else {
        alert(`Failed to reload plugin: ${result.error}`)
      }
    } catch (error) {
      console.error('Failed to reload plugin:', error)
    }
  }

  function getCategoryColor(category: string): string {
    const colors: Record<string, string> = {
      finance: 'bg-success/10 text-success',
      productivity: 'bg-info/10 text-info',
      analytics: 'bg-purple-500/10 text-purple-500',
      integration: 'bg-warning/10 text-warning',
      utility: 'bg-muted text-muted-foreground'
    }
    return colors[category] || colors.utility
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading plugins...</span>
      </div>
    )
  }

  if (plugins.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Package className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">No Plugins Found</h3>
        <p className="text-sm text-muted-foreground mb-4 max-w-md">
          Plugins extend Budget's functionality. Place plugin folders in{' '}
          <code className="bg-muted px-1 py-0.5 rounded">%APPDATA%\BudgetApp\plugins\</code>
        </p>
        <Button variant="outline" onClick={loadPlugins}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Plugin Registry</h2>
          <p className="text-sm text-muted-foreground">
            {plugins.length} plugin{plugins.length !== 1 ? 's' : ''} discovered
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadPlugins}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <ScrollArea className="h-[600px]">
        <div className="grid gap-4">
          {plugins.map((plugin) => (
            <Card key={plugin.manifest.id} className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <Package className="h-5 w-5 text-primary" />
                    <h3 className="text-lg font-semibold">{plugin.manifest.name}</h3>
                    <Badge variant="outline" className="text-xs">
                      v{plugin.manifest.version}
                    </Badge>
                    <Badge className={getCategoryColor(plugin.manifest.category)}>
                      {plugin.manifest.category}
                    </Badge>
                    {plugin.loaded && (
                      <Badge className="bg-success/10 text-success">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Loaded
                      </Badge>
                    )}
                    {plugin.error && (
                      <Badge variant="destructive">
                        <XCircle className="h-3 w-3 mr-1" />
                        Error
                      </Badge>
                    )}
                  </div>

                  <p className="text-sm text-muted-foreground mb-3">
                    {plugin.manifest.description}
                  </p>

                  <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
                    <span>by {plugin.manifest.author}</span>
                    <span>•</span>
                    <span>{plugin.manifest.permissions.length} permissions</span>
                    {plugin.manifest.homepage && (
                      <>
                        <span>•</span>
                        <a
                          href="#"
                          onClick={(e) => {
                            e.preventDefault()
                            window.api.openExternal(plugin.manifest.homepage!)
                          }}
                          className="flex items-center gap-1 hover:text-primary"
                        >
                          Homepage
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </>
                    )}
                  </div>

                  {plugin.manifest.permissions.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {plugin.manifest.permissions.map((perm) => (
                        <Badge key={perm} variant="secondary" className="text-xs">
                          {perm}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {plugin.error && (
                    <div className="flex items-start gap-2 p-2 bg-destructive/10 rounded text-sm text-destructive">
                      <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <span>{plugin.error}</span>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 ml-4">
                  {!plugin.loaded ? (
                    <Button
                      size="sm"
                      onClick={() => handleLoad(plugin.manifest.id)}
                      disabled={!!plugin.error}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Load
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleReload(plugin.manifest.id)}
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Reload
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleUnload(plugin.manifest.id)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Unload
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </ScrollArea>

      <div className="mt-6 p-4 bg-muted rounded-lg">
        <h4 className="font-semibold mb-2 flex items-center gap-2">
          <Package className="h-4 w-4" />
          Plugin Development
        </h4>
        <p className="text-sm text-muted-foreground mb-2">
          Want to create your own plugin? Check out the{' '}
          <a href="#" className="text-primary hover:underline">
            Plugin Development Guide
          </a>
        </p>
        <p className="text-sm text-muted-foreground">
          Plugin directory: <code className="bg-background px-1 py-0.5 rounded">
            %APPDATA%\BudgetApp\plugins\
          </code>
        </p>
      </div>
    </div>
  )
}

// Made with Bob
