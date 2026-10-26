import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  name?: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Granular ErrorBoundary so a fault in a plugin panel, ReactFlow graph, or Monaco
 * never takes down the entire workbench or discards unsaved editor tabs.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ErrorBoundary${this.props.name ? `: ${this.props.name}` : ""}]`, error, info.componentStack);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="p-4 text-xs space-y-2 bg-bg-panel border border-error/40 rounded m-2">
        <div className="flex items-center gap-1.5 text-error font-semibold">
          <AlertTriangle size={14} />
          <span>{this.props.name ? `${this.props.name} crashed` : "Component error"}</span>
        </div>
        <pre className="font-mono text-[11px] text-fg-muted whitespace-pre-wrap break-all max-h-40 overflow-auto">{error.message}</pre>
        <button type="button" onClick={this.reset} className="btn-ghost">
          <RotateCcw size={12} /> Retry view
        </button>
      </div>
    );
  }
}
