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

  componentDidCatch(error: Error, info: any) {
    console.error("[ErrorBoundary] Caught error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#040d22",
          color: "#fff",
          fontFamily: "system-ui, sans-serif",
          padding: "2rem",
          textAlign: "center",
        }}>
          <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>Something went wrong</h1>
          <p style={{ color: "#888", fontSize: "0.875rem", maxWidth: "500px", marginBottom: "1rem" }}>
            Stock Otter encountered an error. Try refreshing the page or clearing your browser cache.
          </p>
          <pre style={{
            background: "#0a1628",
            border: "1px solid #1e293b",
            borderRadius: "8px",
            padding: "1rem",
            fontSize: "0.75rem",
            color: "#ef4444",
            maxWidth: "600px",
            overflow: "auto",
            textAlign: "left",
            marginBottom: "1rem",
          }}>
            {this.state.error?.message || "Unknown error"}
            {"\n"}
            {this.state.error?.stack?.split("\n").slice(0, 3).join("\n")}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "0.5rem 2rem",
              background: "#6366f1",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              fontSize: "0.875rem",
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
