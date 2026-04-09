import { Component, type ErrorInfo, type ReactNode } from "react";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
  componentStack: string;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    error: null,
    componentStack: "",
  };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      error,
      componentStack: "",
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("App render failed:", error, errorInfo);
    this.setState({
      error,
      componentStack: errorInfo.componentStack ?? "",
    });
  }

  render() {
    const { error, componentStack } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="w-full max-w-3xl rounded-2xl border bg-card p-6 shadow-card-surface">
          <h1 className="text-xl font-semibold">Runtime error</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The dev app hit an unexpected error while rendering. The details below should help us fix it.
          </p>
          <pre className="mt-4 overflow-auto rounded-xl bg-muted/60 p-4 text-xs leading-relaxed whitespace-pre-wrap">
            {error.stack || error.message}
            {componentStack ? `\n${componentStack}` : ""}
          </pre>
        </div>
      </div>
    );
  }
}
