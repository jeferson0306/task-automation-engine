import path from 'path';
import { logger } from '../utils/logger.js';
import { writeFile } from '../utils/file-utils.js';
import TaskInputParser, { ParsedTaskInput, TaskType } from './TaskInputParser.js';
import ProjectScanner from '../analyzers/ProjectScanner.js';
import TaskVerifier, { TaskVerificationResult } from '../analyzers/TaskVerifier.js';
import AIGuidanceGenerator, { AIInstructionSet } from '../analyzers/AIGuidanceGenerator.js';
import FilePolicy from './FilePolicy.js';
import { ExecutionContext, ParsedTask, TaskStatus, ProjectSnapshot } from './types.js';

/**
 * Options for agent processing
 */
export interface AgentOptions {
  generateReports?: boolean;
  reportOutputDir?: string;
  singleReportFile?: boolean;
  skipBranchCreation?: boolean;
  verbose?: boolean;
}

/**
 * Agent decision on what to do
 */
export interface AgentDecision {
  action: 'implement' | 'complete' | 'review' | 'test' | 'fix' | 'inform' | 'investigate';
  confidence: number;
  reasoning: string;
  details: {
    taskUnderstanding: ParsedTaskInput;
    projectContext: ProjectContextSummary;
    verificationResult?: TaskVerificationResult;
    suggestedApproach: string[];
    risks: string[];
    estimatedComplexity: 'trivial' | 'simple' | 'moderate' | 'complex' | 'very_complex';
  };
}

/**
 * Project context summary
 */
export interface ProjectContextSummary {
  language: string;
  framework: string;
  testFramework: string;
  buildTool: string;
  totalFiles: number;
  relevantFiles: string[];
  existingPatterns: string[];
  potentialConflicts: string[];
}

/**
 * Complete agent response
 */
export interface AgentResponse {
  success: boolean;
  decision: AgentDecision;
  instructions?: AIInstructionSet;
  reports: {
    summary: string;
    verification?: string;
    guidance?: string;
  };
  nextSteps: string[];
}

/**
 * Agent Orchestrator
 * 
 * The main brain of the automation engine.
 * Takes any task input and automatically:
 * 1. Understands what needs to be done
 * 2. Analyzes the target project  
 * 3. Determines current status (using PRECISE file matching)
 * 4. Decides on action
 * 5. Provides guidance (respecting file policies)
 * 
 * KEY PRINCIPLES:
 * - PRECISE: Only modifies files explicitly mentioned in task
 * - SAFE: Never suggests modifying migrations, locks, generated code
 * - MINIMAL: Generates minimal output (1 file by default)
 */
export class AgentOrchestrator {
  
  private defaultOptions: AgentOptions = {
    generateReports: true,
    singleReportFile: true,  // Only generate ONE file by default
    skipBranchCreation: true, // Don't create branches automatically
    verbose: false,
  };

