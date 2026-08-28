export type DetectedGate = "typecheck" | "lint" | "test" | "build";

export function detectQualityGates(packageJson: string | null): DetectedGate[] {
  if (!packageJson) return [];
  let scripts: Record<string, string> = {};
  try {
    const parsed = JSON.parse(packageJson) as { scripts?: Record<string, string> };
    scripts = parsed.scripts ?? {};
  } catch {
    return [];
  }
  const found: DetectedGate[] = [];
  if (scripts.typecheck) found.push("typecheck");
  if (scripts.lint) found.push("lint");
  if (scripts.test) found.push("test");
  if (scripts.build) found.push("build");
  return found;
}

export function gateScriptName(gate: DetectedGate): string {
  return gate;
}
