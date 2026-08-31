import type { PermissionScope, PlatformPermission } from "@regapro/shared";
import { selfScope } from "@regapro/shared";
import { staffFieldsOf, type AccessContext } from "@regapro/security";
import type { ModuleId } from "./modules.js";
import { getModule, isModuleRoutable } from "./modules.js";
import { PlatformAccessError, denialMessage, requireAnyPermission } from "./guards.js";
import { withLegacyCompatibilityGrants } from "./legacy-compat.js";

/**
 * AI Domain Tool contract — security layer 5.
 *
 * The assistant reaches business data only through registered tools. It never
 * gets a general database handle, so a prompt injection cannot widen access
 * beyond the permissions the signed-in staff member already holds.
 *
 * Tool implementations receive an `AccessContext` and MUST call Application
 * Services with it. They must not import repositories, providers, or a
 * service-role client.
 *
 * Business tools (`expense.get_my_expenses`, `sales.get_my_sales`,
 * `weekly_pay.get_my_history`) are intentionally not implemented yet — this is
 * the interface they will register against.
 */

export type AiToolInvocation<TInput> = {
  input: TInput;
  access: AccessContext;
};

export type AiToolDefinition<TInput = unknown, TOutput = unknown> = {
  /** Namespaced as `module.action`, matching the model-facing function name. */
  name: string;
  moduleId: ModuleId;
  description: string;
  /** JSON Schema handed to the model. */
  parameters: Record<string, unknown>;
  requiredPermissions: readonly PlatformPermission[];
  permissionMode?: "any" | "all";
  /**
   * Narrows the permission check for this specific call — return
   * `selfScope(staffId)` for "my own ..." tools so an org-wide grant is not
   * required to read one's own rows.
   */
  resolveScope?: (input: TInput, access: AccessContext) => PermissionScope;
  execute: (invocation: AiToolInvocation<TInput>) => Promise<TOutput>;
};

export type AiToolDescriptor = {
  name: string;
  moduleId: ModuleId;
  description: string;
  parameters: Record<string, unknown>;
};

export type AiToolRegistry = {
  /** Tools the caller is currently allowed to use — what the model is shown. */
  listAvailable(access: AccessContext): AiToolDescriptor[];
  has(name: string): boolean;
  /** Runs the permission check, then the tool. Throws `PlatformAccessError`. */
  invoke<TOutput = unknown>(args: {
    name: string;
    input: unknown;
    access: AccessContext;
  }): Promise<TOutput>;
};

function defaultScope(
  tool: AiToolDefinition<never, unknown>,
  input: unknown,
  access: AccessContext,
): PermissionScope | undefined {
  if (!tool.resolveScope) return undefined;
  return tool.resolveScope(input as never, access);
}

export function assertToolAllowed(
  access: AccessContext,
  tool: Pick<
    AiToolDefinition,
    "name" | "moduleId" | "requiredPermissions" | "permissionMode"
  >,
  scope?: PermissionScope,
): void {
  const module = getModule(tool.moduleId);
  if (!isModuleRoutable(module)) {
    throw new PlatformAccessError({
      code: "MODULE_UNAVAILABLE",
      message: denialMessage("MODULE_UNAVAILABLE"),
      moduleId: tool.moduleId,
    });
  }

  const staff = staffFieldsOf(access);
  if (staff.staffStatus !== null && staff.staffStatus !== "active") {
    throw new PlatformAccessError({
      code: "STAFF_INACTIVE",
      message: denialMessage("STAFF_INACTIVE"),
      moduleId: tool.moduleId,
    });
  }

  requireAnyPermission(access, tool.requiredPermissions, scope);
}

export function canUseTool(
  access: AccessContext,
  tool: Pick<
    AiToolDefinition,
    "name" | "moduleId" | "requiredPermissions" | "permissionMode"
  >,
): boolean {
  try {
    assertToolAllowed(access, tool);
    return true;
  } catch {
    return false;
  }
}

export function createAiToolRegistry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous tool inputs
  tools: readonly AiToolDefinition<any, any>[],
): AiToolRegistry {
  const byName = new Map(tools.map((t) => [t.name, t]));
  if (byName.size !== tools.length) {
    throw new Error("Duplicate AI tool name in registry");
  }

  return {
    listAvailable(access) {
      const resolved = withLegacyCompatibilityGrants(access);
      return tools
        .filter((tool) => canUseTool(resolved, tool))
        .map((tool) => ({
          name: tool.name,
          moduleId: tool.moduleId,
          description: tool.description,
          parameters: tool.parameters,
        }));
    },

    has(name) {
      return byName.has(name);
    },

    async invoke({ name, input, access }) {
      const tool = byName.get(name);
      if (!tool) {
        // Unknown names are refused as forbidden so probing cannot enumerate tools.
        throw new PlatformAccessError({
          code: "FORBIDDEN",
          message: denialMessage("FORBIDDEN"),
        });
      }
      const resolved = withLegacyCompatibilityGrants(access);
      assertToolAllowed(resolved, tool, defaultScope(tool, input, resolved));
      return (await tool.execute({ input, access: resolved })) as never;
    },
  };
}

/** Convenience for "my own rows" tools. */
export function ownRecordsScope(access: AccessContext): PermissionScope {
  return selfScope(staffFieldsOf(access).staffId);
}
