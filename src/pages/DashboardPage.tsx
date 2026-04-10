import React, { useEffect, useState } from 'react';
import { Globe, FileCheck, TestTube2, Building2, PackagePlus } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

export function DashboardPage() {
  const { appState, navigate } = useAppContext();
  const [domains, setDomains] = useState<any[]>([]);
  const [specs, setSpecs] = useState<any[]>([]);
  const [orgs, setOrgs] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/domains').then(r => r.ok ? r.json() : []).then(setDomains).catch(() => {});
    if (appState.domainKey) {
      fetch(`/api/domains/${appState.domainKey}/specifications`).then(r => r.ok ? r.json() : []).then(setSpecs).catch(() => {});
    }
    fetch('/api/organizations').then(r => r.ok ? r.json() : []).then(setOrgs).catch(() => {});
  }, [appState.domainKey]);

  const igs = Object.entries(appState.importedIGs);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Dashboard</h1>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Domains', count: domains.length, icon: Globe, color: 'blue' },
          { label: 'Specifications', count: specs.length, icon: FileCheck, color: 'emerald' },
          { label: 'Imported IGs', count: igs.length, icon: TestTube2, color: 'purple' },
          { label: 'Organizations', count: orgs.length, icon: Building2, color: 'amber' },
        ].map(s => (
          <div key={s.label} className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-4 flex items-center gap-4">
            <div className={`p-2.5 rounded-lg bg-${s.color}-100 dark:bg-${s.color}-900/30`}>
              <s.icon size={20} className={`text-${s.color}-600 dark:text-${s.color}-400`} />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{s.count}</div>
              <div className="text-sm text-gray-500 dark:text-slate-400">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="flex gap-3 mb-8">
        <button onClick={() => navigate('import-ig')} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
          <PackagePlus size={16} /> Import IG
        </button>
        <button onClick={() => navigate('domains')} className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors text-sm text-gray-700 dark:text-gray-300">
          <Globe size={16} /> Manage Domains
        </button>
      </div>

      {/* Active domain specs */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 mb-6">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 dark:text-white">
            Specifications {appState.domainName && <span className="text-sm font-normal text-gray-500">in {appState.domainName}</span>}
          </h2>
          <button onClick={() => navigate('specifications')} className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400">View all</button>
        </div>
        {!specs.length ? (
          <div className="p-8 text-center text-gray-500 dark:text-slate-400">
            {appState.domainKey ? 'No specifications yet. Import an IG to get started.' : 'Select a domain first.'}
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-800">
            {specs.slice(0, 5).map((s: any) => (
              <div key={s.apiKey} className="px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-slate-800/50 cursor-pointer" onClick={() => navigate('specifications')}>
                <div>
                  <div className="font-medium text-gray-900 dark:text-white text-sm">{s.fullName || s.shortName}</div>
                  <div className="text-xs text-gray-500 dark:text-slate-400">{s.description}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Imported IGs */}
      {igs.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700">
            <h2 className="font-semibold text-gray-900 dark:text-white">Imported IGs</h2>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-slate-800">
            {igs.map(([name, info]) => (
              <div key={name} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <div className="font-medium text-gray-900 dark:text-white text-sm">{name}</div>
                  <div className="text-xs text-gray-500 dark:text-slate-400">v{info.version} &mdash; {info.spec_keys?.length || 0} spec(s)</div>
                </div>
                <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full">Deployed</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
