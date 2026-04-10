import React, { useState, useRef } from 'react';
import { PackagePlus, Link, Upload, ChevronDown, ChevronRight, Check, AlertCircle, Loader2, Play, ExternalLink, Code, FileCheck } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { resolveITBIds, getITBAppUrl, ensureConformance, ensureSystem, getSpecificationActors, deployToITB } from '../services/itbClient';

interface TestPlan { id: string; name: string; description: string; scope: any[]; parameters: any[]; suites: any[]; raw_json: any; }
interface Discovery { ig_name: string; ig_version: string; fhir_version: string; dependencies: string[]; test_plans: TestPlan[]; profiles: any[]; }

type Step = 'source' | 'select' | 'compile' | 'deploy' | 'done';

export function ImportIGPage() {
  const { appState, itbConfig, selectedSpecKey, selectedSpecName, selectSpec } = useAppContext();
  const [step, setStep] = useState<Step>('source');

  // Source
  const [tab, setTab] = useState<'url'|'file'>('url');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File|null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState('');
  const [discovery, setDiscovery] = useState<Discovery|null>(null);

  // Select
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Compile
  const [compiling, setCompiling] = useState(false);
  const [compiled, setCompiled] = useState<Record<string, { zip_base64: string; zip_size: number }>>({});
  const [compileErrors, setCompileErrors] = useState<Record<string, string>>({});

  // Deploy
  const [deployTarget, setDeployTarget] = useState<'existing'|'new'>('existing');
  const [newSpecName, setNewSpecName] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [deployed, setDeployed] = useState<Record<string, boolean>>({});
  const [deployErrors, setDeployErrors] = useState<Record<string, string>>({});
  const [executionUrls, setExecutionUrls] = useState<Record<string, string>>({});

  // Gherkin preview
  const [previewContent, setPreviewContent] = useState('');

  const discover = async () => {
    setDiscovering(true); setDiscoverError('');
    try {
      let r: Response;
      if (tab === 'file' && file) {
        const form = new FormData(); form.append('file', file);
        r = await fetch('/api/ig/upload/discover', { method: 'POST', body: form });
      } else {
        r = await fetch('/api/ig/discover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
      }
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.detail || `HTTP ${r.status}`); }
      const d: Discovery = await r.json();
      setDiscovery(d);
      setSelected(new Set(d.test_plans.map(tp => tp.id)));
      setStep('select');
    } catch (e: any) { setDiscoverError(e.message); }
    setDiscovering(false);
  };

  const compileSelected = async () => {
    if (!discovery) return;
    setCompiling(true);
    const newCompiled = { ...compiled };
    const newErrors = { ...compileErrors };
    for (const id of selected) {
      const tp = discovery.test_plans.find((t: any) => t.id === id);
      if (!tp) { newErrors[id] = 'TestPlan not found'; continue; }

      // Check if any suite has a pre-built ITB ZIP
      const itbZipSuite = tp.suites?.find((s: any) => s.type === 'itb-zip' && s.itb_zip_base64);

      if (itbZipSuite) {
        // Pre-built ZIP — no compilation needed, use it directly
        const zipBytes = atob(itbZipSuite.itb_zip_base64);
        newCompiled[id] = { zip_base64: itbZipSuite.itb_zip_base64, zip_size: zipBytes.length };
        console.log(`[Compile] ${id}: ${zipBytes.length} bytes (pre-built ITB ZIP from ${itbZipSuite.itb_zip_file})`);
      } else {
        // Gherkin-based — compile via the compiler service
        if (!tp.raw_json || Object.keys(tp.raw_json).length === 0) { newErrors[id] = 'No raw TestPlan JSON'; continue; }
        try {
          const r = await fetch('/api/compile/testplan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tp.raw_json) });
          if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`); }
          const blob = await r.blob();
          const buf = await blob.arrayBuffer();
          const arr = new Uint8Array(buf);
          let binStr = '';
          for (let i = 0; i < arr.length; i++) binStr += String.fromCharCode(arr[i]);
          const b64 = btoa(binStr);
          newCompiled[id] = { zip_base64: b64, zip_size: buf.byteLength };
          console.log(`[Compile] ${id}: ${buf.byteLength} bytes compiled from Gherkin`);
        } catch (e: any) { newErrors[id] = e.message; }
      }
    }
    setCompiled(newCompiled); setCompileErrors(newErrors);
    setCompiling(false);
    if (Object.keys(newCompiled).length > 0) setStep('deploy');
  };

  const deployCompiled = async () => {
    if (!discovery) return;
    setDeploying(true);
    const newDeployed = { ...deployed };
    const newErrors = { ...deployErrors };
    const newUrls = { ...executionUrls };

    for (const id of Object.keys(compiled)) {
      const tp = discovery.test_plans.find(t => t.id === id);
      if (!tp) continue;
      try {
        const deployKey = itbConfig.communityApiKey || itbConfig.apiKey || '';
        const baseUrl = itbConfig.baseUrl.replace(/\/+$/, '');

        if (!deployKey) throw new Error('No community API key configured. Open ITB Settings.');
        if (!baseUrl) throw new Error('No ITB base URL configured. Open ITB Settings.');

        let specId = '';

        if (deployTarget === 'existing') {
          // Use spec selected in the ITB Explorer sidebar (or fallback to ITB Settings)
          specId = selectedSpecKey || itbConfig.specificationId || '';
          if (!specId) throw new Error('No specification selected. Click a specification in the ITB Explorer panel on the right.');
        } else {
          // Create a new specification
          const specName = newSpecName || tp?.scope?.[0]?.description || tp?.name || id;
          const domainKey = appState.domainKey;
          if (!domainKey) throw new Error('No domain selected. Go to Domains page first.');
          const proxyCreate = `/itb-proxy/${encodeURIComponent(baseUrl)}/api/rest/specification`;
          const createResp = await fetch(proxyCreate, {
            method: 'PUT',
            headers: { 'ITB_API_KEY': deployKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              shortName: specName, fullName: specName,
              description: `Created from IG import: ${discovery?.ig_name || ''}`,
              domain: domainKey, hidden: false, displayOrder: 0,
            }),
          });
          if (!createResp.ok) {
            const errText = await createResp.text();
            throw new Error(`Failed to create specification (${createResp.status}): ${errText}`);
          }
          const specData = await createResp.json();
          specId = specData.apiKey || '';
          // Auto-select the newly created spec
          selectSpec(specId, specName);
          console.log(`[Deploy] Created new specification: ${specName} -> ${specId}`);
        }

        // Decode the ZIP from base64
        const b64 = compiled[id].zip_base64;
        const binStr = atob(b64);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
        const zipFile = new File([bytes], `${id}.zip`, { type: 'application/zip' });

        console.log(`[Deploy] Deploying ${id}: spec=${specId}, key=${deployKey.substring(0,8)}..., zip=${bytes.length} bytes`);

        const formData = new FormData();
        formData.append('updateSpecification', 'true');
        formData.append('specification', specId);
        formData.append('testSuite', zipFile);

        const proxyPath = `/itb-proxy/${encodeURIComponent(baseUrl)}${itbConfig.deployPath}`;
        const deployResp = await fetch(proxyPath, {
          method: 'POST',
          headers: { 'ITB_API_KEY': deployKey },
          body: formData,
        });

        if (!deployResp.ok) {
          const errText = await deployResp.text();
          throw new Error(`Deploy failed (${deployResp.status}): ${errText}`);
        }

        const deployResult = await deployResp.json();
        newDeployed[id] = true;

        // Exact same post-deploy flow as test-workbench:
        // 1. Extract SUT actor ID from the deployed XML/response
        const identifiers = deployResult.identifiers || {};
        const sutActorId = (identifiers.specifications || [])
          .flatMap((s: any) => (s.actors || []))
          .find((a: any) => a.name === 'User' || a.name === 'SUT')?.identifier || '';

        // 2. resolveITBIds FIRST (this also auto-creates conformance in the middleware)
        let resolvedIds: any = {};
        try {
          resolvedIds = await resolveITBIds(itbConfig, deployResult, sutActorId);
          console.log('[Deploy] resolvedIds:', resolvedIds);
        } catch (e) { console.warn('[Deploy] resolveITBIds failed:', e); }

        // 3. Then ensureSystem + ensureConformance (explicit, like test-workbench)
        try {
          const actors = await getSpecificationActors(itbConfig);
          const sutActorInfo = actors.find((a: any) => a.actorId === sutActorId)
            || actors.find((a: any) => a.default)
            || actors[0];
          if (sutActorInfo?.apiKey) {
            const systemApiKey = await ensureSystem(itbConfig);
            console.log('[Deploy] ensureSystem:', systemApiKey);
            if (systemApiKey) {
              await ensureConformance(itbConfig, systemApiKey, sutActorInfo.apiKey);
              console.log('[Deploy] ensureConformance done');
            }
          }
        } catch (e) { console.warn('[Deploy] ensure flow failed:', e); }

        // 4. Build execution URL
        const url = getITBAppUrl(itbConfig, resolvedIds || undefined);
        console.log('[Deploy] ITB URL:', url);
        if (url && !url.endsWith('/app')) newUrls[id] = url;

      } catch (e: any) { newErrors[id] = e.message; }
    }
    setDeployed(newDeployed); setDeployErrors(newErrors); setExecutionUrls(newUrls);
    setDeploying(false);
    if (Object.values(newDeployed).some(Boolean)) setStep('done');
  };

  const reset = () => {
    setStep('source'); setDiscovery(null); setSelected(new Set());
    setCompiled({}); setCompileErrors({}); setDeployed({}); setDeployErrors({}); setExecutionUrls({});
    setFile(null); setUrl(''); setDiscoverError('');
  };

  const shortRef = (ref: string) => ref.split('/').pop() || ref;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Import Implementation Guide</h1>
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">Load a Testing IG, select test plans, compile, and deploy to ITB.</p>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6 text-xs">
        {(['source','select','compile','deploy','done'] as Step[]).map((s, i) => (
          <React.Fragment key={s}>
            {i > 0 && <div className="w-6 h-px bg-gray-300 dark:bg-slate-600" />}
            <span className={`px-2 py-1 rounded-full ${step === s ? 'bg-blue-600 text-white' : s < step ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400'}`}>
              {['1. Source','2. Select','3. Compile','4. Deploy','Done'][i]}
            </span>
          </React.Fragment>
        ))}
      </div>

      {/* Step 1: Source */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 mb-4">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700 flex items-center gap-2">
          <PackagePlus size={16} className="text-blue-600" />
          <span className="font-semibold text-sm text-gray-900 dark:text-white">1. Provide IG Source</span>
        </div>
        {step === 'source' ? (
          <div className="p-4">
            <div className="flex gap-2 mb-4">
              <button onClick={() => setTab('url')} className={`flex items-center gap-1 px-3 py-1.5 rounded text-sm ${tab === 'url' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800'}`}>
                <Link size={14} /> From URL
              </button>
              <button onClick={() => setTab('file')} className={`flex items-center gap-1 px-3 py-1.5 rounded text-sm ${tab === 'file' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800'}`}>
                <Upload size={14} /> Upload .tgz
              </button>
            </div>
            {tab === 'url' ? (
              <div className="flex gap-2">
                <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.org/ig/ or package#version"
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <button onClick={discover} disabled={!url || discovering} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                  {discovering && <Loader2 size={14} className="animate-spin" />} Fetch
                </button>
              </div>
            ) : (
              <div className="flex gap-2 items-center">
                <input ref={fileRef} type="file" accept=".tgz,.tar.gz" onChange={e => setFile(e.target.files?.[0] || null)} className="flex-1 text-sm text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700 dark:file:bg-blue-900/30 dark:file:text-blue-400 file:text-sm file:font-medium" />
                <button onClick={discover} disabled={!file || discovering} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                  {discovering && <Loader2 size={14} className="animate-spin" />} Analyze
                </button>
              </div>
            )}
            {discoverError && <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">{discoverError}</div>}
          </div>
        ) : (
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-gray-700 dark:text-gray-300"><strong>{discovery?.ig_name}</strong> v{discovery?.ig_version}</span>
            <button onClick={reset} className="text-xs text-blue-600 hover:underline">Change source</button>
          </div>
        )}
      </div>

      {/* Step 2: Select */}
      {discovery && step !== 'source' && (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 mb-4">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
            <span className="font-semibold text-sm text-gray-900 dark:text-white">2. Select Test Plans ({selected.size}/{discovery.test_plans.length})</span>
            <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
              <input type="checkbox" checked={selected.size === discovery.test_plans.length}
                onChange={e => setSelected(e.target.checked ? new Set(discovery.test_plans.map(t => t.id)) : new Set())}
                className="rounded" /> Select all
            </label>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-slate-800">
            {discovery.test_plans.map(tp => (
              <div key={tp.id} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <input type="checkbox" checked={selected.has(tp.id)} onChange={e => {
                    const s = new Set(selected); e.target.checked ? s.add(tp.id) : s.delete(tp.id); setSelected(s);
                  }} className="mt-1 rounded" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-gray-900 dark:text-white">{tp.name}</span>
                      {(tp as any).type === 'itb-zip' && <span className="text-[10px] bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 px-1.5 py-0.5 rounded-full">Pre-built ZIP</span>}
                      {(tp as any).type === 'gherkin' && <span className="text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full">Gherkin</span>}
                      {compiled[tp.id] && <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-1.5 py-0.5 rounded-full flex items-center gap-1"><Check size={10}/> Ready</span>}
                      {deployed[tp.id] && <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded-full">Deployed</span>}
                    </div>
                    {tp.description && <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{tp.description}</div>}
                    <div className="flex flex-wrap gap-1 mt-1">
                      {tp.scope.map((s: any) => (
                        <span key={s.reference} className="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded" title={s.reference}>{shortRef(s.reference)}</span>
                      ))}
                      {tp.suites.map((s: any) => (
                        <span key={s.name} className="text-xs bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 px-1.5 py-0.5 rounded">
                          {s.name} ({s.tests?.length || 0} tests)
                          {s.gherkin_content && <button onClick={() => setPreviewContent(s.gherkin_content)} className="ml-1 text-blue-500 hover:text-blue-700"><Code size={10} /></button>}
                        </span>
                      ))}
                    </div>
                    {compileErrors[tp.id] && <div className="text-xs text-red-600 mt-1"><AlertCircle size={10} className="inline mr-1" />{compileErrors[tp.id]}</div>}
                    {deployErrors[tp.id] && <div className="text-xs text-red-600 mt-1"><AlertCircle size={10} className="inline mr-1" />{deployErrors[tp.id]}</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {step === 'select' && (
            <div className="px-4 py-3 border-t border-gray-200 dark:border-slate-700 flex justify-end">
              <button onClick={compileSelected} disabled={!selected.size || compiling} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                {compiling && <Loader2 size={14} className="animate-spin" />} Prepare for ITB
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 3+4: Deploy */}
      {Object.keys(compiled).length > 0 && step !== 'source' && step !== 'select' && (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 mb-4">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700">
            <span className="font-semibold text-sm text-gray-900 dark:text-white">3. Deploy to ITB</span>
          </div>
          <div className="px-4 py-3 space-y-4">
            <p className="text-sm text-gray-500 dark:text-slate-400">{Object.keys(compiled).length} test suite(s) compiled. Choose where to deploy:</p>

            {/* Target selection */}
            <div className="space-y-2">
              <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-slate-800/50"
                style={{ borderColor: deployTarget === 'existing' ? '#3b82f6' : undefined }}>
                <input type="radio" name="deployTarget" value="existing" checked={deployTarget === 'existing'}
                  onChange={() => setDeployTarget('existing')} className="mt-0.5" />
                <div>
                  <div className="font-medium text-sm text-gray-900 dark:text-white">Add to existing specification</div>
                  {selectedSpecName ? (
                    <div className="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1 mt-0.5">
                      <FileCheck size={11} /> {selectedSpecName}
                      <span className="text-gray-400">({selectedSpecKey.substring(0,8)}...)</span>
                    </div>
                  ) : (
                    <div className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                      Select a specification in the ITB Explorer panel (right sidebar)
                    </div>
                  )}
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-slate-800/50"
                style={{ borderColor: deployTarget === 'new' ? '#3b82f6' : undefined }}>
                <input type="radio" name="deployTarget" value="new" checked={deployTarget === 'new'}
                  onChange={() => setDeployTarget('new')} className="mt-0.5" />
                <div className="flex-1">
                  <div className="font-medium text-sm text-gray-900 dark:text-white">Create new specification</div>
                  <div className="text-xs text-gray-500 dark:text-slate-400 mb-2">
                    Creates a new specification in the active domain
                    {appState.domainName && <span className="ml-1">({appState.domainName})</span>}
                  </div>
                  {deployTarget === 'new' && (
                    <input value={newSpecName} onChange={e => setNewSpecName(e.target.value)}
                      placeholder="Specification name (e.g. Belgian Vaccination)"
                      className="w-full px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white" />
                  )}
                </div>
              </label>
            </div>

            {step === 'deploy' && (
              <button onClick={deployCompiled}
                disabled={deploying || (deployTarget === 'existing' && !selectedSpecKey && !itbConfig.specificationId) || (deployTarget === 'new' && !newSpecName.trim() && !discovery?.test_plans?.[0]?.name)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                {deploying && <Loader2 size={14} className="animate-spin" />} Upload to ITB
              </button>
            )}
          </div>
        </div>
      )}

      {/* Done */}
      {step === 'done' && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
          <div className="flex items-center gap-3 mb-3">
            <Check size={24} className="text-green-600" />
            <div>
              <div className="font-bold text-green-800 dark:text-green-400">Deployment Complete</div>
              <div className="text-sm text-green-700 dark:text-green-500">{Object.keys(deployed).length} test suite(s) deployed.</div>
            </div>
          </div>
          <div className="space-y-2">
            {Object.keys(deployed).map(id => {
              const tp = discovery?.test_plans.find(t => t.id === id);
              const execUrl = executionUrls[id];
              return (
                <div key={id} className="flex items-center justify-between bg-white dark:bg-slate-900 rounded px-3 py-2 border border-green-100 dark:border-green-900">
                  <span className="text-sm text-gray-900 dark:text-white">{tp?.name || id}</span>
                  {execUrl ? (
                    <a href={execUrl} target="_blank" rel="noopener" className="flex items-center gap-1 px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">
                      <Play size={12} /> Run in ITB
                    </a>
                  ) : (
                    <a href={itbConfig.baseUrl} target="_blank" rel="noopener" className="flex items-center gap-1 px-3 py-1 border border-gray-300 dark:border-slate-600 rounded text-xs text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800">
                      <ExternalLink size={12} /> Open ITB
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Gherkin preview modal */}
      {previewContent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setPreviewContent('')}>
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
              <span className="font-semibold text-sm text-gray-900 dark:text-white">Gherkin Script</span>
              <button onClick={() => setPreviewContent('')} className="text-gray-400 hover:text-gray-600">&times;</button>
            </div>
            <pre className="p-4 overflow-auto flex-1 text-xs text-gray-800 dark:text-gray-200 font-mono whitespace-pre-wrap">{previewContent}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