  /**
   * Process any task input and decide what to do
   * This is the main entry point - just give it a task description
   */
  async process(taskInput: string, projectPath: string, options?: AgentOptions): Promise<AgentResponse> {
    const opts = { ...this.defaultOptions, ...options };
    
    logger.info('═'.repeat(60));
    logger.info('  AGENT ORCHESTRATOR - Precise Mode');
    logger.info('═'.repeat(60));
    
    const startTime = Date.now();
    
    try {
      // Step 1: Understand the task
      logger.info('\n📋 Step 1: Understanding task input...');
      const taskUnderstanding = TaskInputParser.parse(taskInput);
      this.logTaskUnderstanding(taskUnderstanding);
      
      // Step 2: Analyze the project
      logger.info('\n🔍 Step 2: Analyzing project (light scan)...');
      const projectSnapshot = await ProjectScanner.scan(projectPath);
      const projectContext = this.summarizeProjectContext(projectSnapshot, taskUnderstanding);
      this.logProjectContext(projectContext);
      
      // Step 3: Create execution context
      const context = this.createContext(projectPath, taskUnderstanding, projectSnapshot);
      
      // Step 4: Verify if task is already implemented (PRECISE mode)
      logger.info('\n🔎 Step 3: Checking implementation status (precise)...');
      const verificationResult = await TaskVerifier.verify(context, taskUnderstanding.description);
      this.logVerificationResult(verificationResult);
      
      // Log excluded files
      if (verificationResult.excludedFiles.length > 0) {
        logger.info(`\n🚫 Excluded ${verificationResult.excludedFiles.length} files from modification suggestions:`);
        for (const excluded of verificationResult.excludedFiles.slice(0, 5)) {
          logger.info(`   - ${path.basename(excluded.file)}: ${excluded.reason}`);
        }
      }
      
      // Step 5: Make decision
      logger.info('\n🧠 Step 4: Making decision...');
      const decision = this.makeDecision(taskUnderstanding, projectContext, verificationResult);
      this.logDecision(decision);
      
      // Step 6: Generate guidance if needed
      let instructions: AIInstructionSet | undefined;
      if (decision.action !== 'inform') {
        logger.info('\n📝 Step 5: Generating guidance...');
        instructions = await AIGuidanceGenerator.generate(context, verificationResult, taskUnderstanding.description);
      }
      
      // Step 7: Generate reports (single file by default)
      const reports = await this.generateReports(projectPath, decision, verificationResult, instructions, opts);
      
      // Step 8: Determine next steps
      const nextSteps = this.determineNextSteps(decision, verificationResult);
      
      const duration = Date.now() - startTime;
      
      logger.info('\n' + '═'.repeat(60));
      logger.info('  PROCESSING COMPLETE');
      logger.info('═'.repeat(60));
      logger.info(`Duration: ${duration}ms`);
      logger.info(`Decision: ${decision.action.toUpperCase()}`);
      logger.info(`Confidence: ${decision.confidence}%`);
      if (verificationResult.preciseMatches.length > 0) {
        logger.info(`Precise matches: ${verificationResult.preciseMatches.length} files`);
      }
      
      return {
        success: true,
        decision,
        instructions,
        reports,
        nextSteps,
      };
      
    } catch (error) {
      logger.error('Agent processing failed:', error);
      throw error;
    }
  }

  /**
   * Quick analysis without full processing
   * Use this for fast checks
   */
  async quickAnalysis(taskInput: string, projectPath: string): Promise<{
    taskType: TaskType;
    isLikelyImplemented: boolean;
    confidence: number;
    summary: string;
  }> {
    const taskUnderstanding = TaskInputParser.parse(taskInput);
    const projectSnapshot = await ProjectScanner.scan(projectPath);
    const context = this.createContext(projectPath, taskUnderstanding, projectSnapshot);
    const verification = await TaskVerifier.verify(context, taskUnderstanding.description);
    
    return {
      taskType: taskUnderstanding.type,
      isLikelyImplemented: ['IMPLEMENTED', 'IMPLEMENTED_NOT_COMMITTED'].includes(verification.status),
      confidence: verification.confidence,
      summary: verification.summary,
    };
  }

  /**
   * Create execution context from parsed task
   */
  private createContext(projectPath: string, task: ParsedTaskInput, snapshot: ProjectSnapshot): ExecutionContext {
    const parsedTask: ParsedTask = {
      taskId: task.id || `TASK-${Date.now()}`,
      title: task.title,
      description: task.description,
      acceptanceCriteria: task.acceptanceCriteria,
      estimatedPoints: this.estimatePoints(task),
      projectPath,
      parsedAt: new Date().toISOString(),
      status: TaskStatus.PARSED,
    };

    return {
      task: parsedTask,
      workingDir: projectPath,
      branchName: '',
      phaseResults: new Map(),
      reports: new Map(),
      projectSnapshot: snapshot,
    };
  }

