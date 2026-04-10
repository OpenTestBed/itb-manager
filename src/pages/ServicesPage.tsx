import React, { useEffect, useState } from 'react';
import { Container, RefreshCw, CheckCircle, XCircle, AlertTriangle, Circle, ChevronDown, ChevronRight, Copy, Check, ExternalLink, Server } from 'lucide-react';

interface Plugin {
  id: string; name: string; category: string; description: string;
  container: string; image: string; port?: number; internalPort?: number;
  healthCheck?: any; endpoints?: any[]; requires?: string[];
  dockerCompose?: string; dockerStatus: string; dockerDetail: string;
  healthStatus: string; healthDetail: string;
}

const categoryLabels: Record<string, string> = {
  core: 'Core ITB', validation: 'Validation', fhir: 'FHIR Services', certificates: 'Digital Certificates',
};
const categoryOrder = ['core', 'validation', 'fhir', 'certificates'];

export function ServicesPage() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState('');

  const load = () => {
    setLoading(true);
    fetch('/api/services').then(r => r.ok ? r.json() : []).then(d => { setPlugins(d); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(load, []);

  const toggle = (id: string) => setExpanded(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const copySnippet = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(''), 2000);
  };

  const StatusIcon = ({ docker, health }: { docker: string; health: string }) => {
    if (docker === 'running' && health === 'healthy') return <CheckCircle size={16} className="text-green-500" />;
    if (docker === 'running' && health === 'unhealthy') return <AlertTriangle size={16} className="text-amber-500" />;
    if (docker === 'running') return <Circle size={16} className="text-blue-400" />;
    return <XCircle size={16} className="text-gray-400" />;
  };

  const statusLabel = (docker: string, health: string) => {
    if (docker === 'running' && health === 'healthy') return 'Running & Healthy';
    if (docker === 'running' && health === 'unhealthy') return 'Running but Unhealthy';
    if (docker === 'running') return 'Running';
    return 'Not Running';
  };

  const grouped = categoryOrder.map(cat => ({
    category: cat,
    label: categoryLabels[cat] || cat,
    plugins: plugins.filter(p => p.category === cat),
  })).filter(g => g.plugins.length > 0);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Services & Plugins</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">Available ITB services. Expand a service to see endpoints, health details, and installation instructions.</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Summary bar */}
      <div className="flex gap-4 mb-6 text-sm">
        <div className="flex items-center gap-1.5">
          <CheckCircle size={14} className="text-green-500" />
          <span className="text-gray-700 dark:text-gray-300">{plugins.filter(p => p.healthStatus === 'healthy').length} healthy</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Circle size={14} className="text-blue-400" />
          <span className="text-gray-700 dark:text-gray-300">{plugins.filter(p => p.dockerStatus === 'running' && p.healthStatus !== 'healthy').length} running</span>
        </div>
        <div className="flex items-center gap-1.5">
          <XCircle size={14} className="text-gray-400" />
          <span className="text-gray-700 dark:text-gray-300">{plugins.filter(p => p.dockerStatus === 'stopped').length} stopped</span>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-gray-500 py-8">Loading plugin catalog...</div>
      ) : (
        grouped.map(group => (
          <div key={group.category} className="mb-6">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
              <Server size={14} /> {group.label}
            </h2>
            <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden divide-y divide-gray-100 dark:divide-slate-800">
              {group.plugins.map(plugin => {
                const isExp = expanded.has(plugin.id);
                const isStopped = plugin.dockerStatus === 'stopped';
                return (
                  <div key={plugin.id}>
                    {/* Plugin row */}
                    <button onClick={() => toggle(plugin.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                      <StatusIcon docker={plugin.dockerStatus} health={plugin.healthStatus} />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-gray-900 dark:text-white">{plugin.name}</div>
                        <div className="text-xs text-gray-500 dark:text-slate-400 truncate">{plugin.description}</div>
                      </div>
                      {plugin.port && (
                        <span className="text-xs text-gray-400 font-mono flex-shrink-0">:{plugin.port}</span>
                      )}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                        isStopped ? 'bg-gray-100 dark:bg-slate-800 text-gray-500' : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                      }`}>{statusLabel(plugin.dockerStatus, plugin.healthStatus)}</span>
                      {isExp ? <ChevronDown size={14} className="text-gray-400 flex-shrink-0" /> : <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />}
                    </button>

                    {/* Expanded detail */}
                    {isExp && (
                      <div className="px-4 py-3 bg-gray-50/50 dark:bg-slate-800/30 border-t border-gray-100 dark:border-slate-800">
                        <div className="grid grid-cols-2 gap-4 text-xs mb-4">
                          <div>
                            <div className="font-medium text-gray-500 dark:text-slate-400 mb-1">Container</div>
                            <code className="text-gray-700 dark:text-gray-300">{plugin.container}</code>
                          </div>
                          <div>
                            <div className="font-medium text-gray-500 dark:text-slate-400 mb-1">Image</div>
                            <code className="text-gray-700 dark:text-gray-300">{plugin.image || 'local build'}</code>
                          </div>
                          <div>
                            <div className="font-medium text-gray-500 dark:text-slate-400 mb-1">Port</div>
                            <code className="text-gray-700 dark:text-gray-300">{plugin.port ? `${plugin.port}${plugin.internalPort ? ` → ${plugin.internalPort}` : ''}` : 'internal only'}</code>
                          </div>
                          <div>
                            <div className="font-medium text-gray-500 dark:text-slate-400 mb-1">Health</div>
                            <span className={plugin.healthStatus === 'healthy' ? 'text-green-600' : plugin.healthStatus === 'stopped' ? 'text-gray-500' : 'text-amber-600'}>
                              {plugin.healthStatus} {plugin.healthDetail && `(${plugin.healthDetail})`}
                            </span>
                          </div>
                        </div>

                        {/* Endpoints */}
                        {plugin.endpoints?.length ? (
                          <div className="mb-4">
                            <div className="font-medium text-xs text-gray-500 dark:text-slate-400 mb-1">Endpoints</div>
                            <div className="space-y-0.5">
                              {plugin.endpoints.map((ep: any, i: number) => (
                                <div key={i} className="flex items-center gap-2 text-xs">
                                  <code className="text-blue-600 dark:text-blue-400 font-mono">{ep.method}</code>
                                  <code className="text-gray-700 dark:text-gray-300">{ep.path}</code>
                                  <span className="text-gray-400">— {ep.description}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {/* Dependencies */}
                        {plugin.requires?.length ? (
                          <div className="mb-4">
                            <div className="font-medium text-xs text-gray-500 dark:text-slate-400 mb-1">Requires</div>
                            <div className="flex gap-1">
                              {plugin.requires.map((r: string) => {
                                const dep = plugins.find(p => p.id === r);
                                return (
                                  <span key={r} className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                    dep?.dockerStatus === 'running' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                  }`}>{r} {dep?.dockerStatus === 'running' ? '✓' : '✗'}</span>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}

                        {/* Docker compose snippet — shown if service is stopped */}
                        {plugin.dockerCompose && (
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <div className="font-medium text-xs text-gray-500 dark:text-slate-400">
                                {isStopped ? 'To install — add to docker-compose.yml:' : 'Docker Compose config:'}
                              </div>
                              <button onClick={() => copySnippet(plugin.id, plugin.dockerCompose!)}
                                className="flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-800 dark:text-blue-400">
                                {copied === plugin.id ? <><Check size={10} /> Copied</> : <><Copy size={10} /> Copy</>}
                              </button>
                            </div>
                            <pre className="text-[11px] bg-gray-900 dark:bg-slate-950 text-green-400 p-3 rounded-lg overflow-x-auto font-mono leading-relaxed">{plugin.dockerCompose.trim()}</pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
