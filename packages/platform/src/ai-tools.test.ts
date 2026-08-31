import { describe, expect, it, vi } from "vitest";
import { selfScope } from "@regapro/shared";
import {
  createAiToolRegistry,
  ownRecordsScope,
  type AiToolDefinition,
} from "./ai-tools.js";
import { isPlatformAccessError } from "./guards.js";
import { grant, makeAccess } from "./test-support.js";

/**
 * Stand-ins for the business tools that will register later. They deliberately
 * do no data access — the point under test is that the guard runs first.
 */
const listMyTasks: AiToolDefinition<{ limit?: number }, { items: string[] }> = {
  name: "tasks.get_my_tasks",
  moduleId: "tasks",
  description: "自分のタスクを取得する",
  parameters: { type: "object", properties: {} },
  requiredPermissions: ["tasks.use"],
  resolveScope: (_input, access) => ownRecordsScope(access),
  execute: async () => ({ items: ["task-1"] }),
};

const manageEverything: AiToolDefinition<Record<string, never>, { ok: true }> = {
  name: "admin.manage_roles",
  moduleId: "admin",
  description: "ロールを変更する",
  parameters: { type: "object", properties: {} },
  requiredPermissions: ["admin.role_manage"],
  execute: async () => ({ ok: true }),
};

const registry = createAiToolRegistry([listMyTasks, manageEverything]);

describe("AI tool permission guard", () => {
  it("runs a tool the caller is permitted to use", async () => {
    const ctx = makeAccess({
      staffId: "staff-1",
      grants: [grant("tasks.use", selfScope("staff-1"))],
    });
    await expect(
      registry.invoke({ name: "tasks.get_my_tasks", input: {}, access: ctx }),
    ).resolves.toEqual({ items: ["task-1"] });
  });

  it("refuses a tool the caller lacks permission for", async () => {
    const ctx = makeAccess({ grants: [grant("tasks.use")] });
    await expect(
      registry.invoke({ name: "admin.manage_roles", input: {}, access: ctx }),
    ).rejects.toSatisfy(isPlatformAccessError);
  });

  it("does not execute the tool body when refused", async () => {
    const execute = vi.fn(async () => ({ ok: true }) as const);
    const guarded = createAiToolRegistry([
      { ...manageEverything, execute },
    ]);
    const ctx = makeAccess({ grants: [] });

    await expect(
      guarded.invoke({ name: "admin.manage_roles", input: {}, access: ctx }),
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses tools belonging to a planned module", async () => {
    const plannedTool: AiToolDefinition = {
      name: "expense.get_my_expenses",
      moduleId: "expense",
      description: "自分の経費を取得する",
      parameters: { type: "object", properties: {} },
      requiredPermissions: ["expense.view_own"],
      execute: async () => ({}),
    };
    const planned = createAiToolRegistry([plannedTool]);
    const ctx = makeAccess({ grants: [grant("expense.view_own")] });

    await expect(
      planned.invoke({
        name: "expense.get_my_expenses",
        input: {},
        access: ctx,
      }),
    ).rejects.toMatchObject({ code: "MODULE_UNAVAILABLE" });
  });

  it("refuses unknown tool names without revealing the catalog", async () => {
    const ctx = makeAccess({ grants: [grant("tasks.use")] });
    await expect(
      registry.invoke({ name: "sales.drop_table", input: {}, access: ctx }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses every tool for suspended staff", async () => {
    const ctx = makeAccess({
      staffStatus: "suspended",
      grants: [grant("tasks.use")],
    });
    await expect(
      registry.invoke({ name: "tasks.get_my_tasks", input: {}, access: ctx }),
    ).rejects.toMatchObject({ code: "STAFF_INACTIVE" });
  });

  it("only advertises tools the caller may use", () => {
    const ctx = makeAccess({
      staffId: "staff-1",
      grants: [grant("tasks.use", selfScope("staff-1"))],
    });
    expect(registry.listAvailable(ctx).map((t) => t.name)).toEqual([
      "tasks.get_my_tasks",
    ]);
  });

  it("advertises nothing to staff with no grants", () => {
    expect(registry.listAvailable(makeAccess({ grants: [] }))).toEqual([]);
  });

  it("rejects a registry with duplicate tool names", () => {
    expect(() => createAiToolRegistry([listMyTasks, listMyTasks])).toThrow(
      /Duplicate AI tool name/,
    );
  });
});
