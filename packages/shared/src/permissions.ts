/**
 * Code-defined permission catalogue (see BOS-021). Keys follow
 * `<module>.<resource>.<action>` or `<module>.<action>`.
 * This is a starter set; it grows as modules are built.
 */
export const PERMISSIONS = {
  sales: {
    orderView: 'sales.order.view',
    orderCreate: 'sales.order.create',
    orderEdit: 'sales.order.edit',
    orderDelete: 'sales.order.delete',
    refund: 'sales.refund',
    discountOverride: 'sales.discount.override',
  },
  inventory: {
    view: 'inventory.view',
    receive: 'inventory.receive',
    adjust: 'inventory.adjust',
    viewCost: 'inventory.cost.view',
  },
  customers: {
    view: 'customers.view',
    create: 'customers.create',
    edit: 'customers.edit',
    export: 'customers.export',
  },
  accounting: {
    viewReports: 'accounting.reports.view',
    postJournal: 'accounting.journal.post',
  },
  settings: {
    manage: 'settings.manage',
    manageUsers: 'settings.users.manage',
  },
} as const;

type ValuesOf<T> = T extends Record<string, infer V> ? (V extends string ? V : ValuesOf<V>) : never;

/** Union of every permission key string, e.g. 'sales.refund'. */
export type PermissionKey = ValuesOf<typeof PERMISSIONS>;

export const ALL_PERMISSIONS: readonly PermissionKey[] = Object.values(PERMISSIONS).flatMap(
  (group) => Object.values(group),
);
