import type { RequestStatus } from '../data/types';

// Full class strings (not built dynamically) so Tailwind keeps them.
export const STATUS_META: Record<
  RequestStatus,
  { label: string; text: string; bg: string; border: string; dot: string; hex: string }
> = {
  solved: { label: 'Solved', text: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500', dot: 'bg-emerald-500', hex: '#10b981' },
  open: { label: 'Open', text: 'text-blue-400', bg: 'bg-blue-500/15', border: 'border-blue-500', dot: 'bg-blue-500', hex: '#3b82f6' },
  needs_followup: { label: 'Needs follow-up', text: 'text-amber-400', bg: 'bg-amber-500/15', border: 'border-amber-500', dot: 'bg-amber-500', hex: '#f59e0b' },
  unsolved: { label: 'Unsolved', text: 'text-red-400', bg: 'bg-red-500/15', border: 'border-red-500', dot: 'bg-red-500', hex: '#ef4444' },
};

export const STATUS_ORDER: RequestStatus[] = ['solved', 'open', 'needs_followup', 'unsolved'];