  /**
   * Summarize project context relevant to the task
   */
  private summarizeProjectContext(snapshot: ProjectSnapshot, task: ParsedTaskInput): ProjectContextSummary {
    const primaryLang = snapshot.detectedStack.languages[0]?.name || 'Unknown';
    const primaryFramework = snapshot.detectedStack.frameworks[0]?.name || 'None';
    
    // Find relevant files based on task keywords
    const relevantFiles: string[] = [];
    const keywords = [...task.keywords, ...task.relatedEntities, ...task.affectedAreas];
    
    for (const file of snapshot.files) {
      const fileName = file.path.toLowerCase();
      const content = (file.content || '').toLowerCase();
      
      for (const keyword of keywords) {
        if (fileName.includes(keyword.toLowerCase()) || content.includes(keyword.toLowerCase())) {
          relevantFiles.push(file.path);
          break;
        }
      }
    }
    
    // Detect test framework
    let testFramework = 'Unknown';
    let buildTool = 'Unknown';
    
    for (const dep of snapshot.dependencies) {
      const depLower = dep.name.toLowerCase();
      if (['junit', 'jest', 'pytest', 'mocha', 'vitest', 'jasmine'].includes(depLower)) {
        testFramework = dep.name;
      }
    }
    
    for (const config of snapshot.configFiles) {
      if (config.path.includes('pom.xml')) buildTool = 'Maven';
      else if (config.path.includes('build.gradle')) buildTool = 'Gradle';
      else if (config.path.includes('package.json')) buildTool = 'npm/yarn';
      else if (config.path.includes('requirements.txt') || config.path.includes('pyproject.toml')) buildTool = 'pip/poetry';
    }
    
    return {
      language: primaryLang,
      framework: primaryFramework,
      testFramework,
      buildTool,
      totalFiles: snapshot.totalFiles,
      relevantFiles: relevantFiles.slice(0, 20),
      existingPatterns: this.detectExistingPatterns(snapshot, task),
      potentialConflicts: this.detectPotentialConflicts(snapshot, task),
    };
  }

  /**
   * Detect existing patterns in the codebase related to task
   */
  private detectExistingPatterns(snapshot: ProjectSnapshot, task: ParsedTaskInput): string[] {
    const patterns: string[] = [];
    
    // Check for similar implementations
    for (const entity of task.relatedEntities) {
      const found = snapshot.files.some(f => 
        f.content?.includes(entity) || f.path.includes(entity)
      );
      if (found) {
        patterns.push(`Similar to: ${entity}`);
      }
    }
    
    return patterns.slice(0, 10);
  }

  /**
   * Detect potential conflicts
   */
  private detectPotentialConflicts(snapshot: ProjectSnapshot, task: ParsedTaskInput): string[] {
    const conflicts: string[] = [];
    
    // Check for files that might be affected
    for (const area of task.affectedAreas) {
      const affectedCount = snapshot.files.filter(f => 
        f.path.toLowerCase().includes(area.toLowerCase())
      ).length;
      
      if (affectedCount > 10) {
        conflicts.push(`Multiple files (${affectedCount}) in ${area} area might be affected`);
      }
    }
    
    return conflicts;
  }

