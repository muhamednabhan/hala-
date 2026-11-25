import type { ServiceRequest } from '../data/types';

/**
 * What staff can change on a request. Demo mode stores everything. Live mode only has storage for
 * maintenance tickets and complaints (hala_requests.status / resolution, migration 002); bookings and
 * handovers are changed on their own pages.
 */
export function editable(mode: 'mock' | 'live', r: ServiceRequest) {
  if (mode === 'mock') return { any: true, why: '' };
  if (r.id.startsWith('ticket:')) return { any: true, why: '' };
  const where =
    r.resolution === 'handed_over'
      ? 'the Handovers page'
      : ['booked', 'rescheduled', 'cancelled'].includes(r.resolution ?? '')
        ? 'the Bookings page'
        : r.unsolved_reason === 'unknown_answer'
          ? 'the Teach the agent page (answer the question there)'
          : '';
  return { any: false, why: where ? `Change this on ${where}.` : 'Nothing to change: HALA handled this one in the call.' };
}
