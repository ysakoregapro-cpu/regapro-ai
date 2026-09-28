import type {
  CreateEmploymentTermInput,
  CreateWorkRecordDraftInput,
  EmploymentTerm,
  WorkRecord,
  WorkRecordRevision,
} from "./work-types.js";

export type WorkRecordListQuery = {
  from?: string;
  to?: string;
  staffId?: string;
};

export type EmploymentTermListQuery = {
  staffId?: string;
};

export interface EmploymentTermRepository {
  list(orgId: string, query: EmploymentTermListQuery): Promise<EmploymentTerm[]>;
  create(orgId: string, input: CreateEmploymentTermInput): Promise<EmploymentTerm>;
  revoke(orgId: string, termId: string, reason: string): Promise<EmploymentTerm>;
}

export interface WorkRecordRepository {
  getById(orgId: string, id: string): Promise<WorkRecord | null>;
  list(orgId: string, query: WorkRecordListQuery): Promise<WorkRecord[]>;
  createOrUpdateDraft(
    orgId: string,
    input: CreateWorkRecordDraftInput,
  ): Promise<WorkRecord>;
  confirm(orgId: string, workRecordId: string): Promise<WorkRecord>;
  reopen(orgId: string, workRecordId: string, reason: string): Promise<WorkRecord>;
  void(orgId: string, workRecordId: string, reason: string): Promise<WorkRecord>;
}

export interface WorkRecordRevisionRepository {
  listForRecord(orgId: string, workRecordId: string): Promise<WorkRecordRevision[]>;
}

export type WorkRecordPorts = {
  terms: EmploymentTermRepository;
  records: WorkRecordRepository;
  revisions: WorkRecordRevisionRepository;
};
