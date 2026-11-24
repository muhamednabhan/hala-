import { Component, type ReactNode } from 'react';

/** One broken widget shows a message instead of taking the whole page down. */
export class ErrorBoundary extends Component<{ children: ReactNode; label: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[${this.props.label}]`, error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
        {this.props.label} could not be shown: {this.state.error.message}
        <button type="button" className="ml-2 underline" onClick={() => this.setState({ error: null })}>
          Retry
        </button>
      </div>
    );
  }
}
