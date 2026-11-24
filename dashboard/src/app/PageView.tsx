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
      <div className="rounded-xl border border-dashed border-slate-700 p-12 text-center text-slate-400">
        <div className="text-lg font-semibold text-slate-200">{meta?.label}</div>
        <div className="mt-1">Coming in build step {meta?.buildStep}.</div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-12 gap-4">
      {widgets.map(({ id, title, size, Component }) => (
        <section key={id} className={`${SPAN[size]} rounded-2xl bg-slate-900/40 p-4 ring-1 ring-slate-800`}>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-300">{title}</h2>
          <Component />
        </section>
      ))}
    </div>
  );
}
