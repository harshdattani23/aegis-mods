import './index.css';

import { StrictMode, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { useDashboard, fetchPrecedent } from './hooks/useDashboard';
import type { ActionRequest, PrecedentItem, QueueItem } from '../shared/api';

type Tab = 'queue' | 'watchlist' | 'audit';

export const App = () => {
  const { loading, error, summary, queue, watchlist, refresh, act } = useDashboard();
  const [tab, setTab] = useState<Tab>('queue');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const items = tab === 'watchlist' ? watchlist : queue;
  const selected = useMemo(
    () => items.find((i) => i.target_id === selectedId) ?? items[0] ?? null,
    [items, selectedId]
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      <Header summary={summary} loading={loading} onRefresh={refresh} />
      <CrisisBanner state={summary?.crisis.state ?? 'normal'} since={summary?.crisis.since ?? null} />

      <Tabs
        tab={tab}
        setTab={setTab}
        queueCount={summary?.queue_count ?? 0}
        watchCount={summary?.watchlist_count ?? 0}
        auditCount={summary?.audit_count_24h ?? 0}
      />

      {error && <ErrorBanner message={error} />}

      {tab === 'audit' ? (
        <AuditPlaceholder count={summary?.audit_count_24h ?? 0} />
      ) : (
        <main className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-3 px-4 pb-6">
          <QueueList
            items={items}
            selectedId={selected?.target_id ?? null}
            onSelect={setSelectedId}
            loading={loading}
            emptyText={tab === 'watchlist' ? 'No risky items right now.' : 'Queue is clear.'}
          />
          <DetailPane item={selected} onAct={act} onRefresh={refresh} />
        </main>
      )}
    </div>
  );
};

const Header = ({
  summary,
  loading,
  onRefresh,
}: {
  summary: ReturnType<typeof useDashboard>['summary'];
  loading: boolean;
  onRefresh: () => void;
}) => (
  <header className="sticky top-0 z-30 flex items-center gap-4 px-4 py-3 bg-slate-900/95 backdrop-blur border-b border-slate-800">
    <div className="flex items-center gap-2">
      <div className="w-7 h-7 rounded-md bg-gradient-to-br from-indigo-500 to-fuchsia-500 grid place-items-center font-bold text-sm">
        A
      </div>
      <div>
        <div className="text-sm font-semibold tracking-tight">Aegis</div>
        <div className="text-xs text-slate-400">
          {summary?.subreddit ? `r/${summary.subreddit}` : '—'} · context-aware moderation
        </div>
      </div>
    </div>
    <div className="ml-auto flex items-center gap-3 text-xs text-slate-400">
      {summary && (
        <>
          <Stat label="queue" value={summary.queue_count} />
          <Stat label="watch" value={summary.watchlist_count} />
          <Stat label="24h" value={summary.audit_count_24h} />
          <Stat
            label="$ today"
            value={`$${summary.daily_cost_usd.toFixed(2)}/$${summary.daily_cost_cap_usd.toFixed(0)}`}
          />
        </>
      )}
      <button
        onClick={onRefresh}
        className="px-2 py-1 rounded border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-white transition"
        disabled={loading}
      >
        {loading ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  </header>
);

const Stat = ({ label, value }: { label: string; value: number | string }) => (
  <div className="flex items-baseline gap-1 px-2 py-1 rounded bg-slate-800/60 border border-slate-700">
    <span className="text-slate-100 font-medium">{value}</span>
    <span className="text-slate-500 text-[10px] uppercase tracking-wider">{label}</span>
  </div>
);

const CrisisBanner = ({
  state,
  since,
}: {
  state: 'normal' | 'suspect' | 'active';
  since: number | null;
}) => {
  if (state === 'normal') return null;
  const cls =
    state === 'active'
      ? 'bg-red-950/80 border-red-700 text-red-200'
      : 'bg-amber-950/80 border-amber-700 text-amber-200';
  return (
    <div className={`mx-4 mt-3 px-3 py-2 rounded border text-sm ${cls}`}>
      <span className="font-semibold uppercase tracking-wider">{state}</span> · brigade signal detected
      {since && <span className="ml-2 text-xs opacity-75">since {new Date(since).toLocaleTimeString()}</span>}
    </div>
  );
};

const Tabs = ({
  tab,
  setTab,
  queueCount,
  watchCount,
  auditCount,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  queueCount: number;
  watchCount: number;
  auditCount: number;
}) => (
  <nav className="flex gap-1 px-4 py-3 border-b border-slate-800">
    <TabBtn active={tab === 'queue'} onClick={() => setTab('queue')}>
      Queue <Pill>{queueCount}</Pill>
    </TabBtn>
    <TabBtn active={tab === 'watchlist'} onClick={() => setTab('watchlist')}>
      Watchlist <Pill kind="amber">{watchCount}</Pill>
    </TabBtn>
    <TabBtn active={tab === 'audit'} onClick={() => setTab('audit')}>
      Audit <Pill>{auditCount}</Pill>
    </TabBtn>
  </nav>
);

const TabBtn = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition ${
      active
        ? 'bg-slate-800 text-white border border-slate-700'
        : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60'
    }`}
  >
    {children}
  </button>
);

const Pill = ({
  children,
  kind = 'default',
}: {
  children: ReactNode;
  kind?: 'default' | 'amber';
}) => {
  const cls =
    kind === 'amber'
      ? 'bg-amber-900/60 text-amber-200 border-amber-700'
      : 'bg-slate-700/60 text-slate-200 border-slate-600';
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${cls}`}>{children}</span>
  );
};

