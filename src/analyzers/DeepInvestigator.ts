import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import MultiProjectScanner, { Workspace, DetectedProject } from './MultiProjectScanner.js';
import DataFlowTracer, { DataFlowTrace } from './DataFlowTracer.js';

/**
 * Investigation result
 */
export interface InvestigationResult {
  taskId: string;
  confidence: number;
  summary: string;
  
  // What we understood from the task
  understanding: TaskUnderstanding;
  
  // What we found in the code
  findings: CodeFinding[];
  
  // Data flow analysis
  dataFlow?: DataFlowTrace;
  
  // Related bugs/issues found
  relatedIssues: RelatedIssue[];
  
  // Recommended actions
  actions: RecommendedAction[];
  
  // Uncertainties and questions
  uncertainties: string[];
}

export interface TaskUnderstanding {
  type: 'bug' | 'feature' | 'improvement' | 'refactoring' | 'unknown';
  layer: 'frontend' | 'backend' | 'api' | 'database' | 'multiple' | 'unknown';
  concepts: ExtractedConcept[];
  constraints: string[];
  expectedBehavior: string;
  actualBehavior?: string;
}

export interface ExtractedConcept {
  name: string;
  type: 'entity' | 'field' | 'action' | 'page' | 'calculation' | 'status';
  importance: 'critical' | 'important' | 'mentioned';
  searchTerms: string[];
}

export interface CodeFinding {
  type: 'potential-bug' | 'related-code' | 'duplicate-logic' | 'missing-logic' | 'inconsistency';
  severity: 'high' | 'medium' | 'low';
  project: string;
  file: string;
  line?: number;
  description: string;
  code?: string;
  recommendation?: string;
}

export interface RelatedIssue {
  description: string;
  similarity: number;
  location: string;
}

export interface RecommendedAction {
  priority: number;
  type: 'investigate' | 'modify' | 'create' | 'review' | 'test';
  description: string;
  files: string[];
  reason: string;
}

/**
 * Deep Investigator
 * Performs comprehensive investigation of tasks, especially when information is vague
 */
export class DeepInvestigator {
  
  /**
   * Investigate a task deeply
   */
  async investigate(
    workspacePath: string,
    taskId: string,
    taskDescription: string,
    additionalContext?: {
      title?: string;
      comments?: string[];
      relatedTasks?: string[];
      asIs?: string;
      toBe?: string;
    }
  ): Promise<InvestigationResult> {
    logger.info(`Starting deep investigation for ${taskId}`);
    logger.info(`  Description length: ${taskDescription.length} chars`);
    
    // Step 1: Understand the task
    const understanding = this.understandTask(taskDescription, additionalContext);
    logger.info(`  Task type: ${understanding.type}, Layer: ${understanding.layer}`);
    logger.info(`  Extracted ${understanding.concepts.length} concepts`);
    
    // Step 2: Scan the workspace
    const workspace = await MultiProjectScanner.scanWorkspace(workspacePath);
    logger.info(`  Found ${workspace.projects.length} projects`);
    
    // Step 3: Trace data flow for key concepts
    let dataFlow: DataFlowTrace | undefined;
    const keySearchTerms = understanding.concepts
      .filter(c => c.importance !== 'mentioned')
      .flatMap(c => c.searchTerms);
    
    if (keySearchTerms.length > 0) {
      dataFlow = await DataFlowTracer.traceDataFlow(
        workspace,
        keySearchTerms,
        { taskDescription }
      );
      logger.info(`  Data flow: ${dataFlow.dataPoints.length} data points found`);
    }
    
    // Step 4: Find code related to concepts
    const findings = await this.findRelatedCode(workspace, understanding, dataFlow);
    logger.info(`  Found ${findings.length} code findings`);
    
    // Step 5: Detect inconsistencies and potential bugs
    const issues = this.detectIssues(findings, understanding, dataFlow);
    
    // Step 6: Generate recommended actions
    const actions = this.generateActions(understanding, findings, dataFlow);
    
    // Step 7: Identify uncertainties
    const uncertainties = this.identifyUncertainties(understanding, findings, dataFlow);
    
    // Calculate confidence
    const confidence = this.calculateConfidence(understanding, findings, dataFlow);
    
    // Generate summary
    const summary = this.generateSummary(understanding, findings, confidence);
    
    return {
      taskId,
      confidence,
      summary,
      understanding,
      findings,
      dataFlow,
      relatedIssues: issues,
      actions,
      uncertainties,
    };
  }
  
