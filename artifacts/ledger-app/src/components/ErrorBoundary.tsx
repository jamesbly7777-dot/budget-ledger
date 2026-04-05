import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
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
    console.error("App error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "hsl(222 47% 7%)",
          color: "hsl(210 40% 98%)",
          fontFamily: "monospace",
          padding: "2rem",
          flexDirection: "column",
          gap: "1rem",
          textAlign: "center",
        }}>
          <div style={{ fontSize: "1.25rem", color: "hsl(0 84% 60%)" }}>
            App failed to load
          </div>
          <div style={{ fontSize: "0.75rem", color: "hsl(215 20% 65%)", maxWidth: "600px", wordBreak: "break-word" }}>
            {this.state.error?.message}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: "1rem",
              padding: "0.5rem 1.5rem",
              background: "hsl(217 91% 60%)",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontFamily: "monospace",
            }}
          >
            RETRY
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
