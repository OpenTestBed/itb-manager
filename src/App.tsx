import React, { useState, useEffect } from 'react';
import { Server, Sun, Moon, Settings, LayoutDashboard, Globe, FileCheck, PackagePlus, Building2, Container, Users, TestTube2, Laptop, ChevronDown, ChevronRight, CheckCircle, XCircle, Plus, RefreshCw, Check, Loader2 } from 'lucide-react';
import { AppContextProvider, useAppContext } from './context/AppContext';
import { ITBSettingsDialog } from './components/ITBSettingsDialog';
import { DashboardPage } from './pages/DashboardPage';
import { DomainsPage } from './pages/DomainsPage';
import { SpecificationsPage } from './pages/SpecificationsPage';
import { ImportIGPage } from './pages/ImportIGPage';
import { OrganizationsPage } from './pages/OrganizationsPage';
import { ServicesPage } from './pages/ServicesPage';

interface TreeSpec { apiKey: string; shortName: string; fullName: string; actors: any[]; testSuites: any[]; }
interface TreeDomain { apiKey: string; shortName: string; fullName: string; specifications: TreeSpec[]; }
interface TreeData { domains: TreeDomain[]; organisations: any[]; }

function AppShell() {
  const { isDark, setIsDark, path, navigate, appState, itbConfig, itbSettingsOpen, setITBSettingsOpen, saveConfig,
          selectedSpecKey, selectSpec } = useAppContext();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [tree, setTree] = useState<TreeData | null>(null);
  const [treeLoading, setTreeLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Inline add
  const [adding, setAdding] = useState<{ type: string; parentKey: string } | null>(null);
  const [addName, setAddName] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState('');

  const loadTree = async () => {
    setTreeLoading(true);
    try { const r = await fetch('/api/itb-tree'); if (r.ok) setTree(await r.json()); } catch {}
    setTreeLoading(false);
  };

  useEffect(() => { loadTree(); }, []);

  // Auto-expand based on path
  useEffect(() => {
    if (!tree) return;
    const next = new Set(expanded);
    next.add('testing');
    for (const d of tree.domains) {
      // Expand if path is inside this domain, or if it's the only domain
      if (path.includes(d.apiKey) || d.apiKey === appState.domainKey || tree.domains.length === 1) {
        next.add(`dom-${d.apiKey}`);
      }
      for (const s of d.specifications) {
        if (path.includes(s.apiKey)) next.add(`spec-${s.apiKey}`);
      }
    }
    setExpanded(next);
  }, [tree, path, appState.domainKey]);

  const toggle = (k: string) => setExpanded(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const isExp = (k: string) => expanded.has(k);

  // Is this path segment active?
  const isActive = (p: string) => path === p || path.startsWith(p + '/');

  const startAdd = (type: string, parentKey: string) => { setAdding({ type, parentKey }); setAddName(''); setAddError(''); };
  const cancelAdd = () => { setAdding(null); setAddName(''); setAddError(''); };
  const submitAdd = async () => {
    if (!adding || !addName.trim()) return;
    setAddBusy(true); setAddError('');
    try {
      const base = itbConfig.baseUrl.replace(/\/+$/, '');
      const key = itbConfig.communityApiKey || itbConfig.apiKey || '';
      if (adding.type === 'domain') {
        const r = await fetch('/api/domains', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shortName: addName, fullName: addName, description: '' }) });
        if (!r.ok) { const d = await r.json(); throw new Error(d.error_description || d.error || 'Failed'); }
      } else if (adding.type === 'spec') {
        const r = await fetch(`/itb-proxy/${encodeURIComponent(base)}/api/rest/specification`, { method: 'PUT', headers: { 'ITB_API_KEY': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ shortName: addName, fullName: addName, description: '', domain: adding.parentKey, hidden: false, displayOrder: 0 }) });
        if (!r.ok) { const d = await r.json(); throw new Error(d.error_description || d.error || 'Failed'); }
        setExpanded(p => new Set([...p, `dom-${adding.parentKey}`]));
      } else if (adding.type === 'org') {
        const r = await fetch(`/itb-proxy/${encodeURIComponent(base)}/api/rest/organisation`, { method: 'PUT', headers: { 'ITB_API_KEY': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ shortName: addName, fullName: addName }) });
        if (!r.ok) { const d = await r.json(); throw new Error(d.error_description || d.error || 'Failed'); }
      }
      cancelAdd();
      await loadTree();
    } catch (e: any) { setAddError(e.message); }
    setAddBusy(false);
  };

  const InlineAdd = () => (
    <div className="px-2 py-1 ml-6">
      <div className="flex items-center gap-1">
        <input value={addName} onChange={e => setAddName(e.target.value)} placeholder="Name..."
          className="flex-1 px-1.5 py-0.5 text-[11px] border border-blue-400/50 rounded bg-slate-800 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          autoFocus onKeyDown={e => { if (e.key === 'Enter') submitAdd(); if (e.key === 'Escape') cancelAdd(); }} />
        <button onClick={submitAdd} disabled={addBusy || !addName.trim()} className="p-0.5 text-blue-400 hover:text-blue-300 disabled:opacity-50">
          {addBusy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
        </button>
        <button onClick={cancelAdd} className="p-0.5 text-slate-500 hover:text-slate-300 text-[11px]">&times;</button>
      </div>
      {addError && <div className="text-[9px] text-red-400 mt-0.5 truncate">{addError}</div>}
    </div>
  );

  // Determine which page to render from path
  const renderPage = () => {
    if (path === 'dashboard') return <DashboardPage />;
    if (path === 'domains') return <DomainsPage />;
    if (path.startsWith('domain/')) return <SpecificationsPage />;
    if (path.startsWith('spec/')) return <SpecificationsPage />;
    if (path === 'specifications') return <SpecificationsPage />;
    if (path === 'import-ig') return <ImportIGPage />;
    if (path === 'organizations') return <OrganizationsPage />;
    if (path === 'services') return <ServicesPage />;
    return <DashboardPage />;
  };

  return (
    <div className="h-screen flex">
      {/* Left sidebar */}
      <aside className={`${sidebarOpen ? 'w-60' : 'w-10'} flex-shrink-0 bg-slate-900 text-white flex flex-col transition-all duration-200`}>
        <div className="px-2 py-3 border-b border-slate-700 flex items-center justify-between">
          {sidebarOpen ? (
            <>
              <div className="flex items-center gap-2 pl-1">
                <Server size={16} className="text-blue-400" />
                <span className="font-bold text-[13px]">ITB Test Manager</span>
              </div>
              <div className="flex items-center gap-0.5">
                <button onClick={loadTree} className="p-1 text-slate-500 hover:text-white rounded" title="Refresh"><RefreshCw size={12} className={treeLoading ? 'animate-spin' : ''} /></button>
                <button onClick={() => setSidebarOpen(false)} className="p-1 text-slate-500 hover:text-white rounded" title="Collapse"><ChevronRight size={12} className="rotate-180" /></button>
              </div>
            </>
          ) : (
            <button onClick={() => setSidebarOpen(true)} className="mx-auto p-1 text-slate-400 hover:text-white rounded"><Server size={16} className="text-blue-400" /></button>
          )}
        </div>

        {/* Collapsed icons */}
        {!sidebarOpen && (
          <div className="flex-1 flex flex-col items-center py-2 gap-1 overflow-y-auto">
            <button onClick={() => navigate('dashboard')} className={`p-1.5 rounded ${isActive('dashboard') ? 'bg-blue-600' : 'text-slate-400 hover:bg-slate-800'}`} title="Dashboard"><LayoutDashboard size={14} /></button>
            <div className="w-5 border-t border-slate-800 my-1" />
            <button onClick={() => navigate('specifications')} className={`p-1.5 rounded ${isActive('spec') || isActive('domain') || isActive('specifications') ? 'bg-blue-600' : 'text-slate-400 hover:bg-slate-800'}`} title="Specifications"><FileCheck size={14} /></button>
            <button onClick={() => navigate('import-ig')} className={`p-1.5 rounded ${isActive('import-ig') ? 'bg-blue-600' : 'text-slate-400 hover:bg-slate-800'}`} title="Import IG"><PackagePlus size={14} /></button>
            <div className="w-5 border-t border-slate-800 my-1" />
            <button onClick={() => navigate('organizations')} className={`p-1.5 rounded ${isActive('organizations') ? 'bg-blue-600' : 'text-slate-400 hover:bg-slate-800'}`} title="Organizations"><Building2 size={14} /></button>
            <button onClick={() => navigate('services')} className={`p-1.5 rounded ${isActive('services') ? 'bg-blue-600' : 'text-slate-400 hover:bg-slate-800'}`} title="Services"><Container size={14} /></button>
            <div className="flex-1" />
            <button onClick={() => setITBSettingsOpen(true)} className="p-1.5 text-slate-500 hover:text-white rounded"><Settings size={13} /></button>
            <button onClick={() => setIsDark(!isDark)} className="p-1.5 text-slate-500 hover:text-white rounded">{isDark ? <Sun size={13} /> : <Moon size={13} />}</button>
          </div>
        )}

        {/* Expanded tree */}
        {sidebarOpen && <>
          <div className="flex-1 overflow-y-auto py-1">
            {/* Dashboard */}
            <button onClick={() => navigate('dashboard')}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] transition-colors ${isActive('dashboard') ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}>
              <LayoutDashboard size={13} /> Dashboard
            </button>

            <div className="my-1.5 mx-3 border-t border-slate-800" />

            {/* Testing tree */}
            <button onClick={() => toggle('testing')} className="w-full flex items-center gap-1.5 px-3 py-1 text-[10px] text-slate-500 hover:text-slate-300 uppercase tracking-wider font-semibold">
              {isExp('testing') ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              Testing
              <div className="flex-1" />
              <span onClick={e => { e.stopPropagation(); startAdd('domain', ''); }} className="p-0.5 hover:text-emerald-400"><Plus size={10} /></span>
            </button>

            {isExp('testing') && (
              <div className="ml-1">
                {adding?.type === 'domain' && <InlineAdd />}

                {tree?.domains?.map(domain => {
                  const dk = `dom-${domain.apiKey}`;
                  const domPath = `domain/${domain.apiKey}`;
                  return (
                    <div key={domain.apiKey}>
                      <div className="group flex items-center gap-1 px-2 py-1 hover:bg-slate-800/50 rounded-sm mx-1">
                        <button onClick={() => toggle(dk)} className="flex-shrink-0">
                          {isExp(dk) ? <ChevronDown size={11} className="text-slate-500" /> : <ChevronRight size={11} className="text-slate-500" />}
                        </button>
                        <Globe size={11} className="text-blue-400 flex-shrink-0" />
                        <button onClick={() => navigate(domPath)}
                          className={`flex-1 text-left text-[12px] truncate ${isActive(domPath) ? 'text-white font-medium' : 'text-slate-300 hover:text-white'}`}>
                          {domain.fullName || domain.shortName}
                        </button>
                        <span onClick={e => { e.stopPropagation(); startAdd('spec', domain.apiKey); }}
                          className="p-0.5 text-slate-600 hover:text-emerald-400 opacity-0 group-hover:opacity-100 cursor-pointer"><Plus size={10} /></span>
                      </div>

                      {isExp(dk) && (
                        <div className="ml-4">
                          {adding?.type === 'spec' && adding.parentKey === domain.apiKey && <InlineAdd />}

                          {domain.specifications.map(spec => {
                            const sk = `spec-${spec.apiKey}`;
                            const specPath = `spec/${spec.apiKey}`;
                            const isSel = spec.apiKey === selectedSpecKey;
                            const isViewing = isActive(specPath);
                            return (
                              <div key={spec.apiKey}>
                                <div className="group flex items-center gap-1 mx-1">
                                  <button onClick={() => toggle(sk)} className="flex-shrink-0 p-0.5">
                                    {isExp(sk) ? <ChevronDown size={10} className="text-slate-500" /> : <ChevronRight size={10} className="text-slate-500" />}
                                  </button>
                                  <button onClick={() => { selectSpec(spec.apiKey, spec.fullName || spec.shortName); navigate(specPath); }}
                                    className={`flex-1 flex items-center gap-1 px-1.5 py-1 rounded text-left text-[12px] transition-colors ${
                                      isViewing ? 'bg-blue-600/40 text-white' : isSel ? 'bg-blue-600/20 text-blue-300' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                                    }`}>
                                    <FileCheck size={11} className={isSel || isViewing ? 'text-blue-400' : 'text-emerald-500'} />
                                    <span className="truncate flex-1">{spec.fullName || spec.shortName}</span>
                                    {isSel && <Check size={10} className="text-blue-400 flex-shrink-0" />}
                                  </button>
                                  <span onClick={() => { selectSpec(spec.apiKey, spec.fullName || spec.shortName); navigate('import-ig'); }}
                                    className="p-0.5 text-slate-600 hover:text-blue-400 opacity-0 group-hover:opacity-100 cursor-pointer" title="Import IG"><PackagePlus size={10} /></span>
                                </div>

                                {isExp(sk) && (
                                  <div className="ml-5 border-l border-slate-800 pl-2 mb-1">
                                    {spec.actors.map(a => (
                                      <div key={a.apiKey} className="flex items-center gap-1 py-0.5 px-1">
                                        <Users size={9} className="text-slate-600" />
                                        <span className="text-[11px] text-slate-500 truncate">{a.name}</span>
                                      </div>
                                    ))}
                                    {spec.testSuites.map(ts => (
                                      <div key={ts.id} className="flex items-center gap-1 py-0.5 px-1">
                                        <TestTube2 size={9} className="text-purple-500" />
                                        <span className="text-[11px] text-slate-500 truncate">{ts.name}</span>
                                      </div>
                                    ))}
                                    {spec.actors.length === 0 && spec.testSuites.length === 0 && (
                                      <div className="text-[10px] text-slate-600 px-1 py-0.5 italic">Empty</div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {domain.specifications.length === 0 && !adding && (
                            <div className="text-[10px] text-slate-600 px-3 py-1">
                              <button onClick={() => startAdd('spec', domain.apiKey)} className="text-blue-400 hover:underline">+ Add specification</button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                <button onClick={() => navigate('import-ig')}
                  className={`w-full flex items-center gap-2 pl-5 pr-3 py-1.5 text-[12px] transition-colors ${isActive('import-ig') ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}>
                  <PackagePlus size={13} /> Import IG
                </button>
              </div>
            )}

            <div className="my-1.5 mx-3 border-t border-slate-800" />

            {/* Conformance */}
            <button onClick={() => toggle('conformance')} className="w-full flex items-center gap-1.5 px-3 py-1 text-[10px] text-slate-500 hover:text-slate-300 uppercase tracking-wider font-semibold">
              {isExp('conformance') ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              Conformance
              <div className="flex-1" />
              <span onClick={e => { e.stopPropagation(); startAdd('org', ''); }} className="p-0.5 hover:text-emerald-400"><Plus size={10} /></span>
            </button>
            {isExp('conformance') && (
              <div className="ml-1">
                {adding?.type === 'org' && <InlineAdd />}
                {tree?.organisations?.map(o => (
                  <div key={o.shortName} className="flex items-center gap-1.5 px-3 py-0.5 ml-2">
                    <Building2 size={10} className="text-amber-500" />
                    <span className="text-[11px] text-slate-400 truncate">{o.fullName || o.shortName}</span>
                  </div>
                ))}
                <button onClick={() => navigate('organizations')}
                  className={`w-full flex items-center gap-2 pl-5 pr-3 py-1.5 text-[12px] ${isActive('organizations') ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}>
                  <Building2 size={13} /> Manage
                </button>
              </div>
            )}

            <div className="my-1.5 mx-3 border-t border-slate-800" />
            <button onClick={() => navigate('services')}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] ${isActive('services') ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}>
              <Container size={13} /> Services
            </button>
          </div>

          {/* Connection + buttons */}
          <div className="border-t border-slate-700 px-3 py-2">
            <button onClick={() => setITBSettingsOpen(true)} className="w-full flex items-center gap-2 text-[11px] text-slate-500 hover:text-white transition-colors">
              {appState.connected ? <CheckCircle size={11} className="text-green-400" /> : <XCircle size={11} className="text-red-400" />}
              {appState.connected ? 'Connected' : 'Disconnected'}
            </button>
          </div>
          <div className="border-t border-slate-700 p-1.5 flex justify-around">
            <button onClick={() => setITBSettingsOpen(true)} className="p-1 text-slate-500 hover:text-white rounded"><Settings size={13} /></button>
            <button onClick={() => setIsDark(!isDark)} className="p-1 text-slate-500 hover:text-white rounded">{isDark ? <Sun size={13} /> : <Moon size={13} />}</button>
          </div>
        </>}
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-gray-50 dark:bg-slate-950">
        {renderPage()}
      </main>

      {itbSettingsOpen && <ITBSettingsDialog config={itbConfig} onSave={saveConfig} onClose={() => setITBSettingsOpen(false)} />}
    </div>
  );
}

export default function App() {
  return <AppContextProvider><AppShell /></AppContextProvider>;
}
