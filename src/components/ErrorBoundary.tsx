import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'An unexpected application error occurred.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-red-200 rounded-xl p-6 space-y-3">
            <div className="flex items-center gap-2 text-red-700 font-semibold">
              <ShieldAlert className="w-5 h-5 shrink-0" aria-hidden="true" />
              <h2>Safety Console Recovery</h2>
            </div>
            <p className="text-sm text-slate-700">
              A component error occurred. Please reload or sign in again to continue monitoring.
            </p>
            <p className="text-xs font-mono text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3 break-words">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 cursor-pointer"
            >
              Reload Console
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
