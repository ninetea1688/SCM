/**
 * DB provider tokens, in their own module so services injected with them
 * (QuotaRecorder) can be provided by CoreModule without a circular import.
 */
/** Tenant-scoped DB (role scm_app, RLS enforced). Use with `withTenant()`. */
export const APP_DB = Symbol('APP_DB');
/** Cross-tenant DB (role scm_system, BYPASSRLS). Only for system jobs — see ADR-0006. */
export const SYSTEM_DB = Symbol('SYSTEM_DB');
