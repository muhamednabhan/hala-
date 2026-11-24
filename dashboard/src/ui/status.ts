import type { RequestStatus } from '../data/types';

// Full class strings (not built dynamically) so Tailwind keeps them.
export const STATUS_META: Record<
  RequestStatus,
  { label: string; text: string; bg: string; border: string; dot: string; hex: string }
> = {
  solved: { label: 'Solved', text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-600', dot: 'bg-emerald-600', hex: '#059669' },
  open: { label: 'Open', text: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-600', dot: 'bg-blue-600', hex: '#2563eb' },
  needs_followup: { label: 'Needs follow-up', text: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-500', dot: 'bg-amber-500', hex: '#f59e0b' },
  unsolved: { label: 'Unsolved', text: 'text-red-700', bg: 'bg-red-50', border: 'border-red-600', dot: 'bg-red-600', hex: '#dc2626' },
};

export const STATUS_ORDER: RequestStatus[] = ['solved', 'open', 'needs_followup', 'unsolved'];
