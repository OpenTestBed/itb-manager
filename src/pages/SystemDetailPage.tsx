import React, { useEffect, useMemo, useState } from 'react';
import {
  Laptop, Building2, Users, FileCheck, Globe, Play, Loader2,
  AlertCircle, ChevronRight, Plus,
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { buildITBSessionUrl } from '../services/itbClient';
import { RecentRunsTable } from '../components/RecentRunsTable';
import { Markdown } from '../components/Markdown';

interface ConformanceRow {
  specKey: string;
  specShortName: string;
  specFullName: string;
  domainKey: string;
  domainShortName: string;
  domainFullName?: string;
  actorKey: string;
  actorIdentifier: string;
  actorName: string;
}
interface SystemDetail {
  apiKey: string;
  shortName: string;
  fullName: string;
  description?: string;
  organisationKey?: string;
  organisationName?: string;
  communityKey?: string;
  communityName?: string;
  conformance: ConformanceRow[];
}

export function SystemDetailPage() {
  const { path, navigate, itbConfig, selectSpec } = useAppContext();
  const apiKey = path.replace(/^system\//, '');

  const [data, setData] = useState<SystemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true); setError(''); setData(null);
    fetch(`/api/systems/${encodeURIComponent(apiKey)}/detail`)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text().catch(() => '')}`);
        return r.json();
      })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [apiKey]);

  // Group conformance rows by spec.
  const grouped = useMemo(() => {
    if (!data?.conformance) return [];
    const map = new Map<string, { spec: ConformanceRow; actors: ConformanceRow[] }>();
    for (const r of data.conformance) {
      const e = map.get(r.specKey);
      if (e) e.actors.push(r);
      else map.set(r.specKey, { spec: r, actors: [r] });
    }
    return [...map.values()];
  }, [data]);

  const [resolvingRun, setResolvingRun] = useState<string>('');  // actorKey being resolved

  const goToSpec = (row: ConformanceRow) => {
    selectSpec(row.specKey, row.specFullName || row.specShortName);
    navigate(`spec/${row.specKey}`);
  };

  const runInITB = async (row: ConformanceRow) => {
    if (!data) return;
    setResolvingRun(row.actorKey);
    try {
      const url = await buildITBSessionUrl(itbConfig, {
        systemKey: data.apiKey,
        actorKey: row.actorKey,
        specKey: row.specKey,
      });
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      console.warn('[SystemDetail] failed to resolve run URL:', e);
    } finally {
      setResolvingRun('');
    }
  };

  // ── Render ──
  if (loading) {
    return <div className="p-6 max-w-4xl mx-auto flex items-center justify-center py-12 text-gray-400">
      <Loader2 size={20} className="animate-spin mr-2" /> Loading system…
    </div>;
  }
  if (error || !data) {
    return <div className="p-6 max-w-4xl mx-auto">
      <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-start gap-3">
        <AlertCircle size={18} className="text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 text-sm text-red-800 dark:text-red-300">
          <div className="font-semibold">Could not load system</div>
          <div className="mt-1">{error || 'No data'}</div>
        </div>
      </div>
    </div>;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-sm mb-3 flex-wrap">
        <button onClick={() => navigate('organizations')} className="text-blue-600 hover:underline dark:text-blue-400">Organisations</button>
        {data.organisationName && <>
          <ChevronRight size={12} className="text-gray-400" />
          <span className="text-gray-600 dark:text-slate-400">{data.organisationName}</span>
        </>}
        <ChevronRight size={12} className="text-gray-400" />
        <span className="text-gray-900 dark:text-white font-medium">{data.fullName || data.shortName}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-5 gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Laptop size={20} className="text-blue-500 flex-shrink-0" />
            <h1 className="text-xl font-bold text-gray-900 dark:text-white truncate">{data.fullName || data.shortName}</h1>
          </div>
          {data.description && <Markdown className="text-sm text-gray-500 dark:text-slate-400">{data.description}</Markdown>}
          <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500 dark:text-slate-500 flex-wrap">
            {data.communityName && <span className="flex items-center gap-1"><Users size={11} /> {data.communityName}</span>}
            {data.organisationName && <span className="flex items-center gap-1"><Building2 size={11} /> {data.organisationName}</span>}
            <code className="bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 rounded font-mono">{data.apiKey.slice(0, 12)}…</code>
          </div>
        </div>
        {/* The page-level "Open in ITB" button used to live here. Removed because
            we don't yet know ITB's admin URL pattern for a specific system —
            the previous link always landed on /app home. The per-conformance
            "Run in ITB" button below uses the execute URL pattern, and the
            Recent runs section has per-session "Open" links. */}
      </div>

      {/* Conformance — what specs this system claims, grouped per spec */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 mb-4 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-200 dark:border-slate-700 flex items-center gap-2 bg-gray-50 dark:bg-slate-800">
          <FileCheck size={14} className="text-emerald-500" />
          <span className="font-semibold text-sm text-gray-900 dark:text-white">Conformance ({grouped.length} spec{grouped.length === 1 ? '' : 's'})</span>
          <div className="flex-1" />
          <button disabled
            title="Coming soon — declare conformance to a new spec"
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-dashed border-gray-300 dark:border-slate-600 rounded text-gray-400 dark:text-slate-500 cursor-not-allowed">
            <Plus size={11} /> Add conformance
          </button>
        </div>
        {grouped.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500 dark:text-slate-400">
            This system isn't claiming conformance to any specification yet.
            <div className="text-xs text-gray-400 mt-1">Conformance is recorded automatically when a test suite is deployed against this system.</div>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-800">
            {grouped.map(({ spec, actors }) => (
              <div key={spec.specKey} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <button onClick={() => goToSpec(spec)} className="font-medium text-sm text-blue-700 dark:text-blue-400 hover:underline text-left">
                      {spec.specFullName || spec.specShortName}
                    </button>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500 dark:text-slate-400 flex-wrap">
                      <span className="flex items-center gap-1">
                        <Globe size={10} /> {spec.domainFullName || spec.domainShortName}
                      </span>
                      <span>·</span>
                      <span>
                        Actor{actors.length > 1 ? 's' : ''}: {actors.map(a => a.actorName || a.actorIdentifier).join(', ')}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => runInITB(spec)}
                      disabled={resolvingRun === spec.actorKey}
                      title={`Open ITB execution UI for ${data.shortName} × ${spec.actorName || spec.actorIdentifier}`}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50">
                      {resolvingRun === spec.actorKey
                        ? <Loader2 size={11} className="animate-spin" />
                        : <Play size={11} />}
                      Run in ITB
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent runs (filtered by this system) */}
      <RecentRunsTable filter={{ system: data.apiKey }} emphasise="spec" anchorId="runs" />
    </div>
  );
}
