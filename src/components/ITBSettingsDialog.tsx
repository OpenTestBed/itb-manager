import React, { useState, useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Loader2, Search } from 'lucide-react';
import { ITBConfig, checkITBHealth, checkOrganisationKey, checkSystemKey, checkCommunityKey, checkSpecification, discoverEndpoints } from '../services/itbClient';

interface Props {
  config: ITBConfig;
  onSave: (config: ITBConfig) => void;
  onClose: () => void;
}

export const ITBSettingsDialog: React.FC<Props> = ({ config, onSave, onClose }) => {
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [deployPath, setDeployPath] = useState(config.deployPath || '/api/rest/testsuite/deploy');
  const [organisationApiKey, setOrganisationApiKey] = useState(config.organisationApiKey ?? '');
  const [systemApiKey, setSystemApiKey] = useState(config.systemApiKey ?? '');
  const [communityApiKey, setCommunityApiKey] = useState(config.communityApiKey ?? '');
  const [specificationId, setSpecificationId] = useState(config.specificationId ?? '');
  const [communityId, setCommunityId] = useState(config.communityId ?? '');
  const [organisationId, setOrganisationId] = useState(config.organisationId ?? '');
  const [systemId, setSystemId] = useState(config.systemId ?? '');
  const [actorId, setActorId] = useState(config.actorId ?? '');
  const [testSuiteId, setTestSuiteId] = useState(config.testSuiteId ?? '');
  const [healthStatus, setHealthStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [orgKeyStatus, setOrgKeyStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [systemKeyStatus, setSystemKeyStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [communityKeyStatus, setCommunityKeyStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [specStatus, setSpecStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkingOrgKey, setCheckingOrgKey] = useState(false);
  const [checkingSystemKey, setCheckingSystemKey] = useState(false);
  const [checkingCommunityKey, setCheckingCommunityKey] = useState(false);
  const [checkingSpec, setCheckingSpec] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<{ path: string; status: number }[] | null>(null);

  const handleCheck = async () => {
    setChecking(true);
    setHealthStatus(null);
    const result = await checkITBHealth(baseUrl);
    setHealthStatus(result);
    setChecking(false);
  };

  const handleCheckOrgKey = async () => {
    setCheckingOrgKey(true);
    setOrgKeyStatus(null);
    const result = await checkOrganisationKey(baseUrl, organisationApiKey);
    setOrgKeyStatus(result);
    setCheckingOrgKey(false);
  };

  const handleCheckSystemKey = async () => {
    setCheckingSystemKey(true);
    setSystemKeyStatus(null);
    const result = await checkSystemKey(baseUrl, organisationApiKey, systemApiKey);
    setSystemKeyStatus(result);
    setCheckingSystemKey(false);
  };

  const handleCheckCommunityKey = async () => {
    setCheckingCommunityKey(true);
    setCommunityKeyStatus(null);
    const result = await checkCommunityKey(baseUrl, communityApiKey);
    setCommunityKeyStatus(result);
    setCheckingCommunityKey(false);
  };

  const handleCheckSpec = async () => {
    setCheckingSpec(true);
    setSpecStatus(null);
    const result = await checkSpecification(baseUrl, apiKey, specificationId);
    setSpecStatus(result);
    setCheckingSpec(false);
  };

  const handleDiscover = async () => {
    setDiscovering(true);
    setDiscovered(null);
    const results = await discoverEndpoints(baseUrl);
    setDiscovered(results);
    setDiscovering(false);
  };

  const handleSave = () => {
    onSave({
      baseUrl: baseUrl.trim(),
      deployPath: deployPath.trim() || '/api/rest/testsuite/deploy',
      organisationApiKey: organisationApiKey.trim() || undefined,
      systemApiKey: systemApiKey.trim() || undefined,
      communityApiKey: communityApiKey.trim() || undefined,
      specificationId: specificationId.trim() || undefined,
      communityId: communityId.trim() || undefined,
      organisationId: organisationId.trim() || undefined,
      systemId: systemId.trim() || undefined,
      actorId: actorId.trim() || undefined,
      testSuiteId: testSuiteId.trim() || undefined,
    });
    onClose();
  };

  /** Parse ITB URL and extract numeric IDs */
  const handleParseUrl = () => {
    const input = prompt('Paste an ITB test execution URL:\ne.g. http://localhost:9000/app#/admin/users/community/2/organisation/3/test/2/1/execute?tc=1');
    if (!input) return;
    const m = input.match(/community\/(\d+)\/organisation\/(\d+)\/test\/(\d+)\/(\d+)\/execute\?t[cs]=(\d+)/);
    if (m) {
      setCommunityId(m[1]);
      setOrganisationId(m[2]);
      setSystemId(m[3]);
      setActorId(m[4]);
      setTestSuiteId(m[5]);
    } else {
      alert('Could not parse IDs from that URL. Expected format: .../community/{n}/organisation/{n}/test/{n}/{n}/execute?tc={n}');
    }
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

          {/* Deploy Path */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Deploy API Path
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={deployPath}
                onChange={e => setDeployPath(e.target.value)}
                placeholder="/api/rest/testsuite/deploy"
                className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
              />
              <button
                onClick={handleDiscover}
                disabled={discovering || !baseUrl.trim()}
                className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
                title="Probe common API paths"
              >
                {discovering ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              </button>
            </div>
            <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">
              Full URL: {baseUrl.replace(/\/+$/, '')}{deployPath}
            </p>

            {/* Discovery results */}
            {discovered && discovered.length > 0 && (
              <div className="mt-2 rounded-lg border border-gray-200 dark:border-slate-600 overflow-hidden">
                <div className="px-3 py-1.5 bg-gray-50 dark:bg-slate-700 text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Discovered endpoints (click to use)
                </div>
                {discovered.map(d => (
                  <button
                    key={d.path}
                    onClick={() => { setDeployPath(d.path); setDiscovered(null); }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 dark:hover:bg-slate-700 border-t border-gray-100 dark:border-slate-600 flex items-center justify-between"
                  >
                    <span className="font-mono text-gray-800 dark:text-gray-200">{d.path}</span>
                    <span className={`text-[10px] ${d.status < 400 ? 'text-green-600' : d.status < 500 ? 'text-yellow-600' : 'text-red-500'}`}>
                      {d.status}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {discovered && discovered.length === 0 && (
              <p className="mt-1 text-xs text-yellow-600 dark:text-yellow-400">No endpoints responded.</p>
            )}
          </div>

          {/* Organisation API Key */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Organisation API Key <span className="text-gray-400">(for test execution)</span>
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                value={organisationApiKey}
                onChange={e => { setOrganisationApiKey(e.target.value); setOrgKeyStatus(null); }}
                placeholder="Organisation key from ITB Admin"
                className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={handleCheckOrgKey}
                disabled={checkingOrgKey || !baseUrl.trim() || !organisationApiKey.trim()}
                className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
              >
                {checkingOrgKey ? <Loader2 size={14} className="animate-spin" /> : 'Test'}
              </button>
            </div>
            {orgKeyStatus && (
              <div className={`mt-1.5 flex items-center gap-1 text-xs ${orgKeyStatus.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {orgKeyStatus.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                {orgKeyStatus.message}
              </div>
            )}
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
                placeholder="System key from ITB Admin"
                className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={handleCheckSystemKey}
                disabled={checkingSystemKey || !baseUrl.trim() || !organisationApiKey.trim() || !systemApiKey.trim()}
                className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
                title={!organisationApiKey.trim() ? 'Organisation key required' : ''}
              >
                {checkingSystemKey ? <Loader2 size={14} className="animate-spin" /> : 'Test'}
              </button>
            </div>
            {systemKeyStatus && (
              <div className={`mt-1.5 flex items-center gap-1 text-xs ${systemKeyStatus.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {systemKeyStatus.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                {systemKeyStatus.message}
              </div>
            )}
          </div>

          {/* Community API Key */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Community API Key <span className="text-gray-400">(for deployment)</span>
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                value={communityApiKey}
                onChange={e => { setCommunityApiKey(e.target.value); setCommunityKeyStatus(null); }}
                placeholder="Community key with 'manage test suites' permission"
                className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={handleCheckCommunityKey}
                disabled={checkingCommunityKey || !baseUrl.trim() || !communityApiKey.trim()}
                className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
              >
                {checkingCommunityKey ? <Loader2 size={14} className="animate-spin" /> : 'Test'}
              </button>
            </div>
            {communityKeyStatus && (
              <div className={`mt-1.5 flex items-center gap-1 text-xs ${communityKeyStatus.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {communityKeyStatus.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                {communityKeyStatus.message}
              </div>
            )}
          </div>

          {/* Specification ID */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Specification ID <span className="text-gray-400">(optional)</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={specificationId}
                onChange={e => { setSpecificationId(e.target.value); setSpecStatus(null); }}
                placeholder="Target specification for deployment"
                className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={handleCheckSpec}
                disabled={checkingSpec || !baseUrl.trim() || !specificationId.trim()}
                className="px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
              >
                {checkingSpec ? <Loader2 size={14} className="animate-spin" /> : 'Test'}
              </button>
            </div>
            {specStatus && (
              <div className={`mt-1.5 flex items-center gap-1 text-xs ${specStatus.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {specStatus.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                {specStatus.message}
              </div>
            )}
          </div>

          {/* ITB UI IDs for "Open in ITB" link */}
          <div className="border-t border-gray-200 dark:border-slate-700 pt-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                ITB UI IDs <span className="text-gray-400">(for "Open in ITB" link)</span>
              </label>
              <button
                onClick={handleParseUrl}
                className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline"
              >
                Parse from URL
              </button>
            </div>
            <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-2">
              These numeric IDs are from the ITB UI URL. Paste a URL or enter manually.
            </p>
            <div className="grid grid-cols-5 gap-2">
              {([
                ['Community', communityId, setCommunityId],
                ['Org', organisationId, setOrganisationId],
                ['System', systemId, setSystemId],
                ['Actor', actorId, setActorId],
                ['TestSuite', testSuiteId, setTestSuiteId],
              ] as [string, string, (v: string) => void][]).map(([label, value, setter]) => (
                <div key={label}>
                  <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">{label}</label>
                  <input
                    type="text"
                    value={value}
                    onChange={e => setter(e.target.value)}
                    placeholder="#"
                    className="w-full px-2 py-1.5 text-xs border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center font-mono"
                  />
                </div>
              ))}
            </div>
            {communityId && organisationId && systemId && actorId && testSuiteId && (
              <p className="mt-1.5 text-[10px] text-gray-400 dark:text-gray-500 font-mono truncate">
                .../community/{communityId}/organisation/{organisationId}/test/{systemId}/{actorId}/execute?tc={testSuiteId}
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200 dark:border-slate-700">
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
