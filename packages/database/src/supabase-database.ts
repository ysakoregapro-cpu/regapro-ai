/**
 * Boundary re-export for Supabase-generated Database types.
 * Keep domain Zod models in `./schemas.ts` — do not replace them with these.
 */
export type {
  Database,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
  Enums,
  CompositeTypes,
} from "./generated/database.types.js";
export { Constants } from "./generated/database.types.js";
