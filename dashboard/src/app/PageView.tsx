import { ErrorBoundary } from '../ui/ErrorBoundary';
import { PAGES, registry, type PageId } from '../widgets/registry';
import type { WidgetSize } from '../widgets/types';

const SPAN: Record<WidgetSize, string> = {
  sm: 'col-span-12 xl:col-span-4',
  md: 'col-span-12 xl:col-span-6',
  lg: 'col-span-12 xl:col-span-8',
  full: 'col-span-12',
};

export function PageView({ page }: { page: PageId }) {
  const widgets = registry[page];
  if (!widgets.length) {
    const meta = PAGES.find((p) => p.id === page);
    return (
      <div className="rounded-card border border-dashed border-slate-300 bg-white p-12 text-center text-slate-600">
        <div className="font-display text-2xl font-semibold text-ink">{meta?.label}</div>
        <div className="mt-1">Coming in build step {meta?.buildStep}.</div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-12 items-start gap-5">
      {widgets.map(({ id, title, size, Component }) => (
        <section key={id} className={`${SPAN[size]} rounded-card border border-slate-200 bg-white p-6 shadow-card`}>
          <h2 className="mb-4 font-display text-[24px] font-bold leading-tight text-ink">{title}</h2>
          <ErrorBoundary label={title}>
            <Component />
          </ErrorBoundary>
        </section>
      ))}
    </div>
  );
}