  /**
   * Make decision based on all gathered information
   */
  private makeDecision(
    task: ParsedTaskInput,
    context: ProjectContextSummary,
    verification: TaskVerificationResult
  ): AgentDecision {
    let action: AgentDecision['action'];
    let reasoning: string;
    let suggestedApproach: string[] = [];
    
    // Decision logic based on verification status
    switch (verification.status) {
      case 'NOT_IMPLEMENTED':
        action = 'implement';
        reasoning = 'Task has not been implemented. Need to create new implementation.';
        suggestedApproach = [
          'Analyze requirements thoroughly',
          'Identify files to modify/create',
          'Follow existing code patterns',
          'Implement with tests',
          'Run validation pipeline',
        ];
        break;
        
      case 'PARTIALLY_IMPLEMENTED':
        action = 'complete';
        reasoning = 'Task is partially implemented. Need to complete the remaining work.';
        suggestedApproach = [
          'Review existing implementation',
          'Identify missing parts',
          'Complete implementation',
          'Add missing tests',
          'Validate against requirements',
        ];
        break;
        
      case 'IMPLEMENTED_NOT_COMMITTED':
        if (verification.testCoverage.hasTests) {
          action = 'review';
          reasoning = 'Implementation exists but is not committed. Review and commit.';
          suggestedApproach = [
            'Run all tests',
            'Review code quality',
            'Check against requirements',
            'Commit changes',
          ];
        } else {
          action = 'test';
          reasoning = 'Implementation exists but lacks tests. Add tests before committing.';
          suggestedApproach = [
            'Add unit tests',
            'Add integration tests if needed',
            'Run full test suite',
            'Review and commit',
          ];
        }
        break;
        
      case 'IMPLEMENTED':
        action = 'inform';
        reasoning = 'Task has already been implemented and committed.';
        suggestedApproach = [
          'Verify implementation meets requirements',
          'Check if improvements are needed',
        ];
        break;
        
      case 'NEEDS_REVIEW':
        action = 'review';
        reasoning = 'Implementation found but needs verification against requirements.';
        suggestedApproach = [
          'Review existing code',
          'Verify against acceptance criteria',
          'Add tests if missing',
          'Fix issues if found',
        ];
        break;
        
      default:
        action = 'investigate';
        reasoning = 'Unable to determine status. Manual investigation needed.';
        suggestedApproach = [
          'Manual code review',
          'Clarify requirements',
          'Determine approach',
        ];
    }
    
    // Adjust based on task type
    if (task.type === 'investigation') {
      action = 'investigate';
      reasoning = 'This is a spike/investigation task. Research needed before implementation.';
    }
    
    const complexity = this.estimateComplexity(task, context, verification);
    const risks = this.identifyRisks(task, context, verification);
    
    return {
      action,
      confidence: verification.confidence,
      reasoning,
      details: {
        taskUnderstanding: task,
        projectContext: context,
        verificationResult: verification,
        suggestedApproach,
        risks,
        estimatedComplexity: complexity,
      },
    };
  }

  /**
   * Estimate complexity
   */
  private estimateComplexity(
    task: ParsedTaskInput,
    context: ProjectContextSummary,
    verification: TaskVerificationResult
  ): AgentDecision['details']['estimatedComplexity'] {
    let score = 0;
    
    // Based on affected areas
    score += task.affectedAreas.length * 2;
    
    // Based on related entities
    score += task.relatedEntities.length;
    
    // Based on acceptance criteria
    score += task.acceptanceCriteria.length * 2;
    
    // Based on relevant files
    score += Math.min(context.relevantFiles.length, 10);
    
    // Based on task type
    if (task.type === 'feature') score += 5;
    if (task.type === 'refactor') score += 3;
    if (task.type === 'bug_fix') score += 2;
    
    if (score <= 5) return 'trivial';
    if (score <= 10) return 'simple';
    if (score <= 20) return 'moderate';
    if (score <= 35) return 'complex';
    return 'very_complex';
  }

  /**
   * Identify risks
   */
  private identifyRisks(
    task: ParsedTaskInput,
    context: ProjectContextSummary,
    verification: TaskVerificationResult
  ): string[] {
    const risks: string[] = [];
    
    if (context.relevantFiles.length === 0) {
      risks.push('No relevant files found - might need new file structure');
    }
    
    if (context.potentialConflicts.length > 0) {
      risks.push(...context.potentialConflicts);
    }
    
    if (!verification.testCoverage.hasTests) {
      risks.push('No existing tests - changes might break untested functionality');
    }
    
    if (task.priority === 'critical' || task.priority === 'high') {
      risks.push('High priority task - extra validation recommended');
    }
    
    if (task.confidence < 70) {
      risks.push('Low confidence in task parsing - verify understanding');
    }
    
    return risks;
  }

