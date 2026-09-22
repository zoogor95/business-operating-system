/**
 * Domain event envelope (see BOS-023). Every event crossing a module
 * boundary uses this shape so the in-process bus can later be swapped
 * for BullMQ/Kafka without changing producers or consumers.
 */
export interface DomainEvent<TType extends string = string, TPayload = unknown> {
  /** Unique event id (UUID) — handlers use it for idempotency. */
  id: string;
  type: TType;
  /** Contract version; bump on breaking payload changes. */
  version: number;
  tenantId: string;
  /** ISO-8601 UTC timestamp. */
  occurredAt: string;
  actor: EventActor;
  payload: TPayload;
}

export type EventActor =
  | { kind: 'user'; userId: string; membershipId: string }
  | { kind: 'system'; source: string }
  | { kind: 'support'; platformAdminId: string; onBehalfOfUserId?: string };

/** Sample contract — the real set is defined as modules are built. */
export type OrderCompletedV1 = DomainEvent<
  'sales.order.completed',
  {
    orderId: string;
    orderNumber: string;
    customerId: string | null;
    locationId: string;
    /** Integer minor units (sen). */
    totalMinor: number;
    currency: string;
    lines: { variantId: string | null; quantity: number }[];
  }
>;

export const EVENT_TYPES = {
  orderCompleted: 'sales.order.completed',
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];
