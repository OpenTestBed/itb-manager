import React, { useEffect, useState } from 'react';
import { Globe, Check, Plus, AlertCircle } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

export function DomainsPage() {
  const { appState, refreshState } = useAppContext();
  const [domains, setDomains] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState('');

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const load = () => {
    setLoading(true);
    fetch('/api/domains').then(r => r.ok ? r.json() : []).then(d => { setDomains(d); setLoading(false); }).catch(() => setLoading(false));
  };

  useEffect(load, []);

  const selectDomain = async (d: any) => {
    setSelecting(d.apiKey);
    const name = d.fullName || d.shortName;
    await fetch(`/api/set-domain?domain_key=${d.apiKey}&domain_name=${encodeURIComponent(name)}`, { method: 'POST' });
    await refreshState();
    setSelecting('');
  };

  const createDomain = async () => {
    if (!createName.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      const r = await fetch('/api/domains', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortName: createName, fullName: createName, description: createDesc }),
      });
      const data = await r.json();
      if (!r.ok) {
        setCreateError(data.error_description || data.error || `Failed (${r.status})`);
      } else {
        setShowCreate(false);
        setCreateName('');
        setCreateDesc('');
        load();
        // Auto-select the new domain
        if (data.apiKey) {
          await fetch(`/api/set-domain?domain_key=${data.apiKey}&domain_name=${encodeURIComponent(createName)}`, { method: 'POST' });
          await refreshState();
        }
      }
    } catch (e: any) {
      setCreateError(e.message);
    }
    setCreating(false);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Domains</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">Select a domain to work with. Specifications and test suites are scoped to the active domain.</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
          <Plus size={14} /> New Domain
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-4 mb-4">
          <h3 className="font-medium text-sm text-gray-900 dark:text-white mb-3">Create Domain</h3>
          <div className="space-y-3">
            <input value={createName} onChange={e => setCreateName(e.target.value)} placeholder="Domain name"
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <input value={createDesc} onChange={e => setCreateDesc(e.target.value)} placeholder="Description (optional)"
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {createError && (
              <div className="flex items-center gap-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-400">
                <AlertCircle size={12} /> {createError}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowCreate(false); setCreateError(''); }}
                className="px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800">
                Cancel
              </button>
              <button onClick={createDomain} disabled={creating || !createName.trim()}
                className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Domain list */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : !domains.length ? (
          <div className="p-8 text-center text-gray-500 dark:text-slate-400">
            No domains found. {!showCreate && <button onClick={() => setShowCreate(true)} className="text-blue-600 hover:underline">Create one</button>}
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-800">
            {domains.map((d: any) => {
              const active = d.apiKey === appState.domainKey;
              return (
                <button
                  key={d.apiKey}
                  onClick={() => selectDomain(d)}
                  disabled={selecting === d.apiKey}
                  className={`w-full flex items-center gap-4 px-4 py-3 text-left transition-colors ${
                    active ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    active ? 'border-blue-600 bg-blue-600' : 'border-gray-300 dark:border-slate-600'
                  }`}>
                    {active && <Check size={12} className="text-white" />}
                  </div>
                  <Globe size={16} className={active ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 dark:text-white text-sm">{d.fullName || d.shortName}</div>
                    <div className="text-xs text-gray-500 dark:text-slate-400 truncate">{d.description || d.shortName}</div>
                  </div>
                  {active && <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-full">Active</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
