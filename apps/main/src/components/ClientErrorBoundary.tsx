"use client";

import { Component, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

/** Catches client render crashes that would otherwise white-screen the page. */
export class ClientErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6">
          <h2 className="text-lg font-semibold text-red-800 mb-2">This page hit an error</h2>
          <p className="text-sm text-red-700 mb-4 break-words">{this.state.error.message || "Unknown error"}</p>
          <button type="button" className="btn" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