  /**
   * Estimate story points
   */
  private estimatePoints(task: ParsedTaskInput): number {
    let points = 1;
    
    if (task.type === 'feature') points += 3;
    if (task.type === 'refactor') points += 2;
    if (task.type === 'bug_fix') points += 1;
    
    points += Math.min(task.acceptanceCriteria.length, 5);
    points += Math.min(task.affectedAreas.length, 3);
    
    return Math.min(points, 13);
  }

  /**
   * Generate reports - by default generates SINGLE combined file
   */
  private async generateReports(
    projectPath: string,
    decision: AgentDecision,
    verification: TaskVerificationResult,
    instructions?: AIInstructionSet,
    options?: AgentOptions
  ): Promise<AgentResponse['reports']> {
    if (options?.generateReports === false) {
      return { summary: '' };
    }

    const outputDir = options?.reportOutputDir || projectPath;
    const taskId = decision.details.taskUnderstanding.id || 'task';
    
    // Single combined report (default)
    if (options?.singleReportFile !== false) {
      const combinedReport = this.generateCombinedReport(decision, verification, instructions);
      const reportPath = path.join(outputDir, `task-analysis-${taskId}.md`);
      await writeFile(reportPath, combinedReport);
      
      logger.info(`   📄 Report: ${reportPath}`);
      
      return {
        summary: reportPath,
      };
    }
    
    // Multiple reports (legacy behavior if explicitly requested)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    const summary = this.generateSummaryReport(decision, verification);
    const summaryPath = path.join(outputDir, `agent-summary-${timestamp}.md`);
    await writeFile(summaryPath, summary);
    
    let guidancePath: string | undefined;
    if (instructions) {
      const guidance = await AIGuidanceGenerator.generateMarkdown(instructions);
      guidancePath = path.join(outputDir, `agent-guidance-${timestamp}.md`);
      await writeFile(guidancePath, guidance);
    }
    
    return {
      summary: summaryPath,
      verification: summaryPath,
      guidance: guidancePath,
    };
  }

  /**
   * Generate a single combined report with all information
   */
  private generateCombinedReport(
    decision: AgentDecision,
    verification: TaskVerificationResult,
    instructions?: AIInstructionSet
  ): string {
    const task = decision.details.taskUnderstanding;
    const context = decision.details.projectContext;
    
    let report = `# Task Analysis Report

> Task: ${task.id || 'N/A'} | Generated: ${new Date().toISOString()}

## Status: ${verification.status} (${verification.confidence}% confidence)

**Action Required**: ${decision.action.toUpperCase()}

${decision.reasoning}

---

## Task Understanding

| Field | Value |
|-------|-------|
| Type | ${task.type} |
| Priority | ${task.priority} |
| Title | ${task.title.substring(0, 60)}${task.title.length > 60 ? '...' : ''} |

### Description
${task.description.substring(0, 500)}${task.description.length > 500 ? '...' : ''}

### Acceptance Criteria
${task.acceptanceCriteria.length > 0 ? task.acceptanceCriteria.map(c => `- [ ] ${c}`).join('\n') : '_None specified_'}

---

## Files Analysis

### Files to Modify (${verification.relatedFiles.length})
${verification.relatedFiles.length > 0 
  ? verification.relatedFiles.slice(0, 10).map(f => `- \`${f}\``).join('\n')
  : '_No files identified_'}

### Excluded Files (${verification.excludedFiles.length})
${verification.excludedFiles.length > 0
  ? verification.excludedFiles.slice(0, 5).map(e => `- ~~\`${path.basename(e.file)}\`~~ - ${e.reason}`).join('\n')
  : '_None excluded_'}

### Code References Found
${verification.codeReferences.classes.length > 0 || verification.codeReferences.methods.length > 0
  ? `- Classes: ${verification.codeReferences.classes.join(', ') || 'none'}
- Methods: ${verification.codeReferences.methods.join(', ') || 'none'}`
  : '_No specific code references extracted_'}

