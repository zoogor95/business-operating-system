/**
 * Module catalogue keys. The database `modules` table (BOS-018) is seeded
 * from these, and `@RequiresModule()` / nav generation reference them.
 */
export const CORE_MODULES = [
  'sales',
  'inventory',
  'customers',
  'suppliers',
  'purchasing',
  'expenses',
  'employees',
  'accounting',
  'reports',
] as const;

export const OPTIONAL_MODULES = [
  'appointments',
  'loyalty',
  'online-store',
  'delivery',
  'manufacturing',
  'service-management',
] as const;

export const VERTICAL_MODULES = ['optical', 'restaurant', 'salon'] as const;

export type CoreModuleKey = (typeof CORE_MODULES)[number];
export type OptionalModuleKey = (typeof OPTIONAL_MODULES)[number];
export type VerticalModuleKey = (typeof VERTICAL_MODULES)[number];
export type ModuleKey = CoreModuleKey | OptionalModuleKey | VerticalModuleKey;

export type ModuleCategory = 'core' | 'optional' | 'vertical';

export const ALL_MODULES: readonly ModuleKey[] = [
  ...CORE_MODULES,
  ...OPTIONAL_MODULES,
  ...VERTICAL_MODULES,
];
