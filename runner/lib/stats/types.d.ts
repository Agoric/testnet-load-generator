/* eslint-disable no-unused-vars,no-redeclare */

export interface LogPerfEvent {
  (eventType: string, data?: Record<string, unknown>): void;
}
