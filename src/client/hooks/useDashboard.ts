import { useCallback, useEffect, useState } from 'react';
import type {
  ActionRequest,
  ActionResponse,
  DashboardInitResponse,
  DashboardSummary,
  PrecedentItem,
  PrecedentResponse,
  QueueItem,
} from '../../shared/api';

type DashboardState = {
  loading: boolean;
  error: string | null;
  summary: DashboardSummary | null;
  queue: QueueItem[];
  watchlist: QueueItem[];
};

const initialState: DashboardState = {
  loading: true,
  error: null,
  summary: null,
  queue: [],
  watchlist: [],
};

export function useDashboard() {
  const [state, setState] = useState<DashboardState>(initialState);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/init');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as DashboardInitResponse;
      if (data.type !== 'dashboard_init') throw new Error('Unexpected response');
      setState({
        loading: false,
        error: null,
        summary: data.summary,
        queue: data.queue,
        watchlist: data.watchlist,
      });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = useCallback(
    async (req: ActionRequest): Promise<ActionResponse> => {
      const res = await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      const data = (await res.json()) as ActionResponse;
      if (data.ok) {
        setState((prev) => ({
          ...prev,
          queue: prev.queue.filter((q) => q.target_id !== req.target_id),
          watchlist: prev.watchlist.filter((q) => q.target_id !== req.target_id),
          summary: prev.summary
            ? {
                ...prev.summary,
                queue_count: Math.max(0, prev.summary.queue_count - 1),
                audit_count_24h: prev.summary.audit_count_24h + 1,
              }
            : null,
        }));
      }
      return data;
    },
    []
  );

  return { ...state, refresh, act } as const;
}

export async function fetchPrecedent(targetId: string): Promise<PrecedentItem[]> {
  const res = await fetch(`/api/precedent/${encodeURIComponent(targetId)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as PrecedentResponse;
  return data.items;
}
