import './index.css';

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { context, requestExpandedMode } from '@devvit/web/client';
import type { DashboardInitResponse } from '../shared/api';

type SplashState = {
  loading: boolean;
  queueCount: number;
  watchCount: number;
  highSeverityCount: number;
  crisis: 'normal' | 'suspect' | 'active';
  subreddit: string;
};

export const Splash = () => {
  const [state, setState] = useState<SplashState>({
    loading: true,
    queueCount: 0,
    watchCount: 0,
    highSeverityCount: 0,
    crisis: 'normal',
    subreddit: '',
  });

  useEffect(() => {
    let mounted = true;
    fetch('/api/dashboard/init')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: DashboardInitResponse) => {
        if (!mounted) return;
        const high = d.queue.filter((q) => q.severity >= 4).length;
        setState({
          loading: false,
          queueCount: d.summary.queue_count,
          watchCount: d.summary.watchlist_count,
          highSeverityCount: high,
          crisis: d.summary.crisis.state,
          subreddit: d.summary.subreddit,
        });
      })
      .catch(() => {
        if (mounted) setState((s) => ({ ...s, loading: false }));
      });
    return () => {
      mounted = false;
    };
  }, []);

  const crisisCls =
    state.crisis === 'active'
      ? 'border-red-700 bg-red-950/60'
      : state.crisis === 'suspect'
        ? 'border-amber-700 bg-amber-950/60'
        : 'border-slate-800 bg-slate-900/80';

  return (
    <div
      className={`min-h-screen flex flex-col justify-between p-5 bg-slate-950 text-slate-100 border ${crisisCls}`}
    >
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-indigo-500 to-fuchsia-500 grid place-items-center font-bold text-sm">
            A
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight">Aegis</div>
            <div className="text-[11px] text-slate-400">
              context-aware moderation · {state.subreddit ? `r/${state.subreddit}` : '—'}
            </div>
          </div>
        </div>

        {state.loading ? (
          <div className="text-sm text-slate-400">Loading queue…</div>
        ) : (
          <div className="space-y-1.5 mb-2">
            <Line label="Queue" value={state.queueCount} accent="indigo" />
            <Line
              label="High severity"
              value={state.highSeverityCount}
              accent={state.highSeverityCount > 0 ? 'rose' : 'slate'}
            />
            <Line label="Watchlist" value={state.watchCount} accent="amber" />
            {state.crisis !== 'normal' && (
              <div className="mt-2 text-xs uppercase tracking-wider text-red-300 font-bold">
                ⚠ Crisis: {state.crisis}
              </div>
            )}
          </div>
        )}
      </div>

      <button
        onClick={(e) => requestExpandedMode(e.nativeEvent, 'dashboard')}
        className="w-full py-2.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition"
      >
        Open Aegis Dashboard
      </button>
    </div>
  );
};

const Line = ({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: 'indigo' | 'rose' | 'amber' | 'slate';
}) => {
  const map = {
    indigo: 'text-indigo-300',
    rose: 'text-rose-300',
    amber: 'text-amber-300',
    slate: 'text-slate-400',
  } as const;
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-xs text-slate-400">{label}</span>
      <span className={`text-lg font-semibold tabular-nums ${map[accent]}`}>{value}</span>
    </div>
  );
};

// Suppress unused-import warning — context is exported by @devvit/web/client and may be
// useful in future revisions of the splash UI (e.g. showing username inline).
void context;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
