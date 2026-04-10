import React, { useEffect, useState } from 'react';
import { ChevronRight, ChevronDown, Globe, FileCheck, Users, TestTube2, Building2, RefreshCw, Check, Plus, Play, Loader2 } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

interface Actor { apiKey: string; identifier: string; name: string; }
interface TestSuite { id: number; identifier: string; name: string; }
interface Spec { apiKey: string; shortName: string; fullName: string; description?: string; actors: Actor[]; testSuites: TestSuite[]; }
interface Domain { apiKey: string; shortName: string; fullName: string; description?: string; specifications: Spec[]; }
interface Org { apiKey?: string; shortName: string; fullName: string; }
interface ITBTree { domains: Domain[]; organisations: Org[]; }

interface Props {
  selectedSpecKey: string;
  onSelectSpec: (specKey: string, specName: string) => void;
}

export function ITBExplorer({ selectedSpecKey, onSelectSpec }: Props) {
  const { appState, itbConfig, setPage } = useAppContext();
  const [tree, setTree] = useState<ITBTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Inline create forms
  const [addingTo, setAddingTo] = useState<{ type: 'domain' | 'spec' | 'org'; parentKey: string } | null>(null);
  const [addName, setAddName] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/itb-tree');
      if (r.ok) setTree(await r.json());
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!tree) return;
    const next = new Set(expanded);
    for (const domain of tree.domains) {
      if (domain.apiKey === appState.domainKey || tree.domains.length === 1) {
        next.add(`domain-${domain.apiKey}`);
        if (domain.specifications.length <= 3) {
          domain.specifications.forEach(s => next.add(`spec-${s.apiKey}`));
        }
      }
    }
    setExpanded(next);
  }, [tree, appState.domainKey]);

  const toggle = (key: string) => setExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const isExp = (key: string) => expanded.has(key);

  const startAdd = (type: 'domain' | 'spec' | 'org', parentKey: string) => {
    setAddingTo({ type, parentKey });
    setAddName('');
    setAddError('');
  };

  const cancelAdd = () => { setAddingTo(null); setAddName(''); setAddError(''); };

  const submitAdd = async () => {
    if (!addingTo || !addName.trim()) return;
    setAddBusy(true);
    setAddError('');
    try {
      const baseUrl = itbConfig.baseUrl.replace(/\/+$/, '');
      const apiKey = itbConfig.communityApiKey || itbConfig.apiKey || '';

      if (addingTo.type === 'domain') {
        // Create domain via ITB API
        const r = await fetch('/api/domains', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shortName: addName, fullName: addName, description: '' }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error_description || data.error || 'Failed');
      } else if (addingTo.type === 'spec') {
        // Create specification under domain
        const proxyPath = `/itb-proxy/${encodeURIComponent(baseUrl)}/api/rest/specification`;
        const r = await fetch(proxyPath, {
          method: 'PUT',
          headers: { 'ITB_API_KEY': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shortName: addName, fullName: addName, description: '',
            domain: addingTo.parentKey, hidden: false, displayOrder: 0,
          }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error_description || data.error || 'Failed');
        // Auto-expand domain
        setExpanded(prev => new Set([...prev, `domain-${addingTo.parentKey}`]));
      } else if (addingTo.type === 'org') {
        // Create organisation
        const proxyPath = `/itb-proxy/${encodeURIComponent(baseUrl)}/api/rest/organisation`;
        const r = await fetch(proxyPath, {
          method: 'PUT',
          headers: { 'ITB_API_KEY': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ shortName: addName, fullName: addName }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error_description || data.error || 'Failed');
      }
      cancelAdd();
      await load();
    } catch (e: any) {
      setAddError(e.message);
    }
    setAddBusy(false);
  };

  const InlineAddForm = () => (
    <div className="px-2 py-1 ml-4">
      <div className="flex items-center gap-1">
        <input value={addName} onChange={e => setAddName(e.target.value)} placeholder="Name..."
          className="flex-1 px-1.5 py-0.5 text-xs border border-blue-300 dark:border-blue-700 rounded bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          autoFocus onKeyDown={e => { if (e.key === 'Enter') submitAdd(); if (e.key === 'Escape') cancelAdd(); }} />
        <button onClick={submitAdd} disabled={addBusy || !addName.trim()} className="p-0.5 text-blue-500 hover:text-blue-700 disabled:opacity-50">
          {addBusy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
        </button>
        <button onClick={cancelAdd} className="p-0.5 text-gray-400 hover:text-gray-600 text-xs">&times;</button>
      </div>
      {addError && <div className="text-[10px] text-red-500 mt-0.5 truncate" title={addError}>{addError}</div>}
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900 border-l border-gray-200 dark:border-slate-700">
      <div className="px-3 py-2 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between flex-shrink-0">
        <span className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">ITB Explorer</span>
        <div className="flex items-center gap-1">
          <button onClick={() => startAdd('domain', '')} className="p-1 text-gray-400 hover:text-emerald-500 rounded transition-colors" title="Add Domain">
            <Plus size={12} />
          </button>
          <button onClick={load} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors" title="Refresh">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto text-sm py-1">
        {loading && !tree ? (
          <div className="p-4 text-xs text-gray-400 text-center">Loading...</div>
        ) : !tree?.domains?.length ? (
          <div className="p-4 text-xs text-gray-400 text-center">
            No ITB data.
            <button onClick={() => startAdd('domain', '')} className="block mx-auto mt-2 text-blue-500 hover:underline text-[11px]">+ Add domain</button>
          </div>
        ) : (
          <>
            {/* Add domain form */}
            {addingTo?.type === 'domain' && <InlineAddForm />}

            {tree.domains.map(domain => {
              const domKey = `domain-${domain.apiKey}`;
              const isDomExp = isExp(domKey);
              return (
                <div key={domain.apiKey}>
                  {/* Domain row */}
                  <div className="group flex items-center gap-1 px-2 py-1 hover:bg-gray-50 dark:hover:bg-slate-800">
                    <button onClick={() => toggle(domKey)} className="flex-shrink-0">
                      {isDomExp ? <ChevronDown size={12} className="text-gray-400" /> : <ChevronRight size={12} className="text-gray-400" />}
                    </button>
                    <Globe size={12} className="text-blue-500 flex-shrink-0" />
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate flex-1">{domain.fullName || domain.shortName}</span>
                    {/* Add spec button */}
                    <button onClick={() => startAdd('spec', domain.apiKey)}
                      className="p-0.5 text-gray-300 hover:text-emerald-500 transition-colors opacity-0 group-hover:opacity-100" title="Add specification">
                      <Plus size={11} />
                    </button>
                  </div>

                  {isDomExp && (
                    <div className="ml-3">
                      {/* Inline add spec form */}
                      {addingTo?.type === 'spec' && addingTo.parentKey === domain.apiKey && <InlineAddForm />}

                      {domain.specifications.map(spec => {
                        const specKey = `spec-${spec.apiKey}`;
                        const isSelected = spec.apiKey === selectedSpecKey;
                        const specExp = isExp(specKey);
                        return (
                          <div key={spec.apiKey}>
                            {/* Spec row */}
                            <div className="group flex items-center gap-1">
                              <button
                                onClick={() => {
                                  onSelectSpec(spec.apiKey, spec.fullName || spec.shortName);
                                  if (!specExp) toggle(specKey);
                                }}
                                className={`flex-1 flex items-center gap-1.5 px-2 py-1.5 my-0.5 rounded-md text-left transition-colors border ${
                                  isSelected
                                    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-400'
                                    : 'border-transparent hover:bg-gray-100 dark:hover:bg-slate-800 hover:border-gray-200 dark:hover:border-slate-700'
                                }`}
                              >
                                {specExp ? <ChevronDown size={11} className="text-gray-400 flex-shrink-0" /> : <ChevronRight size={11} className="text-gray-400 flex-shrink-0" />}
                                <FileCheck size={13} className={isSelected ? 'text-blue-600' : 'text-emerald-500'} />
                                <span className="text-xs font-medium truncate flex-1">{spec.fullName || spec.shortName}</span>
                                {isSelected && <Check size={12} className="text-blue-600 flex-shrink-0" />}
                              </button>
                              {/* Deploy tests to this spec */}
                              <button onClick={() => { onSelectSpec(spec.apiKey, spec.fullName || spec.shortName); setPage('import-ig'); }}
                                className="p-0.5 text-gray-300 hover:text-blue-500 transition-colors opacity-0 group-hover:opacity-100 mr-1" title="Import IG to this spec">
                                <Plus size={11} />
                              </button>
                            </div>

                            {specExp && (
                              <div className="ml-5 border-l border-gray-200 dark:border-slate-700 pl-2">
                                {/* Actors */}
                                {spec.actors.length > 0 && (
                                  <div className="mb-1">
                                    <div className="text-[10px] font-medium text-gray-400 dark:text-slate-500 uppercase tracking-wider py-0.5">Actors</div>
                                    {spec.actors.map(a => (
                                      <div key={a.apiKey} className="flex items-center gap-1 py-0.5 px-1">
                                        <Users size={10} className="text-gray-400 flex-shrink-0" />
                                        <span className="text-xs text-gray-600 dark:text-slate-400 truncate">{a.name}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {/* Test Suites */}
                                {spec.testSuites.length > 0 && (
                                  <div>
                                    <div className="text-[10px] font-medium text-gray-400 dark:text-slate-500 uppercase tracking-wider py-0.5">Test Suites</div>
                                    {spec.testSuites.map(ts => (
                                      <div key={ts.id} className="flex items-center gap-1 py-0.5 px-1">
                                        <TestTube2 size={10} className="text-purple-400 flex-shrink-0" />
                                        <span className="text-xs text-gray-600 dark:text-slate-400 truncate">{ts.name}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {spec.actors.length === 0 && spec.testSuites.length === 0 && (
                                  <div className="text-[10px] text-gray-400 py-1 italic">Empty — <button onClick={() => { onSelectSpec(spec.apiKey, spec.fullName || spec.shortName); setPage('import-ig'); }} className="text-blue-500 hover:underline">import tests</button></div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {domain.specifications.length === 0 && !addingTo && (
                        <div className="text-[10px] text-gray-400 px-4 py-1 italic">
                          No specifications — <button onClick={() => startAdd('spec', domain.apiKey)} className="text-blue-500 hover:underline">add one</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Organisations */}
            <div className="mt-2 border-t border-gray-100 dark:border-slate-800 pt-1">
              <div className="group flex items-center gap-1 px-2 py-1 hover:bg-gray-50 dark:hover:bg-slate-800">
                <button onClick={() => toggle('orgs')} className="flex-shrink-0">
                  {isExp('orgs') ? <ChevronDown size={12} className="text-gray-400" /> : <ChevronRight size={12} className="text-gray-400" />}
                </button>
                <Building2 size={12} className="text-amber-500" />
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300 flex-1">Organisations ({tree.organisations.length})</span>
                <button onClick={() => startAdd('org', '')}
                  className="p-0.5 text-gray-300 hover:text-emerald-500 transition-colors opacity-0 group-hover:opacity-100" title="Add organisation">
                  <Plus size={11} />
                </button>
              </div>
              {isExp('orgs') && (
                <div className="ml-5">
                  {addingTo?.type === 'org' && <InlineAddForm />}
                  {tree.organisations.map(o => (
                    <div key={o.shortName} className="flex items-center gap-1 py-0.5 px-1">
                      <Building2 size={10} className="text-gray-400" />
                      <span className="text-xs text-gray-600 dark:text-slate-400">{o.fullName || o.shortName}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
