import { useEffect, useRef } from 'react';
import { turnText } from '../data/compute';
import type { TranscriptTurn } from '../data/types';

const fmtSecs = (s?: number) => (s == null ? '' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);

/** ElevenLabs transcript as chat bubbles. Arabic lines render RTL via dir="auto". */
export function Transcript({
  turns,
  maxHeight,
  autoScroll = false,
  emptyText = 'Waiting for the first words…',
}: {
  turns: TranscriptTurn[];
  maxHeight?: string;
  autoScroll?: boolean;
  emptyText?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (autoScroll && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [turns, autoScroll]);

  if (!turns.length) return <div className="py-6 text-center text-sm text-slate-400">{emptyText}</div>;

  return (
    <div ref={ref} className="scroll-quiet space-y-2.5 overflow-y-auto pr-1" style={maxHeight ? { maxHeight } : undefined}>
      {turns.map((t, i) => {
        const agent = t.role === 'agent';
        return (
          <div key={i} className={`flex ${agent ? 'justify-start' : 'justify-end'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                agent
                  ? 'rounded-tl-sm border border-navy-200 bg-navy-50 text-ink'
                  : 'rounded-tr-sm bg-slate-100 text-ink'
              }`}
            >
              <div className="mb-0.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {agent ? <span className="text-navy-700">HALA</span> : <span>Caller</span>}
                <span className="font-normal tabular-nums text-slate-400">{fmtSecs(t.time_in_call_secs)}</span>
              </div>
              <div dir="auto">{turnText(t)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
