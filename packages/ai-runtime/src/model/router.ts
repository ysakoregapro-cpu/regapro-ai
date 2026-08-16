import type { AnswerIntent } from "../types.js";
import {
  extractRoutingSignals,
  ModelPolicy,
  type ModelRoute,
  type RoutingSignals,
} from "./policy.js";
import type { ModelRole } from "./roles.js";

export type ModelRouter = {
  route(input: {
    intent: AnswerIntent;
    text: string;
    hasInternalEvidence: boolean;
    hasWebEvidence: boolean;
  }): ModelRoute;
};

export class CapabilityModelRouter implements ModelRouter {
  constructor(private readonly policy: ModelPolicy = new ModelPolicy()) {}

  route(input: {
    intent: AnswerIntent;
    text: string;
    hasInternalEvidence: boolean;
    hasWebEvidence: boolean;
  }): ModelRoute {
    const signals: RoutingSignals = extractRoutingSignals(input);
    return this.policy.route(signals);
  }
}

export function fallbackRoles(route: ModelRoute): ModelRole[] {
  const roles: ModelRole[] = [];
  if (route.role) roles.push(route.role);
  if (route.secondaryRole && route.secondaryRole !== route.role) {
    roles.push(route.secondaryRole);
  }
  if (!roles.includes("fast")) roles.push("fast");
  if (!roles.includes("main")) roles.push("main");
  return roles;
}
