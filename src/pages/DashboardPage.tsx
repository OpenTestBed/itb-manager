import React, { useEffect, useState } from 'react';
import { Globe, FileCheck, TestTube2, Building2, PackagePlus, ExternalLink, CheckCircle, Circle, ArrowRight, Settings, Container } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

export function DashboardPage() {
  const { appState, navigate, itbConfig, setITBSettingsOpen } = useAppContext();
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
  const hasApiKey = !!(itbConfig.communityApiKey || itbConfig.organisationApiKey);
  const isFresh = !appState.connected || !hasApiKey;

  // Guided setup steps
  const steps = [
    { id: 'itb', label: 'Start ITB', description: 'Run docker compose up in your itb-starter directory', done: appState.connected },
    { id: 'login', label: 'Log into ITB', description: 'Open ITB, create a community and get your API keys', done: hasApiKey },
    { id: 'keys', label: 'Configure API keys', description: 'Enter your community and organisation API keys in Settings', done: hasApiKey && !!itbConfig.specificationId },
    { id: 'domain', label: 'Select a domain', description: 'Choose which domain to work with', done: !!appState.domainKey },
    { id: 'import', label: 'Import a Testing IG', description: 'Upload an IG package to add test suites', done: igs.length > 0 },
  ];
  const completedSteps = steps.filter(s => s.done).length;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Dashboard</h1>

      {/* ── Guided setup (shown when fresh/incomplete) ── */}
      {completedSteps < steps.length && (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-blue-200 dark:border-blue-800 mb-6 overflow-hidden">
          <div className="px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800">
            <h2 className="font-semibold text-sm text-blue-900 dark:text-blue-300">Getting Started</h2>
            <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5">{completedSteps} of {steps.length} steps completed</p>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-slate-800">
            {steps.map((step, i) => (
              <div key={step.id} className={`px-4 py-3 flex items-start gap-3 ${step.done ? 'opacity-60' : ''}`}>
                <div className="mt-0.5 flex-shrink-0">
                  {step.done
                    ? <CheckCircle size={16} className="text-green-500" />
                    : <Circle size={16} className="text-gray-300 dark:text-slate-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`font-medium text-sm ${step.done ? 'text-gray-500 dark:text-slate-500 line-through' : 'text-gray-900 dark:text-white'}`}>
                    {i + 1}. {step.label}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{step.description}</div>
                </div>
                {/* Action buttons for incomplete steps */}
                {!step.done && step.id === 'login' && (
                  <a href={itbConfig.baseUrl || 'http://localhost:10003'} target="_blank" rel="noopener"
                    className="flex items-center gap-1 px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 flex-shrink-0">
                    Open ITB <ExternalLink size={10} />
                  </a>
                )}
                {!step.done && step.id === 'keys' && (
                  <button onClick={() => setITBSettingsOpen(true)}
                    className="flex items-center gap-1 px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 flex-shrink-0">
                    <Settings size={10} /> Settings
                  </button>
                )}
                {!step.done && step.id === 'domain' && (
                  <button onClick={() => navigate('domains')}
                    className="flex items-center gap-1 px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 flex-shrink-0">
                    Domains <ArrowRight size={10} />
                  </button>
                )}
                {!step.done && step.id === 'import' && (
                  <button onClick={() => navigate('import-ig')}
                    className="flex items-center gap-1 px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 flex-shrink-0">
                    Import <ArrowRight size={10} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

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
        <button onClick={() => navigate('services')} className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors text-sm text-gray-700 dark:text-gray-300">
          <Container size={16} /> Services & Plugins
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
              <div key={s.apiKey} className="px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-slate-800/50 cursor-pointer"
                onClick={() => navigate(`spec/${s.apiKey}`)}>
                <div>
                  <div className="font-medium text-gray-900 dark:text-white text-sm">{s.fullName || s.shortName}</div>
                  <div className="text-xs text-gray-500 dark:text-slate-400">{s.description}</div>
                </div>
                <ArrowRight size={14} className="text-gray-300" />
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
