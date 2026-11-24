import { useMemo, useState } from 'react';
import { useData, useQuery } from '../app/DataContext';
import { SERVICES, serviceLabel } from '../data/services';
import type { KnowledgeGap } from '../data/types';
import { LangBadge } from '../ui/Badges';
import { Button, Empty, Field, Modal, Tabs, inputCls, useAction } from '../ui/controls';
import { fmtAge, fmtDateTime } from '../ui/format';
import type { WidgetDef } from './types';

function AnswerGap({ gap, onClose }: { gap: KnowledgeGap; onClose: () => void }) {
  const { source } = useData();
  const { run, busy, banner } = useAction();
  const [en, setEn] = useState(gap.answer_en ?? '');
  const [ar, setAr] = useState(gap.answer_ar ?? '');
  const [service, setService] = useState(gap.service ?? 'general');
  const save = async () => {
    const ok = await run(() => source.answerGap(gap.id, { answer_en: en.trim(), answer_ar: ar.trim() || null, service }));
    if (ok) onClose();
  };
  return (
    <Modal
      title="Teach HALA the answer"
      subtitle={
        <span className="block border-l-2 border-gold-300 pl-2.5 text-base italic text-ink" dir="auto">
          “{gap.question}”
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || !en.trim()} onClick={save}>
            Save answer
          </Button>
        </>
      }
    >
      {banner}
      <Field label="Answer in English" hint="HALA reads this out on the next call that asks the same thing. Label any fee or timeline as DEMO.">
        <textarea className={`${inputCls} h-28`} value={en} onChange={(e) => setEn(e.target.value)} autoFocus />
      </Field>
      <Field label="Answer in Arabic (optional)">
        <textarea className={`${inputCls} h-24`} dir="rtl" lang="ar" value={ar} onChange={(e) => setAr(e.target.value)} />
      </Field>
      <Field label="Service">
        <select className={inputCls} value={service} onChange={(e) => setService(e.target.value)}>
          {SERVICES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
          <option value="general">General enquiry</option>
        </select>
      </Field>
    </Modal>
  );
}

function Metric({ label, value, sub, accent }: { label: string; value: number; sub: string; accent: string }) {
  return (
    <div className={`rounded-lg border border-stone-200 border-t-[3px] bg-white px-4 py-3 ${accent}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">{label}</div>
      <div className="text-3xl font-semibold tabular-nums text-ink">{value}</div>
      <div className="text-xs text-stone-500">{sub}</div>
    </div>
  );
}

function TeachView() {
  const { source } = useData();
  const { data } = useQuery((s, f) => s.getSnapshot(f));
  const { run, busy, banner } = useAction();
  const [tab, setTab] = useState<KnowledgeGap['status']>('waiting');
  const [answering, setAnswering] = useState<KnowledgeGap | null>(null);

  const gaps = data?.knowledge_gaps ?? [];
  const by = useMemo(() => {
    const out: Record<KnowledgeGap['status'], KnowledgeGap[]> = { waiting: [], answered: [], out_of_scope: [] };
    for (const g of gaps) out[g.status]?.push(g);
    out.waiting.sort((a, b) => b.times_asked - a.times_asked);
    out.answered.sort((a, b) => b.times_used - a.times_used);
    out.out_of_scope.sort((a, b) => b.times_asked - a.times_asked);
    return out;
  }, [gaps]);

  if (!data) return <div className="text-stone-400">Loading…</div>;

  const used = by.answered.reduce((s, g) => s + g.times_used, 0);
  const waitingCalls = by.waiting.reduce((s, g) => s + g.times_asked, 0);
  const rows = by[tab];

  return (
    <div>
      {banner}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metric label="Questions waiting" value={by.waiting.length} sub={`asked ${waitingCalls} times in total`} accent="border-t-gold-500" />
        <Metric label="Answered by admins" value={by.answered.length} sub="now part of HALA's knowledge" accent="border-t-emerald-600" />
        <Metric label="Admin answers used" value={used} sub="times HALA reused an admin answer" accent="border-t-blue-600" />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'waiting', label: 'Waiting for an answer', count: by.waiting.length },
          { value: 'answered', label: 'Answered', count: by.answered.length },
          { value: 'out_of_scope', label: 'Out of scope', count: by.out_of_scope.length },
        ]}
      />

      {!rows.length ? (
        <Empty>{tab === 'waiting' ? 'HALA has answered everything callers asked. 🎉' : 'Nothing here yet.'}</Empty>
      ) : (
        <ul className="divide-y divide-stone-100">
          {rows.map((g, i) => (
            <li key={g.id} className="flex flex-wrap items-start gap-4 py-4">
              <div className="w-14 shrink-0 text-center">
                <div className={`text-2xl font-semibold tabular-nums ${tab === 'waiting' && i === 0 ? 'text-red-700' : 'text-gold-700'}`}>
                  {tab === 'answered' ? g.times_used : g.times_asked}×
                </div>
                <div className="text-[10px] uppercase tracking-wider text-stone-400">{tab === 'answered' ? 'used' : 'asked'}</div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-medium leading-snug text-ink" dir="auto">
                  “{g.question}”
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                  <LangBadge lang={g.language} />
                  <span>{serviceLabel(g.service)}</span>
                  <span>· first asked {fmtDateTime(g.first_asked_at)}</span>
                  <span>· last asked {fmtAge(g.last_asked_at)} ago</span>
                </div>
                {tab === 'answered' && (
                  <div className="mt-2 space-y-1 rounded-md bg-emerald-50/60 px-3 py-2 text-sm text-stone-700 ring-1 ring-emerald-100">
                    <div dir="auto">{g.answer_en}</div>
                    {g.answer_ar && (
                      <div dir="rtl" lang="ar" className="text-stone-600">
                        {g.answer_ar}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                {tab === 'waiting' && (
                  <>
                    <Button variant="primary" size="xs" onClick={() => setAnswering(g)}>
                      Answer
                    </Button>
                    <Button
                      size="xs"
                      variant="danger"
                      disabled={busy}
                      onClick={() => run(() => source.setGapStatus(g.id, 'out_of_scope'), 'Marked out of scope: HALA will hand over')}
                    >
                      Out of scope
                    </Button>
                  </>
                )}
                {tab === 'answered' && (
                  <Button size="xs" onClick={() => setAnswering(g)}>
                    Edit answer
                  </Button>
                )}
                {tab === 'out_of_scope' && (
                  <Button size="xs" disabled={busy} onClick={() => run(() => source.setGapStatus(g.id, 'waiting'), 'Moved back to waiting')}>
                    Move back
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {answering && <AnswerGap gap={answering} onClose={() => setAnswering(null)} />}
    </div>
  );
}

const TeachAgent: WidgetDef = { id: 'teach', title: 'Questions HALA could not answer', size: 'full', Component: TeachView };
export default TeachAgent;
