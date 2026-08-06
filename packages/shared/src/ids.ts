export type EntityId = string & { readonly __brand: "EntityId" };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function createEntityId(value: string): EntityId {
  if (!isValidUuid(value)) {
    throw new Error(`Invalid entity ID (expected UUID): ${value}`);
  }
  return value as EntityId;
}

export function newEntityId(): EntityId {
  return crypto.randomUUID() as EntityId;
}

export type OrganizationId = EntityId & { readonly __org: true };
export type ProjectId = EntityId & { readonly __project: true };
export type UserId = EntityId & { readonly __user: true };

export function asOrganizationId(id: EntityId): OrganizationId {
  return id as OrganizationId;
}

export function asProjectId(id: EntityId): ProjectId {
  return id as ProjectId;
}

export function asUserId(id: EntityId): UserId {
  return id as UserId;
}
