import type { ReactElement } from "react";
import { Button, Result } from "antd";
import { Link } from "react-router-dom";

/** A path that isn't in the user's menu lands here - a 404, never a blank screen (FE-4). */
export function NotFoundPage(): ReactElement {
  return (
    <Result
      status="404"
      title="404"
      subTitle="This page doesn't exist, or isn't in your menu."
      extra={
        <Button type="primary">
          <Link to="/">Back to dashboard</Link>
        </Button>
      }
    />
  );
}
