import React, { useState, useEffect } from 'react';
import { Server, Sun, Moon, Settings, LayoutDashboard, Globe, FileCheck, PackagePlus, Building2, Container, Users, TestTube2, Laptop, ChevronDown, ChevronRight, CheckCircle, XCircle, Plus, RefreshCw, Check, Loader2, Link2 } from 'lucide-react';
import { AppContextProvider, useAppContext } from './context/AppContext';
import { ITBSettingsDialog } from './components/ITBSettingsDialog';
import { DashboardPage } from './pages/DashboardPage';
import { ConformanceMatrixPage } from './pages/ConformanceMatrixPage';
import { DomainsPage } from './pages/DomainsPage';
import { SpecificationsPage } from './pages/SpecificationsPage';
import { ImportIGPage } from './pages/ImportIGPage';
import { OrganizationsPage } from './pages/OrganizationsPage';
import { ServicesPage } from './pages/ServicesPage';
import { SystemDetailPage } from './pages/SystemDetailPage';
import { RegisterVendorPage } from './pages/RegisterVendorPage';
import { MatchesPage } from './pages/MatchesPage';

interface TreeSpec { apiKey: string; shortName: string; fullName: string; actors: any[]; testSuites: any[]; }
interface TreeDomain { apiKey: string; shortName: string; fullName: string; specifications: TreeSpec[]; }
interface TreeSystem { id: number; shortName: string; fullName: string; apiKey: string; }
interface TreeOrg { apiKey: string; shortName: string; fullName: string; systems: TreeSystem[]; }
interface TreeCommunity { id: number; apiKey: string; shortName: string; fullName: string; }
interface TreeData { communities: TreeCommunity[]; domains: TreeDomain[]; organisations: TreeOrg[]; selectedCommunity: { apiKey: string; shortName: string; fullName: string } | null; selectedOrganisation: { apiKey: string; shortName: string; fullName: string } | null; }

