import React, { useEffect, useState } from 'react';
import { FileCheck, TestTube2, Users, Globe, ChevronRight, PackagePlus, Loader2, ExternalLink, PackageCheck, RefreshCw, X, CheckCircle } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { RecentRunsTable } from '../components/RecentRunsTable';
import { Markdown } from '../components/Markdown';

/** First sentence-ish of a long description, for a one-line summary. */
function firstLine(text: string, max = 110): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : max) + '…';
}

export function SpecificationsPage() {
  const { path, navigate, appState, selectedSpecKey, selectSpec } = useAppContext();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [justCreated, setJustCreated] = useState(false);
  const [itbSpecUrl, setITBSpecUrl] = useState<string | null>(null);
  // Orphaned actors are hidden by default — they're clutter, not part of the spec's
  // working surface, but they can't be found or removed if they're never shown.
  const [showOrphans, setShowOrphans] = useState(false);
  const [deletingActor, setDeletingActor] = useState<string>('');
  const [actorError, setActorError] = useState('');

  const deleteOrphanActor = async (specKey: string, actor: any) => {
    if (!confirm(`Delete actor "${actor.identifier}" from this specification?\n\nNo test case references it. This cannot be undone.`)) return;
    setDeletingActor(actor.apiKey);
    setActorError('');
    try {
      const r = await fetch(`/api/specifications/${specKey}/actors/${actor.apiKey}`, { method: 'DELETE' });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${r.status}`);
      }
      const refreshed = await fetch(`/api/specifications/${specKey}/detail`).then(res => res.ok ? res.json() : null);
      if (refreshed) setData(refreshed);
    } catch (e: any) {
      setActorError(`Could not delete ${actor.identifier}: ${e.message}`);
    }
    setDeletingActor('');
  };

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

    // One-shot "just created" handoff from the Import IG flow.
    // ImportIGPage writes sessionStorage['itm:just-created'] = <specKey> on success.
    if (viewLevel === 'spec' && viewKey) {
      const flagged = sessionStorage.getItem('itm:just-created');
      if (flagged === viewKey) {
        setJustCreated(true);
        sessionStorage.removeItem('itm:just-created');
      } else {
        setJustCreated(false);
      }
    } else {
      setJustCreated(false);
    }

    // Scroll-into-runs handoff (set by matrix cell click). Read after data loads
    // so the target element is in the DOM.
    if (viewLevel === 'spec' && sessionStorage.getItem('itm:scroll-to') === 'runs') {
      sessionStorage.removeItem('itm:scroll-to');
      setTimeout(() => {
        document.getElementById('runs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 250);  // give the runs table time to fetch and render
    }

    if (viewLevel === 'domain' && viewKey) {
      fetch(`/api/domains/${viewKey}/specifications`).then(r => r.ok ? r.json() : []).then(setData).catch(() => setData([])).finally(() => setLoading(false));
    } else if (viewLevel === 'spec' && viewKey) {
      fetch(`/api/specifications/${viewKey}/detail`).then(r => r.ok ? r.json() : null).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
      // Resolve the ITB admin URL for this spec (returns { url: null } if unresolvable).
      setITBSpecUrl(null);
      fetch(`/api/itb-spec-url?spec=${encodeURIComponent(viewKey)}`)
        .then(r => r.ok ? r.json() : { url: null })
        .then(d => setITBSpecUrl(d?.url || null))
        .catch(() => setITBSpecUrl(null));
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
        (() => {
          // Reverse-lookup IG provenance for this spec.
          const igEntry = Object.entries(appState.importedIGs || {}).find(
            ([, v]) => Array.isArray(v.spec_keys) && v.spec_keys.includes(viewKey)
          );
          const igName = igEntry?.[0];
          const igInfo = igEntry?.[1];

          // Note: removed the page-level "Open in ITB" button — it always
          // resolved to /app home because we don't yet know ITB's admin URL
          // pattern for a specific specification. Per-Run "Open" links inside
          // the Recent runs card go directly to the right session.

          const startReimport = () => {
            // Hand off context to ImportIGPage so it can preselect URL + target spec.
            if (igInfo?.url) {
              sessionStorage.setItem('itm:reimport', JSON.stringify({
                url: igInfo.url,
                specKey: viewKey,
                specName: data?.fullName || data?.shortName || '',
              }));
            }
            selectSpec(viewKey, data?.fullName || data?.shortName || '');
            navigate('import-ig');
          };

          return <div>
          {justCreated && (
            <div className="mb-4 flex items-start gap-3 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
              <CheckCircle size={18} className="text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 text-sm">
                <div className="font-semibold text-green-800 dark:text-green-300">Specification ready</div>
                <div className="text-green-700 dark:text-green-400 mt-0.5">Imported and deployed. Use the actions below to run a test or update from the IG.</div>
              </div>
              <button onClick={() => setJustCreated(false)} className="text-green-600/70 hover:text-green-800 dark:text-green-500 dark:hover:text-green-300" aria-label="Dismiss">
                <X size={16} />
              </button>
            </div>
          )}

          <div className="flex items-start justify-between mb-4 gap-4">
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">{data?.fullName || data?.shortName || 'Specification'}</h1>
              {data?.description && <Markdown className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">{data.description}</Markdown>}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {itbSpecUrl && (
                <a href={itbSpecUrl} target="_blank" rel="noopener"
                  className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-slate-800"
                  title="Open this specification in ITB admin">
                  <ExternalLink size={14} /> Open in ITB
                </a>
              )}
              <button onClick={() => { selectSpec(viewKey, data?.fullName || data?.shortName || ''); navigate('import-ig'); }}
                className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                <PackagePlus size={14} /> Import tests
              </button>
            </div>
          </div>

          {/* IG provenance */}
          {igEntry && (
            <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 mb-4 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-200 dark:border-slate-700 flex items-center gap-2 bg-gray-50 dark:bg-slate-800">
                <PackageCheck size={14} className="text-blue-500" />
                <span className="font-semibold text-sm text-gray-900 dark:text-white">Imported from Implementation Guide</span>
              </div>
              <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="font-medium text-sm text-gray-900 dark:text-white truncate">{igName}</div>
                  <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
                    <span className="bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">v{igInfo?.version || '—'}</span>
                    {igInfo?.url && <a href={igInfo.url} target="_blank" rel="noopener" className="text-blue-600 hover:underline flex items-center gap-1 truncate max-w-md">
                      <span className="truncate">{igInfo.url}</span>
                      <ExternalLink size={10} className="flex-shrink-0" />
                    </a>}
                  </div>
                </div>
                <button onClick={startReimport}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-400 rounded-lg text-sm hover:bg-blue-50 dark:hover:bg-blue-900/20 flex-shrink-0">
                  <RefreshCw size={13} /> Re-import / Update
                </button>
              </div>
            </div>
          )}

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
                    </div>
                    {/* A suite's description is the whole Gherkin preamble — often a page
                        of prose. Show the first line, keep the rest one click away. */}
                    {ts.description && (
                      <details className="ml-6 mt-1 group">
                        <summary className="text-xs text-gray-500 dark:text-slate-400 cursor-pointer list-none marker:content-[''] truncate max-w-full hover:text-gray-700 dark:hover:text-slate-200">
                          <span className="text-gray-400 dark:text-slate-500 group-open:hidden">{firstLine(ts.description)}</span>
                          <span className="hidden group-open:inline text-blue-600 dark:text-blue-400">Hide description</span>
                        </summary>
                        <p className="text-xs text-gray-500 dark:text-slate-400 mt-1 whitespace-pre-line leading-relaxed max-w-[80ch]">
                          {ts.description}
                        </p>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actors */}
          {(() => {
            const allActors: any[] = data?.actors || [];
            // Three states, and they mean different things to a reader:
            //   tested          — SUT in at least one test case; the only ones a system can be bound to
            //   infrastructure  — used by test cases but never the SUT (a validator, a simulated peer)
            //   orphan          — referenced by nothing at all
            const stateOf = (a: any) => a.orphan ? 'orphan' : (a.sutTestCaseCount ? 'tested' : 'infra');
            const orphans = allActors.filter(a => stateOf(a) === 'orphan');
            const tested = allActors.filter(a => stateOf(a) === 'tested');
            const infra = allActors.filter(a => stateOf(a) === 'infra');
            const order = { tested: 0, infra: 1, orphan: 2 } as Record<string, number>;
            const shown = (showOrphans ? allActors : allActors.filter(a => stateOf(a) !== 'orphan'))
              .slice().sort((a, b) => order[stateOf(a)] - order[stateOf(b)]);
            return (
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden mb-4">
            <div className="px-4 py-2.5 border-b border-gray-200 dark:border-slate-700 flex items-center gap-2 bg-gray-50 dark:bg-slate-800">
              <Users size={14} className="text-blue-500" />
              <span className="font-semibold text-sm text-gray-900 dark:text-white">
                Actors <span className="font-normal text-gray-500 dark:text-slate-400">
                  ({tested.length} tested{infra.length ? ` · ${infra.length} infrastructure` : ''}{orphans.length ? ` · ${orphans.length} orphaned` : ''})
                </span>
              </span>
              <div className="flex-1" />
              {orphans.length > 0 && (
                <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-slate-400 cursor-pointer"
                  title="An orphan is an actor ITB still lists but no test case references. ITB never removes actors on its own — undeploying a suite or renaming an actor leaves the old one behind.">
                  <input type="checkbox" checked={showOrphans} onChange={e => setShowOrphans(e.target.checked)} className="rounded" />
                  Show orphans
                </label>
              )}
            </div>
            {!shown.length ? (
              <div className="p-6 text-center text-sm text-gray-500">
                {allActors.length ? 'All actors in this specification are orphaned — tick "Show orphans".' : 'No actors.'}
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-slate-800">
                {shown.map((a: any) => (
                  <div key={a.apiKey} className={`px-4 py-2 flex items-center gap-2 ${a.orphan ? 'bg-amber-50/60 dark:bg-amber-900/10' : ''}`}>
                    <Users size={12} className={
                      stateOf(a) === 'orphan' ? 'text-amber-500'
                      : stateOf(a) === 'tested' ? 'text-blue-500'
                      : 'text-gray-300 dark:text-slate-600'} />
                    <span className={`text-sm ${stateOf(a) === 'tested' ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-500 dark:text-slate-400'}`}>
                      {a.name}
                    </span>
                    <code className="text-[10px] text-gray-400 bg-gray-100 dark:bg-slate-800 px-1 rounded">{a.identifier}</code>
                    {stateOf(a) === 'tested' && (
                      <span className="text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded-full"
                        title={`System under test in ${a.sutTestCaseCount} of ${a.testCaseCount} test cases — a system can claim conformance to this actor`}>
                        tested · {a.sutTestCaseCount} test case{a.sutTestCaseCount === 1 ? '' : 's'}
                      </span>
                    )}
                    {stateOf(a) === 'infra' && (
                      <span className="text-[10px] bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 px-1.5 py-0.5 rounded-full"
                        title={`Used by ${a.testCaseCount} test case(s) but never the system under test — a validator or a simulated peer. Nothing claims conformance to it.`}>
                        infrastructure
                      </span>
                    )}
                    {a.orphan && (
                      <span className="text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 px-1.5 py-0.5 rounded-full"
                        title="No test case references this actor. Safe to delete unless a conformance statement uses it.">
                        orphan
                      </span>
                    )}
                    {a.statementCount ? (
                      <span className="text-[10px] text-gray-400">{a.statementCount} statement{a.statementCount === 1 ? '' : 's'}</span>
                    ) : null}
                    <div className="flex-1" />
                    {a.orphan && (
                      <button
                        onClick={() => deleteOrphanActor(viewKey, a)}
                        disabled={deletingActor === a.apiKey || !!a.statementCount}
                        title={a.statementCount
                          ? 'Has a conformance statement — deleting would discard it and its test history'
                          : `Delete actor ${a.identifier} from this specification`}
                        className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40 disabled:cursor-not-allowed">
                        {deletingActor === a.apiKey ? <Loader2 size={10} className="animate-spin" /> : <X size={10} />}
                        Delete
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {actorError && (
              <div className="px-4 py-2 text-xs text-red-600 dark:text-red-400 border-t border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
                {actorError}
              </div>
            )}
          </div>
            );
          })()}

          {/* Recent runs (filtered by this spec) */}
          <RecentRunsTable filter={{ spec: viewKey }} emphasise="system" anchorId="runs" />
        </div>;
        })()
      ) : null}
    </div>
  );
}
