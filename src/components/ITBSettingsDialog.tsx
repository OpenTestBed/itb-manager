import React, { useState, useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Loader2, Lock, Trash2 } from 'lucide-react';
import { ITBConfig, checkITBHealth, checkMasterKey, checkSystemKey } from '../services/itbClient';
import { useAppContext } from '../context/AppContext';

interface Props {
  config: ITBConfig;
  onSave: (config: ITBConfig) => void;
  onClose: () => void;
}

export const ITBSettingsDialog: React.FC<Props> = ({ config, onSave, onClose }) => {
  const { appState } = useAppContext();
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [deployPath, setDeployPath] = useState(config.deployPath || '/api/rest/testsuite/deploy');
  const [masterApiKey, setMasterApiKey] = useState(config.masterApiKey ?? '');
  const [systemApiKey, setSystemApiKey] = useState(config.systemApiKey ?? '');
  const [healthStatus, setHealthStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkingMaster, setCheckingMaster] = useState(false);
  const [masterKeyStatus, setMasterKeyStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [checkingSystem, setCheckingSystem] = useState(false);
  const [systemKeyStatus, setSystemKeyStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Auto-populated keys from server state (read-only display)
  const communityApiKey = appState.communityApiKey || config.communityApiKey || '';
  const organisationApiKey = appState.organisationApiKey || config.organisationApiKey || '';

  const handleCheck = async () => {
    setChecking(true);
    setHealthStatus(null);
    const result = await checkITBHealth(baseUrl);
    setHealthStatus(result);
    setChecking(false);
  };

  const handleSave = async () => {
    // Save config to localStorage
    onSave({
      baseUrl: baseUrl.trim(),
      deployPath: deployPath.trim() || '/api/rest/testsuite/deploy',
      masterApiKey: masterApiKey.trim() || undefined,
      systemApiKey: systemApiKey.trim() || undefined,
      communityApiKey: communityApiKey || undefined,
      organisationApiKey: organisationApiKey || undefined,
      specificationId: config.specificationId,
      communityId: config.communityId,
      organisationId: config.organisationId,
      systemId: config.systemId,
      actorId: config.actorId,
      testSuiteId: config.testSuiteId,
    });
    // Also push master key to backend state
    if (masterApiKey.trim()) {
      await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: baseUrl.trim(), master_api_key: masterApiKey.trim() }),
      });
    }
    onClose();
  };

  useEffect(() => {
    if (baseUrl.trim()) handleCheck();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-slate-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            ITB Connection Settings
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 overflow-auto flex-1">
          {/* Base URL */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              ITB Base URL
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                placeholder="http://localhost:10003"
                className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={handleCheck}
                disabled={checking || !baseUrl.trim()}
                className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
              >
                {checking ? <Loader2 size={14} className="animate-spin" /> : 'Test'}
              </button>
            </div>
            {healthStatus && (
              <div className={`mt-1.5 flex items-center gap-1 text-xs ${healthStatus.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {healthStatus.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                {healthStatus.message}
              </div>
            )}
          </div>

          {/* Master API Key */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Master API Key <span className="text-gray-400">(for creating communities & domains)</span>
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                value={masterApiKey}
                onChange={e => { setMasterApiKey(e.target.value); setMasterKeyStatus(null); }}
                placeholder="Must match AUTOMATION_API_MASTER_KEY in docker-compose"
                className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={async () => { setCheckingMaster(true); setMasterKeyStatus(null); const r = await checkMasterKey(baseUrl, masterApiKey); setMasterKeyStatus(r); setCheckingMaster(false); }}
                disabled={checkingMaster || !baseUrl.trim() || !masterApiKey.trim()}
                className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
              >
                {checkingMaster ? <Loader2 size={14} className="animate-spin" /> : 'Test'}
              </button>
            </div>
            {masterKeyStatus && (
              <div className={`mt-1.5 flex items-center gap-1 text-xs ${masterKeyStatus.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {masterKeyStatus.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                {masterKeyStatus.message}
              </div>
            )}
            <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">
              Check rest_api_admin_key in ITB database if unsure
            </p>
          </div>

          {/* System API Key */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              System API Key <span className="text-gray-400">(for test sessions)</span>
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                value={systemApiKey}
                onChange={e => { setSystemApiKey(e.target.value); setSystemKeyStatus(null); }}
                placeholder="From ITB: Organisation > System > API key"
                className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={async () => {
                  setCheckingSystem(true); setSystemKeyStatus(null);
                  const orgKey = organisationApiKey;
                  if (!orgKey) { setSystemKeyStatus({ ok: false, message: 'Select an organisation first (org key needed to verify)' }); setCheckingSystem(false); return; }
                  const r = await checkSystemKey(baseUrl, orgKey, systemApiKey);
                  setSystemKeyStatus(r); setCheckingSystem(false);
                }}
                disabled={checkingSystem || !baseUrl.trim() || !systemApiKey.trim()}
                className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
              >
                {checkingSystem ? <Loader2 size={14} className="animate-spin" /> : 'Test'}
              </button>
            </div>
            {systemKeyStatus && (
              <div className={`mt-1.5 flex items-center gap-1 text-xs ${systemKeyStatus.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {systemKeyStatus.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                {systemKeyStatus.message}
              </div>
            )}
          </div>

          {/* Auto-populated keys (read-only) */}
          <div className="border-t border-gray-200 dark:border-slate-700 pt-3">
            <div className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider font-semibold mb-2 flex items-center gap-1">
              <Lock size={9} /> Auto-populated keys
            </div>
            <div className="space-y-2">
              <div>
                <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Community API Key</label>
                <div className="px-3 py-1.5 text-xs bg-gray-50 dark:bg-slate-900/50 border border-gray-200 dark:border-slate-700 rounded-lg text-gray-500 dark:text-gray-500 font-mono truncate">
                  {communityApiKey || <span className="italic text-gray-400">Set when you select a community</span>}
                </div>
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">Organisation API Key</label>
                <div className="px-3 py-1.5 text-xs bg-gray-50 dark:bg-slate-900/50 border border-gray-200 dark:border-slate-700 rounded-lg text-gray-500 dark:text-gray-500 font-mono truncate">
                  {organisationApiKey || <span className="italic text-gray-400">Set when you select an organisation</span>}
                </div>
              </div>
            </div>
          </div>

          {/* Advanced */}
          <div>
            <button onClick={() => setShowAdvanced(!showAdvanced)} className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline">
              {showAdvanced ? 'Hide' : 'Show'} advanced settings
            </button>
            {showAdvanced && (
              <div className="mt-2 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Deploy API Path</label>
                  <input
                    type="text"
                    value={deployPath}
                    onChange={e => setDeployPath(e.target.value)}
                    placeholder="/api/rest/testsuite/deploy"
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-gray-200 dark:border-slate-700">
          <button
            onClick={async () => {
              if (!confirm('Reset all stored settings? This clears server state, localStorage config, and selected specs. You will need to reconfigure.')) return;
              setResetting(true);
              // Clear server state
              await fetch('/api/reset', { method: 'POST' }).catch(() => {});
              // Clear localStorage (keep theme)
              localStorage.removeItem('itb-config');
              localStorage.removeItem('selectedSpecKey');
              localStorage.removeItem('selectedSpecName');
              // Reset form to defaults
              const defaults: ITBConfig = {
                baseUrl: baseUrl.trim() || 'http://localhost:10003',
                deployPath: '/api/rest/testsuite/deploy',
              };
              onSave(defaults);
              setResetting(false);
              window.location.reload();
            }}
            disabled={resetting}
            className="flex items-center gap-1 px-3 py-2 text-xs font-medium rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-40"
            title="Clear all stored settings and start fresh"
          >
            <Trash2 size={12} /> {resetting ? 'Resetting...' : 'Reset all'}
          </button>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};