function AppShell() {
  const { isDark, setIsDark, path, navigate, appState, refreshState, itbConfig, itbSettingsOpen, setITBSettingsOpen, saveConfig,
          selectedSpecKey, selectSpec, persona, setPersona } = useAppContext();

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

  // Auto-expand based on path and state
  useEffect(() => {
    if (!tree) return;
    const next = new Set(expanded);
    next.add('domains');
    // Show community list if multiple communities or none selected
    if (tree.communities.length > 1 || !tree.selectedCommunity) next.add('community-list');
    for (const d of tree.domains) {
      if (path.includes(d.apiKey) || d.apiKey === appState.domainKey || tree.domains.length === 1) {
        next.add(`dom-${d.apiKey}`);
      }
      for (const s of d.specifications) {
        if (path.includes(s.apiKey)) next.add(`spec-${s.apiKey}`);
      }
    }
    if (tree.organisations.length > 0) next.add('organisations');
    setExpanded(next);
  }, [tree, path, appState.domainKey]);

  const toggle = (k: string) => setExpanded(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const isExp = (k: string) => expanded.has(k);

  // Is this path segment active?
  const isActive = (p: string) => path === p || path.startsWith(p + '/');

  const startAdd = (type: string, parentKey: string) => { setAdding({ type, parentKey }); setAddName(''); setAddError(''); };
  const cancelAdd = () => { setAdding(null); setAddName(''); setAddError(''); };

  const selectDomain = async (domain: TreeDomain) => {
    await fetch(`/api/set-domain?domain_key=${domain.apiKey}&domain_name=${encodeURIComponent(domain.fullName || domain.shortName)}`, { method: 'POST' });
    await refreshState();
  };

  const selectCommunity = async (comm: TreeCommunity) => {
    await fetch('/api/select-community', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(comm) });
    // Also push community API key to backend connect so itbFetch picks it up
    await fetch('/api/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ community_api_key: comm.apiKey }) });
    await loadTree();
    await refreshState();
  };

  const selectOrganisation = async (org: TreeOrg) => {
    await fetch('/api/select-organisation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(org) });
    await fetch('/api/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organisation_api_key: org.apiKey }) });
    await refreshState();
  };

  const submitAdd = async () => {
    if (!adding || !addName.trim()) return;
    setAddBusy(true); setAddError('');
    try {
      const base = itbConfig.baseUrl.replace(/\/+$/, '');
      const key = itbConfig.communityApiKey || itbConfig.apiKey || '';
      if (adding.type === 'community') {
        const r = await fetch('/api/communities', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shortName: addName, fullName: addName }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error_description || d.error || 'Failed');
        // Community created — key auto-stored by backend, refresh to pick it up
        await refreshState();
      } else if (adding.type === 'domain') {
        const r = await fetch('/api/domains', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shortName: addName, fullName: addName, description: '' }) });
        if (!r.ok) { const d = await r.json(); throw new Error(d.error_description || d.error || 'Failed'); }
        const d = await r.json();
        if (d.apiKey) {
          await fetch(`/api/set-domain?domain_key=${d.apiKey}&domain_name=${encodeURIComponent(addName)}`, { method: 'POST' });
          await refreshState();
        }
      } else if (adding.type === 'spec') {
        const r = await fetch(`/itb-proxy/${encodeURIComponent(base)}/api/rest/specification`, { method: 'PUT', headers: { 'ITB_API_KEY': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ shortName: addName, fullName: addName, description: '', domain: adding.parentKey, hidden: false, displayOrder: 0 }) });
        if (!r.ok) { const d = await r.json(); throw new Error(d.error_description || d.error || 'Failed'); }
        setExpanded(p => new Set([...p, `dom-${adding.parentKey}`]));
      } else if (adding.type === 'org') {
        const r = await fetch('/api/organizations', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shortName: addName, fullName: addName }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error_description || d.error || 'Failed');
        // Org created — key auto-stored by backend
        await refreshState();
      } else if (adding.type === 'system') {
        const orgApiKey = adding.parentKey;
        const r = await fetch('/api/systems', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shortName: addName, fullName: addName, description: '', version: '1.0', organisation: orgApiKey }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error_description || d.error || 'Failed');
        // Auto-store system API key in config
        if (d.apiKey) {
          saveConfig({ ...itbConfig, systemApiKey: d.apiKey });
        }
        setExpanded(p => new Set([...p, `org-${orgApiKey}`]));
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
    if (path === 'dashboard') return <ConformanceMatrixPage />;
    if (path === 'setup') return <DashboardPage />;
    if (path === 'domains') return <DomainsPage />;
    if (path.startsWith('domain/')) return <SpecificationsPage />;
    if (path.startsWith('spec/')) return <SpecificationsPage />;
    if (path === 'specifications') return <SpecificationsPage />;
    if (path === 'import-ig') return <ImportIGPage />;
    if (path === 'organizations') return <OrganizationsPage />;
    if (path === 'matches') return <MatchesPage />;
    if (path.startsWith('system/')) return <SystemDetailPage />;
    if (path === 'services') return <ServicesPage />;
    return <DashboardPage />;
  };

  // Vendor registration is a *standalone* page — no sidebar, no tree, no exposure
  // of the rest of the admin app. Render the bare page on its own.
  if (path === 'register') {
    return <RegisterVendorPage />;
  }

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
            <button onClick={() => navigate('matches')} className={`p-1.5 rounded ${isActive('matches') ? 'bg-blue-600' : 'text-slate-400 hover:bg-slate-800'}`} title="Matches"><Link2 size={14} /></button>
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
              <LayoutDashboard size={13} /> Conformance
            </button>

            {/* Persona switch — picks which tree the sidebar shows. Cosmetic only. */}
            <div className="px-2 mt-2 mb-1">
              <div className="flex bg-slate-800 rounded p-0.5 text-[11px]">
                <button onClick={() => setPersona('spec')}
                  title="Spec management — domains and specifications"
                  className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded transition-colors ${persona === 'spec' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                  <FileCheck size={11} /> Specs
                </button>
                <button onClick={() => setPersona('vendor')}
                  title="Vendor management — communities, organisations, systems"
                  className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded transition-colors ${persona === 'vendor' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                  <Laptop size={11} /> Vendors
                </button>
              </div>
            </div>

            <div className="my-1.5 mx-3 border-t border-slate-800" />

            {/* Community selector — vendor persona only */}
            {persona === 'vendor' && <div className="px-2 mb-1">
              {tree?.communities && tree.communities.length > 0 ? (
                <div>
                  <button onClick={() => toggle('community-list')} className="w-full flex items-center gap-1.5 px-1 py-1 text-[10px] text-slate-500 hover:text-slate-300 uppercase tracking-wider font-semibold">
                    {isExp('community-list') ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                    Community
                    <div className="flex-1" />
                    <span onClick={e => { e.stopPropagation(); startAdd('community', ''); }} className="p-0.5 hover:text-emerald-400" title="Create community"><Plus size={10} /></span>
                  </button>
                  {isExp('community-list') && (
                    <div className="ml-2">
                      {adding?.type === 'community' && <InlineAdd />}
                      {tree.communities.map(c => {
                        const isSel = tree.selectedCommunity?.apiKey === c.apiKey;
                        return (
                          <button key={c.id} onClick={() => selectCommunity(c)}
                            className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-[11px] text-left transition-colors ${isSel ? 'bg-blue-600/30 text-blue-300' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
                            <Users size={10} className={isSel ? 'text-blue-400' : 'text-slate-500'} />
                            <span className="truncate flex-1">{c.fullName || c.shortName}</span>
                            {isSel && <Check size={10} className="text-blue-400" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {/* Show selected community name */}
                  {tree.selectedCommunity && !isExp('community-list') && (
                    <div className="ml-3 text-[10px] text-blue-400 truncate">{tree.selectedCommunity.fullName || tree.selectedCommunity.shortName}</div>
                  )}
                </div>
              ) : (
                <div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold px-1 py-1">Community</div>
                  {adding?.type === 'community' ? <InlineAdd /> : (
                    <button onClick={() => startAdd('community', '')} className="w-full flex items-center gap-1.5 px-2 py-1 text-[11px] text-blue-400 hover:text-blue-300">
                      <Plus size={10} /> Create community
                    </button>
                  )}
                </div>
              )}
            </div>}

            {/* Domains tree — spec persona only */}
            {persona === 'spec' && <>
            <div className="my-1 mx-3 border-t border-slate-800" />

            <div className="flex items-center gap-1.5 px-3 py-1">
              <button onClick={() => toggle('domains')} className="flex-shrink-0 p-0.5 text-slate-500 hover:text-slate-300">
                {isExp('domains') ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              </button>
              <button onClick={() => navigate('domains')} className={`text-[10px] uppercase tracking-wider font-semibold ${isActive('domains') ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                Domains
              </button>
              {/* Show active domain name when collapsed */}
              {appState.domainKey && !isExp('domains') && (
                <span className="text-[10px] text-blue-400 truncate flex-1">{appState.domainName || 'Selected'}</span>
              )}
              <div className="flex-1" />
              {tree?.selectedCommunity && (
                <span onClick={e => { e.stopPropagation(); startAdd('domain', ''); }} className="p-0.5 text-slate-500 hover:text-emerald-400 cursor-pointer" title="Create domain"><Plus size={10} /></span>
              )}
            </div>

            {isExp('domains') && (
              <div className="ml-1">
                {adding?.type === 'domain' && <InlineAdd />}

                {!tree?.selectedCommunity && !tree?.domains?.length && (
                  <div className="text-[10px] text-slate-600 px-3 py-1 italic">Select a community first</div>
                )}

                {tree?.domains?.map(domain => {
                  const dk = `dom-${domain.apiKey}`;
                  const domPath = `domain/${domain.apiKey}`;
                  const isActiveDomain = domain.apiKey === appState.domainKey;
                  return (
                    <div key={domain.apiKey}>
                      <div className={`group flex items-center gap-1 px-2 py-1 rounded-sm mx-1 ${isActiveDomain ? 'bg-blue-600/20' : 'hover:bg-slate-800/50'}`}>
                        <button onClick={() => toggle(dk)} className="flex-shrink-0">
                          {isExp(dk) ? <ChevronDown size={11} className="text-slate-500" /> : <ChevronRight size={11} className="text-slate-500" />}
                        </button>
                        <Globe size={11} className={isActiveDomain ? 'text-blue-400' : 'text-blue-500/60'} />
                        <button onClick={() => { selectDomain(domain); navigate(domPath); }}
                          className={`flex-1 text-left text-[12px] truncate ${isActiveDomain ? 'text-blue-300 font-medium' : isActive(domPath) ? 'text-white font-medium' : 'text-slate-300 hover:text-white'}`}>
                          {domain.fullName || domain.shortName}
                        </button>
                        {isActiveDomain && <Check size={10} className="text-blue-400 flex-shrink-0" />}
                        <span onClick={e => { e.stopPropagation(); startAdd('spec', domain.apiKey); }}
                          className="p-0.5 text-slate-600 hover:text-emerald-400 opacity-0 group-hover:opacity-100 cursor-pointer" title="Add specification"><Plus size={10} /></span>
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
                  <PackagePlus size={13} /> Add specification
                </button>
              </div>
            )}
            </>}

            {/* Organisations tree — vendor persona only */}
            {persona === 'vendor' && <>
            <div className="my-1 mx-3 border-t border-slate-800" />

            <div className="flex items-center gap-1.5 px-3 py-1">
              <button onClick={() => toggle('organisations')} className="flex-shrink-0 p-0.5 text-slate-500 hover:text-slate-300">
                {isExp('organisations') ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              </button>
              <button onClick={() => navigate('organizations')} className={`text-[10px] uppercase tracking-wider font-semibold ${isActive('organizations') ? 'text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                Organisations
              </button>
              <div className="flex-1" />
              {tree?.selectedCommunity && (
                <span onClick={e => { e.stopPropagation(); startAdd('org', ''); }} className="p-0.5 text-slate-500 hover:text-emerald-400 cursor-pointer" title="Create organisation"><Plus size={10} /></span>
              )}
            </div>
            {isExp('organisations') && (
              <div className="ml-1">
                {adding?.type === 'org' && <InlineAdd />}

                {!tree?.selectedCommunity && !tree?.organisations?.length && (
                  <div className="text-[10px] text-slate-600 px-3 py-1 italic">Select a community first</div>
                )}

                {tree?.organisations?.map(o => {
                  const ok = `org-${o.apiKey}`;
                  const isSel = tree?.selectedOrganisation?.apiKey === o.apiKey;
                  return (
                    <div key={o.apiKey}>
                      <div className="group flex items-center gap-1 px-2 py-1 hover:bg-slate-800/50 rounded-sm mx-1">
                        <button onClick={() => toggle(ok)} className="flex-shrink-0">
                          {isExp(ok) ? <ChevronDown size={11} className="text-slate-500" /> : <ChevronRight size={11} className="text-slate-500" />}
                        </button>
                        <Building2 size={11} className={isSel ? 'text-amber-400' : 'text-amber-600'} />
                        <button onClick={() => selectOrganisation(o)}
                          className={`flex-1 text-left text-[12px] truncate ${isSel ? 'text-amber-300 font-medium' : 'text-slate-300 hover:text-white'}`}>
                          {o.fullName || o.shortName}
                        </button>
                        {isSel && <Check size={10} className="text-amber-400 flex-shrink-0 mr-1" />}
                        <span onClick={e => { e.stopPropagation(); startAdd('system', o.apiKey); }}
                          className="p-0.5 text-slate-600 hover:text-emerald-400 opacity-0 group-hover:opacity-100 cursor-pointer" title="Add system"><Plus size={10} /></span>
                      </div>

                      {isExp(ok) && (
                        <div className="ml-5 border-l border-slate-800 pl-2 mb-1">
                          {adding?.type === 'system' && adding.parentKey === o.apiKey && <InlineAdd />}
                          {o.systems?.map(s => {
                            const sysPath = `system/${s.apiKey}`;
                            const isViewingSys = isActive(sysPath);
                            return (
                            <button key={s.apiKey} onClick={() => navigate(sysPath)}
                              className={`w-full flex items-center gap-1 py-0.5 px-1 rounded text-left transition-colors ${isViewingSys ? 'bg-blue-600/40 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
                              <Laptop size={9} className={isViewingSys ? 'text-blue-300' : 'text-slate-500'} />
                              <span className="text-[11px] truncate">{s.fullName || s.shortName}</span>
                              <span className="text-[9px] text-slate-600 font-mono ml-auto">{s.apiKey.slice(0, 8)}...</span>
                            </button>
                            );
                          })}
                          {(!o.systems || o.systems.length === 0) && !(adding?.type === 'system' && adding.parentKey === o.apiKey) && (
                            <div className="text-[10px] text-slate-600 px-1 py-0.5">
                              <button onClick={() => startAdd('system', o.apiKey)} className="text-blue-400 hover:underline">+ Add system</button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            </>}

            {/* Matches — vendor persona only */}
            {persona === 'vendor' && (
              <>
                <div className="my-1 mx-3 border-t border-slate-800" />
                <button onClick={() => navigate('matches')}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] ${isActive('matches') ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}>
                  <Link2 size={13} /> Matches
                </button>
              </>
            )}

            <div className="my-1 mx-3 border-t border-slate-800" />
            <button onClick={() => navigate('services')}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] ${isActive('services') ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}>
              <Container size={13} /> Services
            </button>
          </div>

          {/* Connection + buttons */}
          <div className="border-t border-slate-700 px-3 py-2">
            <button onClick={() => setITBSettingsOpen(true)} className="w-full flex items-center gap-2 text-[11px] text-slate-500 hover:text-white transition-colors">
              {appState.mock_mode ? (
                <>
                  <span className="inline-block w-2 h-2 rounded-full bg-purple-400" />
                  <span className="text-purple-300 font-medium">Mock mode</span>
                </>
              ) : appState.connected ? (
                <><CheckCircle size={11} className="text-green-400" /> Connected</>
              ) : (
                <><XCircle size={11} className="text-red-400" /> Disconnected</>
              )}
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
