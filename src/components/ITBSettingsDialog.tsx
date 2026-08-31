import React, { useState, useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Loader2, Trash2, Wand2 } from 'lucide-react';
import {
  ITBConfig, checkITBHealth, checkMasterKey, checkSystemKey,
  checkCommunityKey, checkOrganisationKey,
} from '../services/itbClient';
import { useAppContext } from '../context/AppContext';

interface Props {
  config: ITBConfig;
  onSave: (config: ITBConfig) => void;
  onClose: () => void;
}

type KeyStatus = { ok: boolean; message: string } | null;

/**
 * One API key row: label, what it unlocks, where to find it, and a Test button.
 *
 * ITB scopes its REST API per key, and the scopes are not nested — a key that
 * works for one group of endpoints returns 403 on the others. So each key gets
 * its own row stating what it buys, rather than one "connect" secret.
 */
const KeyField: React.FC<{
  label: string;
  badge?: { text: string; tone: 'required' | 'optional' | 'rare' };
  unlocks: string;
  where: string;
  value: string;
  onChange: (v: string) => void;
  onTest: () => Promise<KeyStatus>;
  autoFilled?: boolean;
  baseUrl: string;
  note?: string;
}> = ({ label, badge, unlocks, where, value, onChange, onTest, autoFilled, baseUrl, note }) => {
  const [status, setStatus] = useState<KeyStatus>(null);
  const [testing, setTesting] = useState(false);

  const toneClass = badge?.tone === 'required'
    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
    : badge?.tone === 'rare'
      ? 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400'
      : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300';

  return (
    <div>
      <div className="flex items-center gap-2 mb-0.5">
        <label className="text-xs font-medium text-gray-700 dark:text-gray-300">{label}</label>
        {badge && (
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium uppercase tracking-wide ${toneClass}`}>
            {badge.text}
          </span>
        )}
        {autoFilled && (
          <span className="text-[9px] text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5" title="Filled in from your sidebar selection">
            <Wand2 size={9} /> auto-filled
          </span>
        )}
      </div>
      <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-1.5 leading-snug">{unlocks}</p>
      <div className="flex gap-2">
        <input
          type="password"
          value={value}
          onChange={e => { onChange(e.target.value); setStatus(null); }}
          placeholder={where}
          className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <button
          onClick={async () => { setTesting(true); setStatus(null); setStatus(await onTest()); setTesting(false); }}
          disabled={testing || !baseUrl.trim() || !value.trim()}
          className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
        >
          {testing ? <Loader2 size={14} className="animate-spin" /> : 'Test'}
        </button>
      </div>
      {status && (
        <div className={`mt-1.5 flex items-start gap-1 text-xs ${status.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {status.ok ? <CheckCircle size={12} className="mt-0.5 flex-shrink-0" /> : <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />}
          <span>{status.message}</span>
        </div>
      )}
      {note && <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500 leading-snug">{note}</p>}
    </div>
  );
};

export const ITBSettingsDialog: React.FC<Props> = ({ config, onSave, onClose }) => {
  const { appState } = useAppContext();
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [deployPath, setDeployPath] = useState(config.deployPath || '/api/rest/testsuite/deploy');

  // All four keys are editable. Community and organisation are also written by
  // selecting one in the sidebar; we seed from that but let the user override,
  // since a key pasted from ITB's admin UI has to be enterable somewhere.
  const [communityApiKey, setCommunityApiKey] = useState(appState.communityApiKey || config.communityApiKey || '');
  const [organisationApiKey, setOrganisationApiKey] = useState(appState.organisationApiKey || config.organisationApiKey || '');
  const [systemApiKey, setSystemApiKey] = useState(config.systemApiKey ?? '');
  const [masterApiKey, setMasterApiKey] = useState(config.masterApiKey ?? '');
  const [communityTouched, setCommunityTouched] = useState(false);
  const [organisationTouched, setOrganisationTouched] = useState(false);

  const [healthStatus, setHealthStatus] = useState<KeyStatus>(null);
  const [checking, setChecking] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Follow sidebar selections while the user hasn't overridden the field.
  useEffect(() => {
    if (!communityTouched && appState.communityApiKey) setCommunityApiKey(appState.communityApiKey);
  }, [appState.communityApiKey, communityTouched]);
  useEffect(() => {
    if (!organisationTouched && appState.organisationApiKey) setOrganisationApiKey(appState.organisationApiKey);
  }, [appState.organisationApiKey, organisationTouched]);

  const handleCheck = async () => {
    setChecking(true);
    setHealthStatus(null);
    setHealthStatus(await checkITBHealth(baseUrl));
    setChecking(false);
  };

  const handleSave = async () => {
    onSave({
      baseUrl: baseUrl.trim(),
      deployPath: deployPath.trim() || '/api/rest/testsuite/deploy',
      masterApiKey: masterApiKey.trim() || undefined,
      systemApiKey: systemApiKey.trim() || undefined,
      communityApiKey: communityApiKey.trim() || undefined,
      organisationApiKey: organisationApiKey.trim() || undefined,
      specificationId: config.specificationId,
      communityId: config.communityId,
      organisationId: config.organisationId,
      systemId: config.systemId,
      actorId: config.actorId,
      testSuiteId: config.testSuiteId,
    });
    // Mirror the keys into server state — the dev-server middleware reads them
    // from there, not from localStorage.
    await fetch('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: baseUrl.trim(),
        master_api_key: masterApiKey.trim(),
        community_api_key: communityApiKey.trim(),
        organisation_api_key: organisationApiKey.trim(),
      }),
    }).catch(() => {});
    onClose();
  };

  useEffect(() => {
    if (baseUrl.trim()) handleCheck();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col"
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
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              ITB Base URL
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                placeholder="http://localhost:10003"
                className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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

          <div className="border-t border-gray-200 dark:border-slate-700 pt-3">
            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug mb-3">
              ITB scopes its REST API per key, and the scopes don't nest — a key that works for one
              group of endpoints returns <span className="font-mono">403</span> on the others. Fill in
              the ones you need; picking a community or organisation in the sidebar fills those two in
              for you.
            </p>

            <div className="space-y-4">
              <KeyField
                label="Community API Key"
                badge={{ text: 'required', tone: 'required' }}
                unlocks="Domains, specifications, actors, organisations, systems and test suite deploy — nearly everything this app does."
                where="ITB: Communities > your community > API key"
                value={communityApiKey}
                onChange={v => { setCommunityApiKey(v); setCommunityTouched(true); }}
                autoFilled={!communityTouched && !!appState.communityApiKey}
                baseUrl={baseUrl}
                onTest={() => checkCommunityKey(baseUrl, communityApiKey)}
              />

              <KeyField
                label="Organisation API Key"
                badge={{ text: 'optional', tone: 'optional' }}
                unlocks="Conformance statements and launching test sessions as that organisation. Also needed to verify a System API Key."
                where="ITB: Organisations > your org > API key"
                value={organisationApiKey}
                onChange={v => { setOrganisationApiKey(v); setOrganisationTouched(true); }}
                autoFilled={!organisationTouched && !!appState.organisationApiKey}
                baseUrl={baseUrl}
                onTest={() => checkOrganisationKey(baseUrl, organisationApiKey)}
                note="Test goes through a test-session endpoint, so it fails when the community's automation API is off — even with the right key. Import and deploy don't need it."
              />

              <KeyField
                label="System API Key"
                badge={{ text: 'optional', tone: 'optional' }}
                unlocks="Runs tests as one specific registered system instead of an auto-created one."
                where="ITB: Organisation > System > API key"
                value={systemApiKey}
                onChange={setSystemApiKey}
                baseUrl={baseUrl}
                onTest={async () => {
                  if (!organisationApiKey.trim()) {
                    return { ok: false, message: 'Enter the Organisation API Key above first — ITB verifies a system through its owning organisation.' };
                  }
                  return checkSystemKey(baseUrl, organisationApiKey.trim(), systemApiKey);
                }}
                note="Same caveat as the organisation key — this Test needs the community's automation API enabled."
              />

              <KeyField
                label="Master API Key"
                badge={{ text: 'rarely needed', tone: 'rare' }}
                unlocks="Creating, updating and deleting communities — nothing else. Leave blank if your community already exists in ITB."
                where="ITB: Administration > REST API > Master API key"
                value={masterApiKey}
                onChange={setMasterApiKey}
                baseUrl={baseUrl}
                onTest={() => checkMasterKey(baseUrl, masterApiKey)}
                note="Set by AUTOMATION_API_MASTER_KEY in docker-compose, but ITB's stored value (Administration > REST API) wins — check there if the two differ."
              />
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
