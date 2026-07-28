// One workflow per DEPARTMENT, not per category.
//
// The 22 taxonomy categories collapse to 6 owning departments, and the flow a
// report runs is a property of WHO OWNS IT, not what it is: land in the owning
// department's queue, that department acts. Keying flows by category would mean
// 22 near-identical definitions, each re-hardcoding its department — the
// department is baked into a WorkflowStep's `approver`, so a single shared flow
// can't serve more than one department.
//
// There is deliberately NO clerk intake step here: retiring that gate is the
// whole point of the smart-intake build. The conversation vets the report well
// enough to route it straight through.
//
// Blake's DECISION D (auto-route vs. a light staff confirm for safety-critical
// reports) is the `confirmSafetyCritical` option below. Flipping it prepends a
// clerk review step for the categories that warrant a human look — no other
// change anywhere. Default is auto-route; flip it when Blake rules.

import type { WorkflowDefinition, WorkflowStep, StepApproval } from '../domain/types';
import {
  CATEGORIES,
  departmentFor,
  departmentFlowKey,
  type CategoryKey,
  type DepartmentKey,
} from './taxonomy';
import { TEMPLATE_FORM_CITY, formForCategory } from './forms';

export { departmentFlowKey };

/** Human-readable department names for flow titles. */
const DEPARTMENT_LABELS: Record<DepartmentKey, string> = {
  public_works: 'Public Works',
  code_enforcement: 'Code Enforcement',
  police: 'Police',
  parks_rec: 'Parks & Recreation',
  water_external: 'Illinois American Water (referred out)',
  clerk: 'City Clerk',
};

/**
 * Categories where a human should lay eyes on the report before it routes —
 * life-safety or property-damage situations where a mis-route costs more than
 * the confirm step does. Only consulted when `confirmSafetyCritical` is on.
 */
export const SAFETY_CRITICAL: ReadonlySet<CategoryKey> = new Set<CategoryKey>([
  'water_sewer',
  'flooding_drainage',
  'traffic_sign_signal',
  'tree_issue',
  'animal_concern',
]);

/**
 * Every category that routes to a department, for the template city. The flow's
 * review scope is the UNION of those categories' field keys: one definition
 * serves many forms, so the scope must cover any field that could appear. It's
 * a superset for any single submission — a department can only ever bounce
 * fields the submitted form actually has, since the desk offers those.
 */
function categoriesFor(department: DepartmentKey): CategoryKey[] {
  return CATEGORIES.map((c) => c.key).filter(
    (key) => departmentFor(TEMPLATE_FORM_CITY, key) === department,
  );
}

function scopeFor(department: DepartmentKey): string[] {
  const keys = new Set<string>();
  for (const category of categoriesFor(department)) {
    for (const field of formForCategory(category).fields) keys.add(field.key);
  }
  return [...keys];
}

/** The staff confirm gate — only prepended when decision D says to. */
function clerkStep(scope: string[]): WorkflowStep {
  return {
    key: 'intake',
    title: 'Intake review',
    approvals: [{ approver: 'clerk', scope }],
  };
}

function departmentalStep(department: DepartmentKey, scope: string[]): WorkflowStep {
  const approval: StepApproval = { approver: department, scope };
  return {
    key: 'departmental',
    title: `${DEPARTMENT_LABELS[department]} review`,
    approvals: [approval],
  };
}

export interface FlowOptions {
  /**
   * Decision D. When true, safety-critical categories get a clerk review step
   * before the department sees them. Default false = route direct.
   */
  confirmSafetyCritical?: boolean;
}

/**
 * Build the workflow for a department. `category` only matters when the confirm
 * gate is on — it decides whether this particular report is safety-critical.
 */
export function buildDepartmentFlow(
  department: DepartmentKey,
  opts: FlowOptions = {},
  category?: CategoryKey,
): WorkflowDefinition {
  const scope = scopeFor(department);
  const steps: WorkflowStep[] = [departmentalStep(department, scope)];

  if (opts.confirmSafetyCritical && category && SAFETY_CRITICAL.has(category)) {
    steps.unshift(clerkStep(scope));
  }

  return {
    id: `wf-${department}`,
    key: departmentFlowKey(department),
    title: `${DEPARTMENT_LABELS[department]} flow`,
    version: 1,
    steps,
  };
}

/** Every distinct department that owns at least one category, template city. */
export function allDepartments(): DepartmentKey[] {
  const seen = new Set<DepartmentKey>();
  for (const c of CATEGORIES) seen.add(departmentFor(TEMPLATE_FORM_CITY, c.key));
  return [...seen];
}

/** Every department flow — what the seed script writes. */
export function allDepartmentFlows(opts: FlowOptions = {}): WorkflowDefinition[] {
  return allDepartments().map((d) => buildDepartmentFlow(d, opts));
}
