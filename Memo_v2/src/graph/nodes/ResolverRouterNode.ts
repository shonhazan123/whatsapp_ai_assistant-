/**
 * ResolverRouterNode
 * 
 * Routes PlanSteps to appropriate Resolvers based on capability and action.
 * Builds a dependency DAG and determines parallel execution groups.
 * 
 * Responsibilities:
 * - Read plan from PlannerOutput
 * - Build dependency graph from depends_on
 * - Determine which steps can run in parallel
 * - Route each step to the correct resolver
 * - Collect resolver results
 */

import type { PlanStep, ResolverResult } from '../../types/index.js';
import { findResolver, RESOLVER_REGISTRY } from '../resolvers/index.js';
import type { MemoState } from '../state/MemoState.js';
import { CodeNode } from './BaseNode.js';

// ============================================================================
// TYPES
// ============================================================================

interface ExecutionGroup {
  groupIndex: number;
  steps: PlanStep[];
  parallelizable: boolean;
}

interface RoutingResult {
  stepId: string;
  resolverName: string;
  result: ResolverResult;
}

// ============================================================================
// RESOLVER ROUTER NODE
// ============================================================================

export class ResolverRouterNode extends CodeNode {
  readonly name = 'resolver_router';

  protected async process(state: MemoState): Promise<Partial<MemoState>> {
    const plan = state.plannerOutput?.plan;
    
    if (!plan || plan.length === 0) {
      console.log('[ResolverRouter] No plan to execute');
      return {};
    }
    
    console.log(`[ResolverRouter] Processing ${plan.length} plan steps`);
    
    // Build execution groups based on dependencies
    const groups = this.buildExecutionGroups(plan);
    console.log(`[ResolverRouter] Created ${groups.length} execution groups`);
    
    // Process each group (parallel within group, sequential between groups)
    const allResults = new Map<string, ResolverResult>();
    
    for (const group of groups) {
      console.log(`[ResolverRouter] Executing group ${group.groupIndex} with ${group.steps.length} steps (parallel: ${group.parallelizable})`);
      
      const groupResults = await this.executeGroup(group, state);
      
      // Merge results
      for (const result of groupResults) {
        allResults.set(result.stepId, result.result);
      }
      
      // Check for clarification needs - interrupt happens inside resolver
      // If a resolver triggered interrupt(), the graph will pause here
    }
    
    return {
      resolverResults: allResults,
    };
  }
  
  /**
   * Build execution groups based on step dependencies
   * Steps in the same group have no interdependencies and can run in parallel
   */
  private buildExecutionGroups(plan: PlanStep[]): ExecutionGroup[] {
    const groups: ExecutionGroup[] = [];
    const completed = new Set<string>();
    const remaining = [...plan];
    let groupIndex = 0;
    
    while (remaining.length > 0) {
      // Find all steps whose dependencies are satisfied
      const ready = remaining.filter(step => 
        step.dependsOn.every(depId => completed.has(depId))
      );
      
      if (ready.length === 0) {
        // Circular dependency or missing dependency - execute one at a time
        console.warn('[ResolverRouter] Possible circular dependency, executing sequentially');
        const [next] = remaining.splice(0, 1);
        groups.push({
          groupIndex: groupIndex++,
          steps: [next],
          parallelizable: false,
        });
        completed.add(next.id);
        continue;
      }
      
      // Remove ready steps from remaining
      for (const step of ready) {
        const idx = remaining.indexOf(step);
        if (idx !== -1) remaining.splice(idx, 1);
        completed.add(step.id);
      }
      
      groups.push({
        groupIndex: groupIndex++,
        steps: ready,
        parallelizable: ready.length > 1,
      });
    }
    
    return groups;
  }
  
  /**
   * Execute a group of steps, potentially in parallel
   */
  private async executeGroup(
    group: ExecutionGroup,
    state: MemoState
  ): Promise<RoutingResult[]> {
    const results: RoutingResult[] = [];
    
    if (group.parallelizable) {
      // Execute in parallel
      const promises = group.steps.map(step => this.routeAndExecute(step, state));
      const settled = await Promise.allSettled(promises);
      
      for (let i = 0; i < settled.length; i++) {
        const result = settled[i];
        const step = group.steps[i];
        
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          console.error(`[ResolverRouter] Step ${step.id} failed:`, result.reason);
          results.push({
            stepId: step.id,
            resolverName: 'error',
            result: {
              stepId: step.id,
              type: 'execute',
              args: { error: result.reason?.message || 'Unknown error' },
            },
          });
        }
      }
    } else {
      // Execute sequentially
      for (const step of group.steps) {
        try {
          const result = await this.routeAndExecute(step, state);
          results.push(result);
        } catch (error) {
          console.error(`[ResolverRouter] Step ${step.id} failed:`, error);
          results.push({
            stepId: step.id,
            resolverName: 'error',
            result: {
              stepId: step.id,
              type: 'execute',
              args: { error: error instanceof Error ? error.message : 'Unknown error' },
            },
          });
        }
      }
    }
    
    return results;
  }
  
  /**
   * Route a single step to its resolver and execute
   */
  private async routeAndExecute(step: PlanStep, state: MemoState): Promise<RoutingResult> {
    const resolver = findResolver(step.capability, step.action);
    
    if (!resolver) {
      console.warn(`[ResolverRouter] No resolver found for ${step.capability}:${step.action}`);
      
      // Try to find a fallback resolver for the capability
      const fallbackResolvers = RESOLVER_REGISTRY.filter(r => r.capability === step.capability);
      
      if (fallbackResolvers.length > 0) {
        const fallback = fallbackResolvers[0];
        console.log(`[ResolverRouter] Using fallback resolver: ${fallback.name}`);
        
        const result = await fallback.resolve(step, state);
        return {
          stepId: step.id,
          resolverName: fallback.name,
          result,
        };
      }
      
      // No resolver at all - return error
      return {
        stepId: step.id,
        resolverName: 'none',
        result: {
          stepId: step.id,
          type: 'execute',
          args: { 
            error: `No resolver found for ${step.capability}:${step.action}`,
            _fallback: true,
          },
        },
      };
    }
    
    console.log(`[ResolverRouter] Routing ${step.id} to ${resolver.name}`);
    
    const result = await resolver.resolve(step, state);
    
    return {
      stepId: step.id,
      resolverName: resolver.name,
      result,
    };
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createResolverRouterNode() {
  const node = new ResolverRouterNode();
  return node.asNodeFunction();
}


