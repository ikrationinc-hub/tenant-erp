import { useEffect } from "react";
import { App as AntApp } from "antd";
import { registerErrorNotifier } from "../core/api/error-toast";

/**
 * Renders nothing - it only bridges AntD's notification API (only reachable
 * via the useApp hook, which needs an <AntApp/> ancestor) to the
 * module-level notifyError() that the query client's onError calls from
 * outside React.
 */
export function GlobalErrorToast(): null {
  const { notification } = AntApp.useApp();

  useEffect(() => {
    registerErrorNotifier((payload) => {
      notification.error({
        message: payload.message,
        description: payload.description,
        placement: "topRight",
      });
    });
    return () => registerErrorNotifier(null);
  }, [notification]);

  return null;
}
