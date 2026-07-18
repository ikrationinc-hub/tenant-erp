import { Component, type ReactNode } from "react";
import { Button, Result } from "antd";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error) {
      return (
        <Result
          status="error"
          title="Something went wrong"
          subTitle={error.message}
          extra={
            <Button type="primary" onClick={() => window.location.assign("/")}>
              Reload
            </Button>
          }
        />
      );
    }
    return this.props.children;
  }
}
