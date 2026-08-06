export const PERMISSIONS = [
  "chat:use",
  "knowledge:read",
  "knowledge:write",
  "knowledge:review",
  "knowledge:approve",
  "research:run",
  "artifact:generate",
  "prompt:generate",
  "project:read",
  "project:manage",
  "task:read",
  "task:create",
  "task:update",
  "task:complete",
  "task:assign",
  "task:manage",
  "task:notification_manage",
  "organization:manage",
  "member:manage",
  "audit:read",
  "system:diagnose",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ["member", "editor", "manager", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const VISIBILITY_LEVELS = [
  "private",
  "team",
  "department",
  "project",
  "organization",
] as const;

export type Visibility = (typeof VISIBILITY_LEVELS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  member: [
    "chat:use",
    "knowledge:read",
    "project:read",
    "task:read",
    "task:create",
    "task:update",
    "task:complete",
  ],
  editor: [
    "chat:use",
    "knowledge:read",
    "knowledge:write",
    "research:run",
    "artifact:generate",
    "prompt:generate",
    "project:read",
    "task:read",
    "task:create",
    "task:update",
    "task:complete",
    "task:assign",
  ],
  manager: [
    "chat:use",
    "knowledge:read",
    "knowledge:write",
    "knowledge:review",
    "research:run",
    "artifact:generate",
    "prompt:generate",
    "project:read",
    "project:manage",
    "task:read",
    "task:create",
    "task:update",
    "task:complete",
    "task:assign",
    "task:manage",
    "task:notification_manage",
    "member:manage",
    "audit:read",
  ],
  admin: [...PERMISSIONS],
};
