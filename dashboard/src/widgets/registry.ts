// Pages render whatever is listed here, in order. Add a widget = create src/widgets/<Name>.tsx + list it below.

import BookingsCalendar from './BookingsCalendar';
import Conversations from './Conversations';
import FollowUps from './FollowUps';
import HandoverQueue from './HandoverQueue';
import Insights from './Insights';
import KpiCards from './KpiCards';
import LiveConversation from './LiveConversation';
import LiveFeed from './LiveFeed';
import RequestsTable from './RequestsTable';
import TeachAgent from './TeachAgent';
import type { PageId, WidgetDef } from './types';

export const registry: Record<PageId, WidgetDef[]> = {
  overview: [KpiCards, LiveFeed, Insights, LiveConversation],
  conversations: [Conversations],
  requests: [RequestsTable],
  followups: [FollowUps],
  teach: [TeachAgent],
  handovers: [HandoverQueue],
  bookings: [BookingsCalendar],
};

export const PAGES: { id: PageId; label: string; subtitle?: string; buildStep: number; ready: boolean }[] = [
  { id: 'overview', label: 'Overview', subtitle: 'What HALA handled, what is still open, and what the data shows', buildStep: 2, ready: true },
  { id: 'conversations', label: 'Conversations', subtitle: 'Every call with its ElevenLabs transcript', buildStep: 2, ready: true },
  { id: 'requests', label: 'Requests', subtitle: 'Every service request across all calls', buildStep: 6, ready: true },
  { id: 'followups', label: 'Follow-ups', subtitle: 'Callers waiting on DSO, and tomorrow’s appointments', buildStep: 5, ready: true },
  { id: 'teach', label: 'Teach the agent', subtitle: 'Answer once, and HALA answers it on every future call', buildStep: 4, ready: true },
  { id: 'handovers', label: 'Handovers', subtitle: 'Callers HALA passed to a human, with what it already collected', buildStep: 6, ready: true },
  { id: 'bookings', label: 'Bookings', subtitle: 'Appointments HALA booked by voice', buildStep: 7, ready: true },
];

export type { PageId, WidgetDef } from './types';
