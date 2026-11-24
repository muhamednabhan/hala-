import type { ComponentType } from 'react';

/** Column span on the 12-col page grid (xl screens). */
export type WidgetSize = 'sm' | 'md' | 'lg' | 'full';

export interface WidgetDef {
  id: string;
  title: string;
  size: WidgetSize;
  Component: ComponentType;
}

export type PageId = 'overview' | 'calendar' | 'conversations' | 'requests' | 'followups' | 'teach' | 'handovers' | 'bookings';
