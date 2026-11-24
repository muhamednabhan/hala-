// Pages render whatever is listed here, in order. Add a widget = create src/widgets/<Name>.tsx + list it below.

import KpiCards from './KpiCards';
import LiveFeed from './LiveFeed';
import type { PageId, WidgetDef } from './types';

export const registry: Record<PageId, WidgetDef[]> = {
  overview: [KpiCards, LiveFeed],
  requests: [],
  followups: [],
  teach: [],
  handovers: [],
  bookings: [],
};

export const PAGES: { id: PageId; label: string; buildStep: number }[] = [
  { id: 'overview', label: 'Overview', buildStep: 2 },
  { id: 'requests', label: 'Requests', buildStep: 6 },
  { id: 'followups', label: 'Follow-ups', buildStep: 5 },
  { id: 'teach', label: 'Teach the agent', buildStep: 4 },
  { id: 'handovers', label: 'Handovers', buildStep: 6 },
  { id: 'bookings', label: 'Bookings', buildStep: 7 },
];

export type { PageId, WidgetDef } from './types';
