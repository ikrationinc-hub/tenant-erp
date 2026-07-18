import type { ReactElement } from "react";
import { Progress, Typography } from "antd";
import { estimatePasswordStrength } from "./password-strength";

const STRENGTH_COLORS = ["#dc2626", "#d97706", "#eab308", "#0e9f6e", "#0e9f6e"];

export function PasswordStrengthMeter({ password }: { password: string }): ReactElement | null {
  if (password.length === 0) {
    return null;
  }

  const { score, label, feedback } = estimatePasswordStrength(password);

  return (
    <div style={{ marginBottom: 16 }} data-testid="password-strength-meter">
      <Progress
        percent={((score + 1) / 5) * 100}
        showInfo={false}
        strokeColor={STRENGTH_COLORS[score] ?? "#dc2626"}
        size="small"
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {label}
        {feedback.length > 0 ? ` — ${feedback.join("; ")}` : ""}
      </Typography.Text>
    </div>
  );
}
