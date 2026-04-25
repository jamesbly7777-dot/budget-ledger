import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  pageName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[ErrorBoundary]", this.props.pageName ?? "App", error.message, info.componentStack?.slice(0, 300));
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 p-8 text-center">
          <div className="w-16 h-16 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center shadow-[0_0_40px_-10px_hsl(350_85%_50%_/_.4)]">
            <AlertTriangle className="w-8 h-8 text-red-400" />
          </div>
          <div className="space-y-2">
            <p className="text-lg font-display font-bold uppercase tracking-[0.2em] text-red-400/90">
              {this.props.pageName ? `${this.props.pageName} Error` : "Something went wrong"}
            </p>
            <p className="text-sm text-muted-foreground font-mono max-w-xs">
              Your data is safe. Tap Reload to recover this page.
            </p>
            {this.state.error && (
              <p className="text-[11px] text-red-400/60 font-mono mt-2 max-w-xs break-all">
                {this.state.error.message}
              </p>
            )}
          </div>
          <button
            onClick={this.reset}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground font-mono text-xs uppercase tracking-[0.2em] shadow-[0_0_24px_-6px_hsl(187_100%_50%_/_.55)] hover:shadow-[0_0_28px_-4px_hsl(187_100%_55%_/_.65)] transition-all"
          >
            <RefreshCw className="w-4 h-4" />
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
