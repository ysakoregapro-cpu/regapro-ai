import type {
  CreateShiftInput,
  CreateShiftRequestDraftInput,
  Shift,
  ShiftRequest,
  WorkLocation,
} from "./types.js";

/**
 * Persistence ports. Implementations live in adapters (web, iOS, spreadsheet).
 * Domain core must not import Supabase.
 */

export type ShiftListQuery = {
  from?: string;
  to?: string;
  staffId?: string;
};

export type ShiftRequestListQuery = {
  periodStart?: string;
  periodEnd?: string;
  staffId?: string;
};

export interface WorkLocationRepository {
  listActive(orgId: string): Promise<WorkLocation[]>;
}

export interface ShiftRequestRepository {
  getById(orgId: string, id: string): Promise<ShiftRequest | null>;
  list(orgId: string, query: ShiftRequestListQuery): Promise<ShiftRequest[]>;
  createOrReplaceDraft(
    orgId: string,
    actorStaffId: string,
    input: CreateShiftRequestDraftInput,
  ): Promise<ShiftRequest>;
  submit(orgId: string, requestId: string): Promise<ShiftRequest>;
  cancel(orgId: string, requestId: string): Promise<ShiftRequest>;
}

export interface ShiftRepository {
  getById(orgId: string, id: string): Promise<Shift | null>;
  list(orgId: string, query: ShiftListQuery): Promise<Shift[]>;
  createDraft(orgId: string, input: CreateShiftInput): Promise<Shift>;
  publish(orgId: string, shiftId: string): Promise<Shift>;
  cancel(orgId: string, shiftId: string): Promise<Shift>;
}

export type ShiftPorts = {
  locations: WorkLocationRepository;
  requests: ShiftRequestRepository;
  shifts: ShiftRepository;
};
