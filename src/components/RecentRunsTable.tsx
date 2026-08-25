import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, AlertCircle, ExternalLink, Check, X, Clock, History } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { buildITBSessionUrl } from '../services/itbClient';

interface Run {
  sessionId: string;
  systemKey: string;
  systemName: string;
  specKey: string;
  specName: string;
  actorKey: string;
  actorIdentifier: string;
  actorName: string;
  result: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSec: number | null;
}

interface RunsResponse {
  total: number;
  limit: number;
  offset: number;
  runs: Run[];
}

interface Props {
  /** Server-side filters applied to /api/runs. */
  filter: { system?: string; spec?: string; community?: string; actor?: string };
  /** Bolds the column matching this dimension; the other becomes contextual. */
  emphasise?: 'system' | 'spec' | 'none';
  limit?: number;
  /** DOM id for hash-anchor navigation (e.g. matrix cells link to "#runs"). */
  anchorId?: string;
}

const formatDuration = (s: number | null): string => {
  if (s == null || s < 0) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
};

const formatTime = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
};

export const RecentRunsTable: React.FC<Props> = ({ filter, emphasise = 'none', limit = 20, anchorId }) => {
  const { itbConfig, navigate, selectSpec } = useAppContext();
  const [data, setData] = useState<RunsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resolving, setResolving] = useState<string>('');  // sessionId being resolved
  // Outcome filter chips: which results to show (client-side filter).
  const [outcomeFilter, setOutcomeFilter] = useState<Set<string>>(new Set(['SUCCESS', 'FAILURE']));

  useEffect(() => {
    setLoading(true); setError('');
    const q = new URLSearchParams();
    if (filter.system) q.set('system', filter.system);
    if (filter.spec) q.set('spec', filter.spec);
    if (filter.community) q.set('community', filter.community);
    if (filter.actor) q.set('actor', filter.actor);
    q.set('limit', String(limit));

    fetch(`/api/runs?${q}`)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text().catch(() => '')}`);
        return r.json();
      })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [filter.system, filter.spec, filter.community, filter.actor, limit]);

  const filteredRuns = useMemo(() => {
    if (!data) return [];
    return data.runs.filter(r => outcomeFilter.has(r.result));
  }, [data, outcomeFilter]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    if (!data) return out;
    for (const r of data.runs) out[r.result] = (out[r.result] || 0) + 1;
    return out;
  }, [data]);

  const toggleOutcome = (o: string) => {
    setOutcomeFilter(prev => {
      const next = new Set(prev);
      if (next.has(o)) next.delete(o); else next.add(o);
      return next;
    });
  };

  const openSession = async (run: Run) => {
    setResolving(run.sessionId);
    try {
      const url = await buildITBSessionUrl(itbConfig, {
        systemKey: run.systemKey,
        actorKey: run.actorKey,
        specKey: run.specKey,
        sessionId: run.sessionId,
      });
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      console.warn('[RecentRunsTable] failed to resolve ITB URL:', e);
    } finally {
      setResolving('');
    }
  };

  return (
    <div id={anchorId} className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-200 dark:border-slate-700 flex items-center gap-2 bg-gray-50 dark:bg-slate-800">
        <History size={14} className="text-purple-500" />
        <span className="font-semibold text-sm text-gray-900 dark:text-white">
          Recent runs{data ? ` (${data.total})` : ''}
        </span>
        <div className="flex-1" />
        {/* Outcome chips */}
        {data && data.runs.length > 0 && (
          <div className="flex items-center gap-1">
            {(['SUCCESS', 'FAILURE'] as const).map(o => {
              const active = outcomeFilter.has(o);
              const label = o === 'SUCCESS' ? 'Passed' : 'Failed';
              const Icon = o === 'SUCCESS' ? Check : X;
              const styling = o === 'SUCCESS'
                ? (active ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' : 'border border-gray-200 dark:border-slate-700 text-gray-400 dark:text-slate-500')
                : (active ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300' : 'border border-gray-200 dark:border-slate-700 text-gray-400 dark:text-slate-500');
              return (
                <button key={o} onClick={() => toggleOutcome(o)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] ${styling} ${active ? '' : 'opacity-60 hover:opacity-90'}`}>
                  <Icon size={10} /> {label}
                  <span className="font-mono ml-0.5">{counts[o] || 0}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {loading ? (
        <div className="p-6 flex items-center justify-center text-gray-400 text-sm">
          <Loader2 size={14} className="animate-spin mr-2" /> Loading runs…
        </div>
      ) : error ? (
        <div className="p-4 flex items-start gap-2 text-sm text-red-700 dark:text-red-400">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <span>Failed to load runs: <code className="font-mono text-xs">{error}</code></span>
        </div>
      ) : !data || data.runs.length === 0 ? (
        <div className="p-6 text-center text-sm text-gray-500 dark:text-slate-400">
          No runs yet.
          <div className="text-xs text-gray-400 mt-1">Once a test session completes in ITB it will show up here.</div>
        </div>
      ) : filteredRuns.length === 0 ? (
        <div className="p-6 text-center text-sm text-gray-500 dark:text-slate-400">
          All {data.runs.length} runs are filtered out by the chips above.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/50">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Result</th>
                <th className={`text-left px-3 py-2 font-semibold ${emphasise === 'system' ? 'text-gray-700 dark:text-slate-200' : ''}`}>System</th>
                <th className={`text-left px-3 py-2 font-semibold ${emphasise === 'spec' ? 'text-gray-700 dark:text-slate-200' : ''}`}>Spec</th>
                <th className="text-left px-3 py-2 font-semibold">Actor</th>
                <th className="text-left px-3 py-2 font-semibold">Ended</th>
                <th className="text-left px-3 py-2 font-semibold">Duration</th>
                <th className="text-right px-3 py-2 font-semibold">Session</th>
              </tr>
            </thead>
            <tbody>
              {filteredRuns.map(run => {
                const passed = run.result === 'SUCCESS';
                const sysClickable = !!run.systemKey;
                const specClickable = !!run.specKey;
                return (
                  <tr key={run.sessionId} className="border-b border-gray-100 dark:border-slate-800 hover:bg-gray-50/50 dark:hover:bg-slate-800/30">
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium ${passed
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                        : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'}`}>
                        {passed ? <Check size={10} /> : <X size={10} />}
                        {passed ? 'Passed' : run.result}
                      </span>
                    </td>
                    <td className={`px-3 py-2 ${emphasise === 'system' ? 'font-medium text-gray-900 dark:text-white' : 'text-gray-600 dark:text-slate-400'}`}>
                      {sysClickable ? (
                        <button onClick={() => navigate(`system/${run.systemKey}`)} className="text-left hover:text-blue-600 dark:hover:text-blue-400 truncate max-w-[200px]">
                          {run.systemName}
                        </button>
                      ) : <span>—</span>}
                    </td>
                    <td className={`px-3 py-2 ${emphasise === 'spec' ? 'font-medium text-gray-900 dark:text-white' : 'text-gray-600 dark:text-slate-400'}`}>
                      {specClickable ? (
                        <button onClick={() => { selectSpec(run.specKey, run.specName); navigate(`spec/${run.specKey}`); }} className="text-left hover:text-blue-600 dark:hover:text-blue-400 truncate max-w-[200px]">
                          {run.specName}
                        </button>
                      ) : <span>—</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-500 dark:text-slate-400 text-xs">
                      {run.actorName || run.actorIdentifier || '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-500 dark:text-slate-400 text-xs whitespace-nowrap" title={run.endedAt || ''}>
                      <Clock size={10} className="inline mr-1 opacity-60" />
                      {formatTime(run.endedAt)}
                    </td>
                    <td className="px-3 py-2 text-gray-500 dark:text-slate-400 text-xs whitespace-nowrap font-mono">
                      {formatDuration(run.durationSec)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => openSession(run)} disabled={resolving === run.sessionId}
                        title={`Open session ${run.sessionId.slice(0, 12)}… in ITB`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50">
                        {resolving === run.sessionId ? <Loader2 size={10} className="animate-spin" /> : <ExternalLink size={10} />}
                        Open
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
