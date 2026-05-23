import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Per-widget error boundary. Catches render-time crashes inside a single
 * dashboard compartment so the rest of the page keeps rendering.
 *
 * Use this around every WidgetView mount on the dashboard grid.
 * `widgetName` is shown in the fallback so we know which compartment died.
 */
interface Props {
  children: ReactNode;
  widgetName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class WidgetErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: any) {
    console.error(`[Widget:${this.props.widgetName ?? "unknown"}] crashed:`, error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full w-full flex flex-col items-center justify-center gap-2 px-3 py-4 text-center bg-bear/5 border border-bear/20 rounded">
          <AlertTriangle className="h-5 w-5 text-bear-light" />
          <div className="text-xs font-semibold text-bear-light">
            {this.props.widgetName ? `${this.props.widgetName} crashed` : "Widget crashed"}
          </div>
          <div className="text-micro text-muted-foreground max-w-xs">
            The other tiles still work. Refresh to retry — if it persists, report it.
          </div>
          {this.state.error?.message && (
            <details className="text-micro text-muted-foreground/70 max-w-xs">
              <summary className="cursor-pointer">Details</summary>
              <pre className="mt-1 text-left whitespace-pre-wrap break-words">
                {this.state.error.message}
              </pre>
            </details>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
