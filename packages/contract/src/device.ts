import { z } from 'zod';

/** Status values a device can report. */
export const DeviceStatusSchema = z.enum([
  'ok',
  'logged_out',
  'layout_changed',
  'totals_mismatch',
  'offline',
  'paused',
]);
export type DeviceStatus = z.infer<typeof DeviceStatusSchema>;

/** Schema version — bump on breaking contract changes. */
export const SCHEMA_VERSION = 1 as const;