---

## Evidence

${verification.evidence.slice(0, 8).map(e => 
  `- **[${e.type}]** \`${path.basename(e.file)}\`${e.line ? `:${e.line}` : ''} - ${e.description}`
).join('\n') || '_No evidence found_'}

---

## Recommended Steps

${decision.details.suggestedApproach.map((s, i) => `${i + 1}. ${s}`).join('\n')}

${decision.details.risks.length > 0 ? `
### Risks
${decision.details.risks.map(r => `- ⚠️ ${r}`).join('\n')}` : ''}

---

## Test Coverage

- **Has Tests**: ${verification.testCoverage.hasTests ? '✅ Yes' : '❌ No'}
- **Status**: ${verification.testCoverage.coverageStatus}
${verification.testCoverage.testFiles.length > 0 
  ? `- **Test Files**: ${verification.testCoverage.testFiles.slice(0, 3).map(f => path.basename(f)).join(', ')}`
  : ''}

`;

    // Add guidance section if available
    if (instructions) {
      const filesToModify = instructions.implementation.filesToModify;
      const filesToCreate = instructions.implementation.filesToCreate;
      const validationChecks = instructions.validation.manualChecks;
      
      report += `
---

## Implementation Guidance

### Summary
Status: ${instructions.summary.status} | Action: ${instructions.summary.action} | Complexity: ${instructions.summary.estimatedComplexity}

### Files to Modify
${filesToModify.slice(0, 5).map((f: { path: string; reason: string }) => `- \`${f.path}\` - ${f.reason}`).join('\n') || '_None_'}

### Files to Create
${filesToCreate.slice(0, 3).map((f: { suggestedPath: string; purpose: string }) => `- \`${f.suggestedPath}\` - ${f.purpose}`).join('\n') || '_None_'}

### Step-by-Step Instructions
${instructions.steps.slice(0, 10).map((s: { description: string }, i: number) => `${i + 1}. ${s.description}`).join('\n')}

### Validation Checklist
${validationChecks.slice(0, 5).map((v: string) => `- [ ] ${v}`).join('\n')}
`;
    }

    report += `
---
_Generated by Task Automation Engine - Precise Mode_
`;

    return report;
  }

  /**
   * Generate summary report
   */
  private generateSummaryReport(decision: AgentDecision, verification: TaskVerificationResult): string {
    const task = decision.details.taskUnderstanding;
    const context = decision.details.projectContext;
    
    return `# Agent Analysis Summary

> Generated: ${new Date().toISOString()}

## Task Understanding

- **ID**: ${task.id || 'N/A'}
- **Title**: ${task.title}
- **Type**: ${task.type}
- **Priority**: ${task.priority}
- **Source Format**: ${task.sourceFormat}
- **Parse Confidence**: ${task.confidence}%

### Description
${task.description.substring(0, 1000)}${task.description.length > 1000 ? '...' : ''}

### Acceptance Criteria
${task.acceptanceCriteria.length > 0 ? task.acceptanceCriteria.map(c => `- [ ] ${c}`).join('\n') : 'None specified'}

### Related Entities
${task.relatedEntities.slice(0, 10).map(e => `- ${e}`).join('\n') || 'None detected'}

## Project Context

- **Language**: ${context.language}
- **Framework**: ${context.framework}
- **Test Framework**: ${context.testFramework}
- **Build Tool**: ${context.buildTool}
- **Total Files**: ${context.totalFiles}

### Relevant Files
${context.relevantFiles.slice(0, 10).map(f => `- ${f}`).join('\n') || 'None identified'}

## Verification Result

- **Status**: ${verification.status}
- **Confidence**: ${verification.confidence}%
- **Summary**: ${verification.summary}

