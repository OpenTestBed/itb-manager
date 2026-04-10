import React, { useEffect, useState } from 'react';
import { FileCheck, TestTube2, Users, Globe, ChevronRight, PackagePlus, Loader2 } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

export function SpecificationsPage() {
  const { path, navigate, appState, selectedSpecKey, selectSpec } = useAppContext();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Parse path to determine view
  // #/specifications → list domains (or auto-drill)
  // #/domain/{key} → specs in domain
  // #/spec/{key} → spec detail (actors + suites)
  const parts = path.split('/');
  const viewLevel = parts[0]; // 'domain', 'spec', or 'specifications'
  const viewKey = parts[1] || '';

  useEffect(() => {
    setLoading(true);
    setData(null);

    if (viewLevel === 'domain' && viewKey) {
      fetch(`/api/domains/${viewKey}/specifications`).then(r => r.ok ? r.json() : []).then(setData).catch(() => setData([])).finally(() => setLoading(false));
    } else if (viewLevel === 'spec' && viewKey) {
      fetch(`/api/specifications/${viewKey}/detail`).then(r => r.ok ? r.json() : null).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
    } else {
      // specifications or unknown — fetch domains
      fetch('/api/domains').then(r => r.ok ? r.json() : []).then(d => {
        // Auto-drill if there's a selected domain
        if (appState.domainKey) {
          navigate(`domain/${appState.domainKey}`);
          return;
        }
        setData(d);
      }).catch(() => setData([])).finally(() => setLoading(false));
    }
  }, [viewLevel, viewKey]);

  // Breadcrumb
  const crumbs: { label: string; path?: string }[] = [];
  if (viewLevel === 'domain' || viewLevel === 'spec') {
    crumbs.push({ label: 'Domains', path: 'specifications' });
  }
  if (viewLevel === 'domain') {
    const name = data?.[0] ? 'Domain' : appState.domainName || viewKey.substring(0, 8);
    // Try to get domain name from tree
    crumbs.push({ label: name });
  }
  if (viewLevel === 'spec') {
    if (appState.domainKey) crumbs.push({ label: appState.domainName || 'Domain', path: `domain/${appState.domainKey}` });
    crumbs.push({ label: data?.fullName || data?.shortName || viewKey.substring(0, 8) });
  }

  const ListItem = ({ icon: Icon, iconColor, label, sublabel, onClick, trailing }: { icon: any; iconColor: string; label: string; sublabel?: string; onClick: () => void; trailing?: React.ReactNode }) => (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors group">
      <Icon size={18} className={`${iconColor} flex-shrink-0`} />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm text-gray-900 dark:text-white">{label}</div>
        {sublabel && <div className="text-xs text-gray-500 dark:text-slate-400 truncate">{sublabel}</div>}
      </div>
      {trailing}
      <ChevronRight size={14} className="text-gray-300 dark:text-slate-600 group-hover:text-gray-500 flex-shrink-0" />
    </button>
  );

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      {crumbs.length > 0 && (
        <div className="flex items-center gap-1 text-sm mb-4 flex-wrap">
          {crumbs.map((c, i) => (
            <React.Fragment key={i}>
              {i > 0 && <ChevronRight size={12} className="text-gray-400" />}
              {c.path ? (
                <button onClick={() => navigate(c.path!)} className="text-blue-600 hover:text-blue-800 dark:text-blue-400 hover:underline">{c.label}</button>
              ) : (
                <span className="text-gray-900 dark:text-white font-medium">{c.label}</span>
              )}
            </React.Fragment>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-400"><Loader2 size={20} className="animate-spin mr-2" /> Loading...</div>
      ) : viewLevel === 'specifications' || (viewLevel !== 'domain' && viewLevel !== 'spec') ? (
        /* ── Domains list ── */
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Domains</h1>
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-800 overflow-hidden">
            {!data?.length ? (
              <div className="p-8 text-center text-sm text-gray-500">No domains found.</div>
            ) : data.map((d: any) => (
              <ListItem key={d.apiKey} icon={Globe} iconColor="text-blue-500" label={d.fullName || d.shortName} sublabel={d.description}
                onClick={() => navigate(`domain/${d.apiKey}`)} />
            ))}
          </div>
        </div>

      ) : viewLevel === 'domain' ? (
        /* ── Specifications in domain ── */
        <div>
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">{appState.domainName || 'Specifications'}</h1>
            <button onClick={() => navigate('import-ig')}
              className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
              <PackagePlus size={14} /> Import IG
            </button>
          </div>
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-800 overflow-hidden">
            {!data?.length ? (
              <div className="p-8 text-center text-sm text-gray-500 dark:text-slate-400">No specifications in this domain.</div>
            ) : data.map((s: any) => (
              <ListItem key={s.apiKey} icon={FileCheck} iconColor="text-emerald-500" label={s.fullName || s.shortName} sublabel={s.description}
                onClick={() => { selectSpec(s.apiKey, s.fullName || s.shortName); navigate(`spec/${s.apiKey}`); }}
                trailing={s.apiKey === selectedSpecKey ? <span className="text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded-full">Selected</span> : undefined} />
            ))}
          </div>
        </div>

      ) : viewLevel === 'spec' ? (
        /* ── Spec detail ── */
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">{data?.fullName || data?.shortName || 'Specification'}</h1>
              {data?.description && <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">{data.description}</p>}
            </div>
            <button onClick={() => { selectSpec(viewKey, data?.fullName || data?.shortName || ''); navigate('import-ig'); }}
              className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
              <PackagePlus size={14} /> Import tests
            </button>
          </div>

          {/* Test Suites */}
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 mb-4 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-200 dark:border-slate-700 flex items-center gap-2 bg-gray-50 dark:bg-slate-800">
              <TestTube2 size={14} className="text-purple-500" />
              <span className="font-semibold text-sm text-gray-900 dark:text-white">Test Suites ({data?.testSuites?.length || 0})</span>
            </div>
            {!data?.testSuites?.length ? (
              <div className="p-6 text-center text-sm text-gray-500">No test suites deployed.</div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-slate-800">
                {data.testSuites.map((ts: any) => (
                  <div key={ts.id} className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <TestTube2 size={14} className="text-purple-500 flex-shrink-0" />
                      <span className="font-medium text-sm text-gray-900 dark:text-white">{ts.name}</span>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-slate-400 ml-6 mt-0.5">
                      <code className="bg-gray-100 dark:bg-slate-800 px-1 rounded text-[10px]">{ts.identifier}</code>
                      {ts.description && <span className="ml-2">{ts.description}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actors */}
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-200 dark:border-slate-700 flex items-center gap-2 bg-gray-50 dark:bg-slate-800">
              <Users size={14} className="text-blue-500" />
              <span className="font-semibold text-sm text-gray-900 dark:text-white">Actors ({data?.actors?.length || 0})</span>
            </div>
            {!data?.actors?.length ? (
              <div className="p-6 text-center text-sm text-gray-500">No actors.</div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-slate-800">
                {data.actors.map((a: any) => (
                  <div key={a.apiKey} className="px-4 py-2 flex items-center gap-2">
                    <Users size={12} className={a.identifier === 'User' ? 'text-blue-500' : 'text-gray-400'} />
                    <span className="text-sm text-gray-900 dark:text-white">{a.name}</span>
                    <code className="text-[10px] text-gray-400 bg-gray-100 dark:bg-slate-800 px-1 rounded">{a.identifier}</code>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
