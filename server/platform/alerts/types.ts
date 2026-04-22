export type AlertChannel = "email" | "webhook" | "push" | "sms";

export interface Alert {
  id: string;
  userId: string;
  symbol: string;
  type: "gate_passed" | "verdict_change" | "price_target_hit" | "unusual_options";
  title: string;
  body: string;
  payload?: Record<string, unknown>;
  createdAt: Date;
}

export interface AlertProvider {
  name: AlertChannel;
  send(userId: string, alert: Alert): Promise<void>;
}