  /**
   * Understand what the task is asking for
   */
  private understandTask(
    description: string,
    context?: {
      title?: string;
      asIs?: string;
      toBe?: string;
      comments?: string[];
    }
  ): TaskUnderstanding {
    const fullText = [
      description,
      context?.title || '',
      context?.asIs || '',
      context?.toBe || '',
      ...(context?.comments || []),
    ].join(' ').toLowerCase();
    
    // Determine task type
    let type: TaskUnderstanding['type'] = 'unknown';
    if (this.matchesPatterns(fullText, ['bug', 'defect', 'error', 'wrong', 'incorrect', 'fix', 'broken'])) {
      type = 'bug';
    } else if (this.matchesPatterns(fullText, ['feature', 'implement', 'add', 'create', 'new'])) {
      type = 'feature';
    } else if (this.matchesPatterns(fullText, ['improve', 'enhance', 'optimize', 'refactor', 'cleanup'])) {
      type = 'improvement';
    }
    
    // Determine layer with more sophisticated analysis
    let layer: TaskUnderstanding['layer'] = 'unknown';
    
    // Strong frontend indicators - these suggest the bug is ONLY in frontend
    const strongFrontendIndicators = [
      'restricted to the', 'only in the', 'only on the',  // "restricted to the Catalogue Details page"
      'works correctly in', 'works in',                   // "In Orders view it works correctly"
      'not in the',                                        // Implies issue is NOT in some other place
    ];
    
    // Check for exclusive frontend patterns
    const hasExclusiveFrontend = strongFrontendIndicators.some(pattern => fullText.includes(pattern));
    
    // Standard frontend indicators
    const frontendKeywords = ['page', 'view', 'component', 'ui', 'display', 'screen', 'frontend', 'angular', 'react', 'catalogue', 'catalog', 'details page'];
    const hasFrontendKeywords = this.matchesPatterns(fullText, frontendKeywords);
    
    // Backend indicators  
    const backendKeywords = ['service', 'backend', 'server', 'endpoint', 'controller', 'repository', 'dao'];
    const hasBackendKeywords = this.matchesPatterns(fullText, backendKeywords);
    
    // Specific method/class mentioned (suggests backend)
    const hasSpecificCode = /\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\.[a-z]+\(/i.test(fullText);  // e.g., "OrderUtils.generateEstimatedDate()"
    
    // Database indicators
    const hasDatabaseKeywords = this.matchesPatterns(fullText, ['database', 'table', 'column', 'migration', 'entity', 'sql']);
    
    // Determine layer based on analysis
    if (hasExclusiveFrontend && hasFrontendKeywords && !hasSpecificCode) {
      // Strong indication this is frontend-only
      layer = 'frontend';
    } else if (hasFrontendKeywords && !hasBackendKeywords && !hasSpecificCode) {
      layer = 'frontend';
    } else if (hasBackendKeywords || hasSpecificCode) {
      layer = hasFrontendKeywords ? 'multiple' : 'backend';
    } else if (hasDatabaseKeywords) {
      layer = 'database';
    } else if (hasFrontendKeywords) {
      layer = 'frontend';
    }
    
    // Special case: if description says "works correctly" somewhere, the bug is likely NOT there
    if (fullText.includes('works correctly') && layer === 'unknown') {
      // Try to find what works correctly and invert
      if (fullText.includes('orders') && fullText.includes('works correctly')) {
        // Orders works -> bug is elsewhere (likely frontend page)
        layer = 'frontend';
      }
    }
    
    // Extract concepts
    const concepts = this.extractConcepts(fullText, description);
    
    // Extract constraints
    const constraints = this.extractConstraints(fullText);
    
    // Extract expected behavior
    const expectedBehavior = context?.toBe || this.extractExpectedBehavior(fullText);
    const actualBehavior = context?.asIs || this.extractActualBehavior(fullText);
    
    return {
      type,
      layer,
      concepts,
      constraints,
      expectedBehavior,
      actualBehavior,
    };
  }
  
  /**
   * Extract key concepts from task description
   */
  private extractConcepts(fullText: string, description: string): ExtractedConcept[] {
    const concepts: ExtractedConcept[] = [];
    
    // Extract entities (usually PascalCase or mentioned with "the X")
    const entityPatterns = [
      /\b(?:the\s+)?([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g,  // PascalCase
      /\b(?:the\s+)([a-z]+(?:\s+[a-z]+)?)\s+(?:table|entity|object|model)\b/gi,
    ];
    
    for (const pattern of entityPatterns) {
      let match;
      while ((match = pattern.exec(description)) !== null) {
        const name = match[1];
        if (name.length > 2 && !this.isCommonWord(name)) {
          concepts.push({
            name,
            type: 'entity',
            importance: 'important',
            searchTerms: this.generateSearchTerms(name),
          });
        }
      }
    }
    
    // Extract fields (usually mentioned with "field", "column", "property", "attribute")
    const fieldPatterns = [
      /\b([a-z][a-zA-Z]+(?:Date|Time|Id|Name|Status|Type|Value|Count|Amount))\b/g,
      /\b(?:field|column|property|attribute)\s+['""]?([a-zA-Z_]+)['""]?/gi,
      /\b([a-z]+_[a-z_]+)\b/g,  // snake_case
    ];
    
    for (const pattern of fieldPatterns) {
      let match;
      while ((match = pattern.exec(description)) !== null) {
        const name = match[1];
        if (name.length > 3 && !this.isCommonWord(name)) {
          concepts.push({
            name,
            type: 'field',
            importance: 'critical',
            searchTerms: this.generateSearchTerms(name),
          });
        }
      }
    }
    
    // Extract pages/views
    const pagePatterns = [
      /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:page|view|screen|tab)\b/gi,
      /\b(?:on|in)\s+(?:the\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/gi,
    ];
    
    for (const pattern of pagePatterns) {
      let match;
      while ((match = pattern.exec(description)) !== null) {
        const name = match[1];
        if (name.length > 2 && !this.isCommonWord(name)) {
          concepts.push({
            name,
            type: 'page',
            importance: 'important',
            searchTerms: this.generateSearchTerms(name),
          });
        }
      }
    }
    
    // Extract calculations/actions
    const actionPatterns = [
      /\b(calculat(?:e|ion)|comput(?:e|ation)|generat(?:e|ion))\s+(?:the\s+)?([a-zA-Z\s]+?)(?:\.|,|;|\s+is|\s+should)/gi,
    ];
    
    for (const pattern of actionPatterns) {
      let match;
      while ((match = pattern.exec(fullText)) !== null) {
        const action = match[1];
        const target = match[2]?.trim();
        if (target && target.length > 2) {
          concepts.push({
            name: target,
            type: 'calculation',
            importance: 'critical',
            searchTerms: this.generateSearchTerms(target),
          });
        }
      }
    }
    
    // Extract bug/fix indicators - CRITICAL for understanding what needs to change
    const bugFixIndicators = [
      // "use X instead of Y"
      /use\s+([a-zA-Z_.]+)\s+instead\s+of\s+([a-zA-Z_.]+)/gi,
      // "should be X not Y"
      /should\s+(?:be|use)\s+([a-zA-Z_.]+)\s+(?:not|instead\s+of)\s+([a-zA-Z_.]+)/gi,
      // "X is wrong" or "wrong X"
      /(?:wrong|incorrect)\s+([a-zA-Z_.]+)/gi,
      // "Today + X" or "now + X" patterns (date calculations)
      /(today|now|current\s*date)\s*\+\s*(\d+\s*(?:day|week|month)s?)/gi,
      // "when X is Y" (condition patterns)
      /when\s+([a-zA-Z_]+)\s+is\s+([A-Z_]+)/gi,
    ];
    
    for (const pattern of bugFixIndicators) {
      let match;
      while ((match = pattern.exec(fullText)) !== null) {
        const indicator = match[0];
        concepts.push({
          name: indicator,
          type: 'calculation',  // Bug indicators usually relate to calculations
          importance: 'critical',
          searchTerms: match.slice(1).filter(Boolean).map(s => s.trim()),
        });
      }
    }
    
    // Extract specific function/method mentions (e.g., "getLODueDate()", "calculateDate")
    const functionPatterns = [
      /\b(get[A-Z][a-zA-Z]+)\b/g,           // getFoo, getLODueDate
      /\b(calculate[A-Z][a-zA-Z]+)\b/g,     // calculateFoo
      /\b(compute[A-Z][a-zA-Z]+)\b/g,       // computeFoo
      /\b([a-z]+(?:Date|DueDate|DeliveryDate|EstimatedDate))\b/g, // specificDate
      /\b([a-zA-Z]+Utils)\b/g,               // FooUtils, OrderUtils
    ];
    
    for (const pattern of functionPatterns) {
      let match;
      while ((match = pattern.exec(description)) !== null) {
        const name = match[1];
        if (name.length > 4 && !this.isCommonWord(name)) {
          concepts.push({
            name,
            type: 'calculation',
            importance: 'critical',
            searchTerms: this.generateSearchTerms(name),
          });
        }
      }
    }
    
    // Deduplicate
    const seen = new Set<string>();
    return concepts.filter(c => {
      const key = c.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  
  /**
   * Generate search terms for a concept
   */
  private generateSearchTerms(name: string): string[] {
    const terms = new Set<string>();
    const clean = name.replace(/[^a-zA-Z0-9]/g, '');
    
    terms.add(clean.toLowerCase());
    
    // CamelCase
    terms.add(clean.charAt(0).toLowerCase() + clean.slice(1));
    
    // snake_case
    const snake = clean.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
    terms.add(snake);
    
    // With common prefixes/suffixes
    const cap = clean.charAt(0).toUpperCase() + clean.slice(1);
    terms.add(('get' + cap).toLowerCase());
    terms.add(('set' + cap).toLowerCase());
    terms.add(('calculate' + cap).toLowerCase());
    terms.add(('compute' + cap).toLowerCase());
    
    return [...terms];
  }
  
  /**
   * Extract constraints from task
   */
  private extractConstraints(text: string): string[] {
    const constraints: string[] = [];
    
    // "should" statements
    const shouldPattern = /should\s+([^.!?]+)/gi;
    let match;
    while ((match = shouldPattern.exec(text)) !== null) {
      constraints.push(`Should ${match[1].trim()}`);
    }
    
    // "must" statements
    const mustPattern = /must\s+([^.!?]+)/gi;
    while ((match = mustPattern.exec(text)) !== null) {
      constraints.push(`Must ${match[1].trim()}`);
    }
    
    // "never" statements
    const neverPattern = /never\s+([^.!?]+)/gi;
    while ((match = neverPattern.exec(text)) !== null) {
      constraints.push(`Never ${match[1].trim()}`);
    }
    
    return constraints;
  }
  
  /**
   * Extract expected behavior from task
   */
  private extractExpectedBehavior(text: string): string {
    // Look for "TO BE" or "expected" sections
    const toBePattern = /to\s*be[:\s]+([^.!?]+(?:[.!?]\s+[^.!?]+)*)/gi;
    const match = toBePattern.exec(text);
    if (match) return match[1].trim();
    
    const expectedPattern = /expected\s*(?:behavior|behaviour)?[:\s]+([^.!?]+)/gi;
    const expMatch = expectedPattern.exec(text);
    if (expMatch) return expMatch[1].trim();
    
    return '';
  }
  
  /**
   * Extract actual (buggy) behavior from task
   */
  private extractActualBehavior(text: string): string {
    // Look for "AS IS" or "current" sections
    const asIsPattern = /as\s*is[:\s]+([^.!?]+(?:[.!?]\s+[^.!?]+)*)/gi;
    const match = asIsPattern.exec(text);
    if (match) return match[1].trim();
    
    const currentPattern = /current(?:ly)?[:\s]+([^.!?]+)/gi;
    const currMatch = currentPattern.exec(text);
    if (currMatch) return currMatch[1].trim();
    
    return '';
  }
  
  /**
   * Check if text matches any patterns
   */
  private matchesPatterns(text: string, patterns: string[]): boolean {
    return patterns.some(p => text.includes(p));
  }
  
  /**
   * Check if word is too common to be meaningful
   */
  private isCommonWord(word: string): boolean {
    const common = [
      'the', 'and', 'for', 'with', 'from', 'that', 'this', 'have', 'will',
      'when', 'where', 'which', 'some', 'all', 'any', 'each', 'every',
      'data', 'value', 'item', 'list', 'array', 'object', 'string', 'number',
      'true', 'false', 'null', 'undefined', 'function', 'method', 'class',
    ];
    return common.includes(word.toLowerCase());
  }
  
  /**
   * Find code related to extracted concepts
   */
  private async findRelatedCode(
    workspace: Workspace,
    understanding: TaskUnderstanding,
    dataFlow?: DataFlowTrace
  ): Promise<CodeFinding[]> {
    const findings: CodeFinding[] = [];
    
    // Add findings from data flow analysis
    if (dataFlow) {
      for (const dp of dataFlow.dataPoints) {
        findings.push({
          type: 'related-code',
          severity: 'medium',
          project: dp.location.project,
          file: dp.location.file,
          line: dp.location.line,
          description: `Found reference to ${dp.name} in ${dp.location.layer} layer`,
        });
      }
      
      // Add duplicate logic warnings
      for (const dup of dataFlow.duplicateLogic) {
        findings.push({
          type: 'duplicate-logic',
          severity: dup.risk === 'high' ? 'high' : 'medium',
          project: dup.locations[0].project,
          file: dup.locations[0].file,
          description: dup.description,
          recommendation: 'Consider centralizing this logic to avoid inconsistencies',
        });
      }
    }
    
    return findings;
  }
  
  /**
   * Detect issues and inconsistencies
   */
  private detectIssues(
    findings: CodeFinding[],
    understanding: TaskUnderstanding,
    dataFlow?: DataFlowTrace
  ): RelatedIssue[] {
    const issues: RelatedIssue[] = [];
    
    // Check for layer mismatch
    if (understanding.layer === 'frontend' && !findings.some(f => f.file.includes('ui') || f.file.includes('component'))) {
      issues.push({
        description: 'Task mentions UI/frontend but no frontend code found',
        similarity: 60,
        location: 'Frontend project',
      });
    }
    
    return issues;
  }
  
  /**
   * Generate recommended actions
   */
  private generateActions(
    understanding: TaskUnderstanding,
    findings: CodeFinding[],
    dataFlow?: DataFlowTrace
  ): RecommendedAction[] {
    const actions: RecommendedAction[] = [];
    let priority = 1;
    
    // CRITICAL: If layer is frontend, recommend frontend files first
    if (understanding.layer === 'frontend') {
      // Find frontend-related findings
      const frontendFindings = findings.filter(f => 
        f.file.includes('ui') || 
        f.file.endsWith('.ts') || 
        f.file.endsWith('.tsx') ||
        f.file.endsWith('.vue') ||
        f.file.endsWith('.jsx')
      );
      
      if (frontendFindings.length > 0) {
        actions.push({
          priority: priority++,
          type: 'investigate',
          description: '⚠️ FRONTEND BUG: Investigate frontend files first',
          files: frontendFindings.slice(0, 5).map(f => f.file),
          reason: 'Task description indicates bug is in frontend/UI layer',
        });
      } else {
        actions.push({
          priority: priority++,
          type: 'investigate',
          description: '⚠️ FRONTEND BUG: Look for frontend project (e.g., *-ui, *-web, *-frontend)',
          files: [],
          reason: 'Bug appears to be in frontend but no frontend files found in current project. Check other projects in workspace.',
        });
      }
    }
    
    // If duplicate logic found, recommend centralizing
    const duplicates = findings.filter(f => f.type === 'duplicate-logic');
    if (duplicates.length > 0) {
      actions.push({
        priority: priority++,
        type: 'investigate',
        description: 'Investigate duplicate logic across projects',
        files: duplicates.map(d => d.file),
        reason: 'Same calculation in multiple places may cause inconsistencies',
      });
    }
    
    // If frontend-only calculation found
    if (dataFlow?.recommendations.some(r => r.includes('FRONTEND CALCULATION'))) {
      actions.push({
        priority: priority++,
        type: 'review',
        description: 'Review frontend calculations - consider moving to backend',
        files: dataFlow.dataPoints.filter(dp => dp.location.layer === 'ui').map(dp => dp.location.file),
        reason: 'Business logic in UI layer may cause inconsistencies',
      });
    }
    
    // Always add investigation action for vague tasks
    if (understanding.concepts.length < 2) {
      actions.push({
        priority: priority++,
        type: 'investigate',
        description: 'Gather more information about the task requirements',
        files: [],
        reason: 'Task description lacks specific technical details',
      });
    }
    
    // If layer detected as frontend but current project is backend
    if (understanding.layer === 'frontend') {
      actions.push({
        priority: priority++,
        type: 'investigate',
        description: 'Search for frontend project in workspace',
        files: [],
        reason: 'This task appears to be a frontend bug. Make sure you are analyzing the correct project.',
      });
    }
    
    return actions;
  }
  
  /**
   * Identify uncertainties that need clarification
   */
  private identifyUncertainties(
    understanding: TaskUnderstanding,
    findings: CodeFinding[],
    dataFlow?: DataFlowTrace
  ): string[] {
    const uncertainties: string[] = [];
    
    if (understanding.layer === 'unknown') {
      uncertainties.push('Unable to determine which layer (frontend/backend/database) is affected');
    }
    
    if (understanding.type === 'unknown') {
      uncertainties.push('Unable to determine if this is a bug fix, feature, or improvement');
    }
    
    if (understanding.concepts.length === 0) {
      uncertainties.push('No specific entities, fields, or concepts could be extracted from the description');
    }
    
    if (findings.length === 0) {
      uncertainties.push('No related code found - may need to search with different terms');
    }
    
    if (dataFlow && dataFlow.dataPoints.length > 0) {
      const projects = new Set(dataFlow.dataPoints.map(dp => dp.location.project));
      if (projects.size >= 2) {
        uncertainties.push(`Found in ${projects.size} projects - changes may be needed in multiple places`);
      }
    }
    
    return uncertainties;
  }
  
  /**
   * Calculate confidence in the investigation
   */
  private calculateConfidence(
    understanding: TaskUnderstanding,
    findings: CodeFinding[],
    dataFlow?: DataFlowTrace
  ): number {
    let confidence = 50;  // Base confidence
    
    // Increase for clear task type
    if (understanding.type !== 'unknown') confidence += 10;
    
    // Increase for clear layer
    if (understanding.layer !== 'unknown') confidence += 10;
    
    // Increase for extracted concepts
    confidence += Math.min(20, understanding.concepts.length * 5);
    
    // Increase for code findings
    confidence += Math.min(20, findings.length * 3);
    
    // Decrease for uncertainties
    if (understanding.concepts.length === 0) confidence -= 20;
    if (findings.length === 0) confidence -= 15;
    
    // Decrease for duplicate logic (indicates potential for bugs)
    const duplicates = findings.filter(f => f.type === 'duplicate-logic');
    if (duplicates.length > 0) confidence -= 10;
    
    return Math.max(0, Math.min(100, confidence));
  }
  
  /**
   * Generate investigation summary
   */
  private generateSummary(
    understanding: TaskUnderstanding,
    findings: CodeFinding[],
    confidence: number
  ): string {
    const parts: string[] = [];
    
    parts.push(`Task type: ${understanding.type}`);
    parts.push(`Affected layer: ${understanding.layer}`);
    parts.push(`Concepts identified: ${understanding.concepts.map(c => c.name).join(', ') || 'none'}`);
    parts.push(`Code findings: ${findings.length}`);
    parts.push(`Confidence: ${confidence}%`);
    
    return parts.join(' | ');
  }
}

export default new DeepInvestigator();