### Evidence
${verification.evidence.slice(0, 5).map(e => `- [${e.type}] ${e.file}: ${e.description}`).join('\n') || 'No evidence found'}

### Test Coverage
- **Has Tests**: ${verification.testCoverage.hasTests ? 'Yes' : 'No'}
- **Coverage Status**: ${verification.testCoverage.coverageStatus}

## Decision

- **Action**: ${decision.action.toUpperCase()}
- **Confidence**: ${decision.confidence}%
- **Complexity**: ${decision.details.estimatedComplexity}

### Reasoning
${decision.reasoning}

### Suggested Approach
${decision.details.suggestedApproach.map((s, i) => `${i + 1}. ${s}`).join('\n')}

### Risks
${decision.details.risks.length > 0 ? decision.details.risks.map(r => `- ⚠️ ${r}`).join('\n') : 'No significant risks identified'}

---
Generated by Task Automation Engine
`;
  }

  /**
   * Determine next steps based on decision
   */
  private determineNextSteps(decision: AgentDecision, verification: TaskVerificationResult): string[] {
    const steps: string[] = [];
    
    switch (decision.action) {
      case 'implement':
        steps.push('Review the generated guidance document');
        steps.push('Identify all files that need modification');
        steps.push('Implement changes following existing patterns');
        steps.push('Add comprehensive tests');
        steps.push('Run full test suite');
        steps.push('Perform code review');
        break;
        
      case 'complete':
        steps.push('Review existing partial implementation');
        steps.push('Identify remaining work');
        steps.push('Complete implementation');
        steps.push('Add missing tests');
        break;
        
      case 'review':
        steps.push('Review existing implementation');
        steps.push('Verify against acceptance criteria');
        steps.push('Run tests');
        if (verification.gitChanges.length > 0) {
          steps.push('Commit changes if verified');
        }
        break;
        
      case 'test':
        steps.push('Add unit tests for implementation');
        steps.push('Add integration tests if applicable');
        steps.push('Run full test suite');
        steps.push('Review test coverage');
        break;
        
      case 'inform':
        steps.push('Verify implementation meets all requirements');
        steps.push('Check if any improvements are needed');
        steps.push('Close task if complete');
        break;
        
      case 'investigate':
        steps.push('Research the topic thoroughly');
        steps.push('Document findings');
        steps.push('Create implementation plan');
        break;
    }
    
    return steps;
  }

  /**
   * Logging helpers
   */
  private logTaskUnderstanding(task: ParsedTaskInput): void {
    logger.info(`   Type: ${task.type}`);
    logger.info(`   Priority: ${task.priority}`);
    logger.info(`   Title: ${task.title.substring(0, 80)}...`);
    logger.info(`   Entities: ${task.relatedEntities.slice(0, 5).join(', ')}`);
    logger.info(`   Keywords: ${task.keywords.slice(0, 5).join(', ')}`);
    logger.info(`   Confidence: ${task.confidence}%`);
  }

  private logProjectContext(context: ProjectContextSummary): void {
    logger.info(`   Language: ${context.language}`);
    logger.info(`   Framework: ${context.framework}`);
    logger.info(`   Files: ${context.totalFiles}`);
    logger.info(`   Relevant: ${context.relevantFiles.length} files`);
  }

  private logVerificationResult(result: TaskVerificationResult): void {
    logger.info(`   Status: ${result.status}`);
    logger.info(`   Confidence: ${result.confidence}%`);
    logger.info(`   Evidence: ${result.evidence.length} items`);
    logger.info(`   Git Changes: ${result.gitChanges.length} files`);
  }

  private logDecision(decision: AgentDecision): void {
    logger.info(`   Action: ${decision.action.toUpperCase()}`);
    logger.info(`   Reasoning: ${decision.reasoning}`);
    logger.info(`   Complexity: ${decision.details.estimatedComplexity}`);
    logger.info(`   Risks: ${decision.details.risks.length}`);
  }
}

export default new AgentOrchestrator();
