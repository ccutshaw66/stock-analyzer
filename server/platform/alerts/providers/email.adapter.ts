import type { Alert, AlertProvider } from "../types";
// import { config } from "../../config";

export const emailProvider: AlertProvider = {
  name: "email",
  async send(userId: string, alert: Alert): Promise<void> {
    // TODO: lookup user email, render template, send via SendGrid/SES
    throw new Error("NotImplemented: emailProvider.send");
  },
};