const ErrorBanner = ({ message }: { message: string }) => (
  <div className="mx-4 mt-3 px-3 py-2 rounded border border-red-800 bg-red-950/60 text-red-200 text-sm">
    {message}
  </div>
);

const AuditPlaceholder = ({ count }: { count: number }) => (
  <div className="px-4 pt-6 pb-10 text-slate-400 text-sm">
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6">
      <div className="text-slate-200 font-medium mb-1">Audit log</div>
      <p className="mb-3">
        {count} action{count === 1 ? '' : 's'} in the last 24h. Full searchable audit log ships in
        Phase 9 of the build (Day 17). For now, mod actions are recorded server-side and counted in
        the header.
      </p>
      <p className="text-xs text-slate-500">
        Future: every Aegis decision + mod override appears here, queryable by rule, mod, or time
        window. Foundation for the calibration loop.
      </p>
    </div>
  </div>
);

const QueueList = ({
  items,
  selectedId,
  onSelect,
  loading,
  emptyText,
}: {
  items: QueueItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  emptyText: string;
}) => {
  if (loading) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-slate-500 text-sm">
        Loading queue…
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-slate-500 text-sm">
        {emptyText}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 overflow-hidden">
      <ul className="divide-y divide-slate-800 max-h-[calc(100vh-180px)] overflow-y-auto">
        {items.map((it) => (
          <li key={it.target_id}>
            <button
              onClick={() => onSelect(it.target_id)}
              className={`w-full text-left px-3 py-3 hover:bg-slate-800/60 transition ${
                selectedId === it.target_id ? 'bg-slate-800/80' : ''
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <SeverityDots severity={it.severity} />
                <VerdictBadge verdict={it.verdict} />
                <ConfidenceBar confidence={it.confidence} />
                {it.is_demo && (
                  <span className="ml-auto text-[9px] uppercase tracking-wider text-slate-500 border border-slate-700 rounded px-1.5 py-0.5">
                    demo
                  </span>
                )}
              </div>
              <div className="text-sm text-slate-100 line-clamp-1 font-medium">
                {it.title || it.body || '(empty)'}
              </div>
              <div className="text-xs text-slate-500 line-clamp-1 mt-0.5">
                {it.title ? it.body : null}
              </div>
              <div className="text-[11px] text-slate-500 mt-1 flex gap-2">
                <span>u/{it.author_username}</span>
                <span>·</span>
                <span>{relativeTime(it.created_utc)}</span>
                {it.rule_violated && (
                  <>
                    <span>·</span>
                    <span className="text-slate-400">{it.rule_violated}</span>
                  </>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

const VerdictBadge = ({ verdict }: { verdict: QueueItem['verdict'] }) => {
  const map: Record<QueueItem['verdict'], string> = {
    approve: 'bg-emerald-900/70 text-emerald-200 border-emerald-700',
    remove: 'bg-orange-900/70 text-orange-200 border-orange-700',
    ban: 'bg-red-900/70 text-red-200 border-red-700',
    escalate: 'bg-amber-900/70 text-amber-200 border-amber-700',
  };
  return (
    <span
      className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border font-bold ${map[verdict]}`}
    >
      {verdict}
    </span>
  );
};

const SeverityDots = ({ severity }: { severity: number }) => (
  <span className="flex gap-0.5" title={`Severity ${severity}/5`}>
    {[1, 2, 3, 4, 5].map((i) => (
      <span
        key={i}
        className={`w-1.5 h-1.5 rounded-full ${
          i <= severity ? 'bg-rose-500' : 'bg-slate-700'
        }`}
      />
    ))}
  </span>
);

const ConfidenceBar = ({ confidence }: { confidence: number }) => {
  const pct = Math.round(confidence * 100);
  return (
    <span className="text-[10px] text-slate-400 ml-1">
      {pct}%
    </span>
  );
};

const DetailPane = ({
  item,
  onAct,
  onRefresh,
}: {
  item: QueueItem | null;
  onAct: (req: ActionRequest) => Promise<{ ok: boolean; message: string }>;
  onRefresh: () => void;
}) => {
  const [precedent, setPrecedent] = useState<PrecedentItem[]>([]);
  const [loadingPrec, setLoadingPrec] = useState(false);
  const [dmText, setDmText] = useState('');
  const [sendDm, setSendDm] = useState(true);
  const [busy, setBusy] = useState<ActionRequest['action'] | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const targetId = item?.target_id ?? null;
  const draft = item?.removal_message_draft ?? null;

  useEffect(() => {
    setDmText(draft ?? '');
    setSendDm(!!draft);
  }, [draft]);

  useEffect(() => {
    if (!targetId) return;
    setLoadingPrec(true);
    fetchPrecedent(targetId)
      .then(setPrecedent)
      .catch(() => setPrecedent([]))
      .finally(() => setLoadingPrec(false));
  }, [targetId]);

  const doAction = useCallback(
    async (action: ActionRequest['action']) => {
      if (!item) return;
      setBusy(action);
      try {
        const res = await onAct({
          target_id: item.target_id,
          target_kind: item.target_kind,
          action,
          send_dm: sendDm && (action === 'remove' || action === 'ban'),
          dm_message: dmText || null,
        });
        setToast(res.message);
        setTimeout(() => setToast(null), 3000);
      } finally {
        setBusy(null);
      }
    },
    [item, onAct, dmText, sendDm]
  );

  if (!item) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-8 text-slate-500 text-sm grid place-items-center">
        Select an item to see verdict, precedent, and actions.
      </div>
    );
  }

  const conf = Math.round(item.confidence * 100);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-3">
        <VerdictBadge verdict={item.verdict} />
        <span className="text-sm text-slate-400">
          confidence <span className="text-slate-100 font-medium">{conf}%</span>
        </span>
        <span className="text-sm text-slate-400">
          severity <span className="text-slate-100 font-medium">{item.severity}/5</span>
        </span>
        {item.rule_violated && (
          <span className="text-sm text-slate-400">
            · <span className="text-slate-100">{item.rule_violated}</span>
          </span>
        )}
        <span className="ml-auto text-[11px] text-slate-500">
          {item.model} · u/{item.author_username}
        </span>
      </div>

      <div className="p-4 overflow-y-auto max-h-[calc(100vh-220px)]">
        <Section title="Content">
          {item.title && (
            <div className="font-semibold text-slate-100 mb-1">{item.title}</div>
          )}
          <div className="text-sm text-slate-300 whitespace-pre-wrap">{item.body || '(empty)'}</div>
          {item.reports && item.reports.length > 0 && (
            <div className="mt-2 text-xs">
              <span className="text-slate-500">Reports: </span>
              {item.reports.map((r, i) => (
                <span key={i} className="inline-block mr-1 px-1.5 py-0.5 rounded bg-rose-950/50 border border-rose-900 text-rose-200 text-[11px]">
                  {r}
                </span>
              ))}
            </div>
          )}
        </Section>

        <Section title="Reasoning">
          <div className="text-sm text-slate-300 leading-relaxed">{item.reasoning}</div>
        </Section>

        <Section title={`Precedent ${loadingPrec ? '(loading…)' : `(${precedent.length})`}`}>
          {precedent.length === 0 && !loadingPrec ? (
            <div className="text-xs text-slate-500">
              No similar prior items found yet — Memory backfill ships Day 2.
            </div>
          ) : (
            <ul className="space-y-2">
              {precedent.map((p) => (
                <li
                  key={p.key}
                  className="rounded border border-slate-800 bg-slate-950/60 p-2.5"
                >
                  <div className="flex items-center gap-2 text-[11px] mb-1">
                    <OutcomeBadge outcome={p.outcome} />
                    <span className="text-slate-500">
                      similarity {Math.round(p.similarity * 100)}%
                    </span>
                    {p.rule && <span className="text-slate-400">· {p.rule}</span>}
                    <span className="ml-auto text-slate-600">
                      {new Date(p.decided_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="text-xs text-slate-300 italic mb-1">"{p.excerpt}"</div>
                  {p.mod_reason && (
                    <div className="text-[11px] text-slate-500">
                      <span className="text-slate-400">u/{p.mod_username ?? 'mod'}:</span>{' '}
                      {p.mod_reason}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="DM to user (sent on remove or ban)">
          <textarea
            value={dmText}
            onChange={(e) => setDmText(e.target.value)}
            rows={4}
            className="w-full text-sm bg-slate-950 border border-slate-800 rounded p-2 text-slate-200 font-mono leading-relaxed focus:border-indigo-600 focus:outline-none"
            placeholder="No removal message drafted."
          />
          <label className="flex items-center gap-2 mt-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={sendDm}
              onChange={(e) => setSendDm(e.target.checked)}
              className="accent-indigo-500"
            />
            Send this as a private message
          </label>
        </Section>
      </div>

      <div className="border-t border-slate-800 bg-slate-950/60 px-4 py-3 flex items-center gap-2">
        <ActionBtn
          kind="approve"
          busy={busy === 'approve'}
          onClick={() => doAction('approve')}
        >
          Approve
        </ActionBtn>
        <ActionBtn
          kind="remove"
          busy={busy === 'remove'}
          onClick={() => doAction('remove')}
        >
          Remove
        </ActionBtn>
        <ActionBtn kind="ban" busy={busy === 'ban'} onClick={() => doAction('ban')}>
          Remove + Ban
        </ActionBtn>
        <button
          onClick={() => doAction('skip')}
          className="ml-auto text-xs text-slate-500 hover:text-slate-300"
        >
          Skip
        </button>
        <button
          onClick={onRefresh}
          className="text-xs text-slate-500 hover:text-slate-300"
        >
          Refresh
        </button>
      </div>

      {toast && (
        <div className="absolute bottom-4 right-4 px-3 py-2 rounded bg-emerald-900 text-emerald-100 text-sm border border-emerald-700">
          {toast}
        </div>
      )}
    </div>
  );
};

const Section = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <div className="mb-5">
    <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1.5">{title}</div>
    {children}
  </div>
);

const OutcomeBadge = ({ outcome }: { outcome: PrecedentItem['outcome'] }) => {
  const map: Record<PrecedentItem['outcome'], string> = {
    approved: 'bg-emerald-900/70 text-emerald-200 border-emerald-800',
    removed: 'bg-orange-900/70 text-orange-200 border-orange-800',
    banned: 'bg-red-900/70 text-red-200 border-red-800',
  };
  return (
    <span className={`text-[10px] uppercase px-1 py-0.5 rounded border ${map[outcome]}`}>
      {outcome}
    </span>
  );
};

const ActionBtn = ({
  kind,
  busy,
  onClick,
  children,
}: {
  kind: 'approve' | 'remove' | 'ban';
  busy: boolean;
  onClick: () => void;
  children: ReactNode;
}) => {
  const map = {
    approve: 'bg-emerald-700 hover:bg-emerald-600 disabled:bg-emerald-900',
    remove: 'bg-orange-700 hover:bg-orange-600 disabled:bg-orange-900',
    ban: 'bg-red-700 hover:bg-red-600 disabled:bg-red-900',
  } as const;
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`text-sm font-medium text-white px-3 py-1.5 rounded transition ${map[kind]}`}
    >
      {busy ? 'Working…' : children}
    </button>
  );
};

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
