import path from 'path';
import { logger } from '../utils/logger.js';
import { writeFile } from '../utils/file-utils.js';
import TaskInputParser, { ParsedTaskInput, TaskType } from './TaskInputParser.js';
import ProjectScanner from '../analyzers/ProjectScanner.js';
import TaskVerifier, { TaskVerificationResult } from '../analyzers/TaskVerifier.js';
import AIGuidanceGenerator, { AIInstructionSet } from '../analyzers/AIGuidanceGenerator.js';
import FilePolicy from './FilePolicy.js';
import { ExecutionContext, ParsedTask, TaskStatus, ProjectSnapshot } from './types.js';
import MultiProjectScanner, { Workspace, DetectedProject } from '../analyzers/MultiProjectScanner.js';
import DataFlowTracer, { DataFlowTrace } from '../analyzers/DataFlowTracer.js';
import DeepInvestigator, { InvestigationResult } from '../analyzers/DeepInvestigator.js';
import CrossReferenceMapper, { CrossReferenceMap } from '../analyzers/CrossReferenceMapper.js';

/**
 * Options for agent processing
 */
export interface AgentOptions {
  generateReports?: boolean;
  reportOutputDir?: string;
  singleReportFile?: boolean;
  skipBranchCreation?: boolean;
  verbose?: boolean;
  // New options for deep analysis
  deepInvestigation?: boolean;        // Enable full investigation mode
  multiProjectScan?: boolean;         // Scan parent directory for all projects
  traceDataFlow?: boolean;            // Trace data flow across layers
  crossReferenceMap?: boolean;        // Build cross-reference map
  investigationThreshold?: number;    // Confidence threshold to trigger investigation (default: 50)
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
  // Deep investigation results
  investigation?: InvestigationResult;
  dataFlow?: DataFlowTrace;
  crossReferences?: CrossReferenceMap;
  workspace?: Workspace;
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
    deepInvestigation: true,  // Enable deep investigation by default
    multiProjectScan: true,   // Scan for multiple projects
    traceDataFlow: true,      // Trace data flow
    crossReferenceMap: false, // Disabled by default (expensive)
    investigationThreshold: 50, // Trigger investigation when confidence < 50%
  };

  /**
   * Process any task input and decide what to do
   * This is the main entry point - just give it a task description
   */
  async process(taskInput: string, projectPath: string, options?: AgentOptions): Promise<AgentResponse> {
    const opts = { ...this.defaultOptions, ...options };
    
    logger.info('═'.repeat(60));
    logger.info('  AGENT ORCHESTRATOR - Deep Investigation Mode');
    logger.info('═'.repeat(60));
    
    const startTime = Date.now();
    
    try {
      // Step 1: Understand the task
      logger.info('\n📋 Step 1: Understanding task input...');
      const taskUnderstanding = TaskInputParser.parse(taskInput);
      this.logTaskUnderstanding(taskUnderstanding);
      
      // Step 2: Multi-project scan (if enabled)
      let workspace: Workspace | undefined;
      if (opts.multiProjectScan) {
        logger.info('\n🌐 Step 2: Scanning workspace for all projects...');
        const workspaceRoot = this.detectWorkspaceRoot(projectPath);
        workspace = await MultiProjectScanner.scanWorkspace(workspaceRoot);
        logger.info(`   Found ${workspace.projects.length} projects: ${workspace.projects.map(p => p.name).join(', ')}`);
        logger.info(`   Relationships: ${workspace.relationships.length} cross-project dependencies`);
      }
      
      // Step 3: Analyze the target project
      logger.info('\n🔍 Step 3: Analyzing target project...');
      const projectSnapshot = await ProjectScanner.scan(projectPath);
      const projectContext = this.summarizeProjectContext(projectSnapshot, taskUnderstanding);
      this.logProjectContext(projectContext);
      
      // Step 4: Create execution context
      const context = this.createContext(projectPath, taskUnderstanding, projectSnapshot);
      
      // Step 5: Verify if task is already implemented (PRECISE mode)
      logger.info('\n🔎 Step 4: Checking implementation status (precise)...');
      const verificationResult = await TaskVerifier.verify(context, taskUnderstanding.description);
      this.logVerificationResult(verificationResult);
      
      // Log excluded files
      if (verificationResult.excludedFiles.length > 0) {
        logger.info(`\n🚫 Excluded ${verificationResult.excludedFiles.length} files from modification suggestions:`);
        for (const excluded of verificationResult.excludedFiles.slice(0, 5)) {
          logger.info(`   - ${path.basename(excluded.file)}: ${excluded.reason}`);
        }
      }
      
      // Step 6: Deep investigation (if enabled and confidence is low)
      let investigation: InvestigationResult | undefined;
      let dataFlow: DataFlowTrace | undefined;
      let crossReferences: CrossReferenceMap | undefined;
      
      const needsDeepInvestigation = opts.deepInvestigation && (
        verificationResult.confidence < (opts.investigationThreshold || 50) ||
        verificationResult.status === 'NOT_IMPLEMENTED' ||
        verificationResult.status === 'NEEDS_REVIEW'
      );
      
      if (needsDeepInvestigation && workspace) {
        logger.info('\n🔬 Step 5: Deep investigation triggered...');
        
        // Run deep investigation
        investigation = await DeepInvestigator.investigate(
          this.detectWorkspaceRoot(projectPath),
          taskUnderstanding.id || 'TASK',
          taskInput,
          {
            title: taskUnderstanding.title,
            comments: [],
          }
        );
        logger.info(`   Investigation confidence: ${investigation.confidence}%`);
        logger.info(`   Findings: ${investigation.findings.length}`);
        logger.info(`   Uncertainties: ${investigation.uncertainties.length}`);
        
        // Trace data flow for key concepts
        if (opts.traceDataFlow && investigation.understanding.concepts.length > 0) {
          logger.info('\n📊 Step 5b: Tracing data flow...');
          const searchTerms = investigation.understanding.concepts
            .filter(c => c.importance !== 'mentioned')
            .flatMap(c => c.searchTerms)
            .slice(0, 10);
          
          dataFlow = await DataFlowTracer.traceDataFlow(workspace, searchTerms, { taskDescription: taskInput });
          logger.info(`   Data points: ${dataFlow.dataPoints.length}`);
          logger.info(`   Flow paths: ${dataFlow.flowPaths.length}`);
          logger.info(`   Duplicate logic: ${dataFlow.duplicateLogic.length}`);
        }
        
        // Build cross-reference map (expensive, optional)
        if (opts.crossReferenceMap) {
          logger.info('\n🔗 Step 5c: Building cross-reference map...');
          const focusTerms = investigation.understanding.concepts.map(c => c.name);
          crossReferences = await CrossReferenceMapper.buildCrossReferenceMap(workspace, focusTerms);
          logger.info(`   Total references: ${crossReferences.summary.totalReferences}`);
          logger.info(`   Cross-project refs: ${crossReferences.summary.crossProjectRefs}`);
        }
        
        // CRITICAL: Check for layer mismatch and suggest correct project
        if (investigation.understanding.layer === 'frontend') {
          const currentProjectType = workspace.projects.find(p => projectPath.includes(p.path))?.type;
          if (currentProjectType === 'backend' || currentProjectType === 'api') {
            // Find frontend projects in workspace
            const frontendProjects = workspace.projects.filter(p => 
              p.type === 'frontend' || 
              p.name.toLowerCase().includes('ui') ||
              p.name.toLowerCase().includes('web') ||
              p.name.toLowerCase().includes('frontend')
            );
            
            if (frontendProjects.length > 0) {
              logger.warn('\n' + '🚨'.repeat(30));
              logger.warn('🚨 LAYER MISMATCH DETECTED! 🚨');
              logger.warn(`🚨 Task appears to be a FRONTEND bug but you're analyzing BACKEND!`);
              logger.warn(`🚨 Suggested frontend project(s):`);
              frontendProjects.forEach(p => {
                logger.warn(`🚨   → ${p.name} (${p.path})`);
              });
              logger.warn('🚨'.repeat(30) + '\n');
            }
          }
        }
      }
      
      // Step 7: Make decision (enhanced with investigation results)
      logger.info('\n🧠 Step 6: Making decision...');
      const decision = this.makeDecision(taskUnderstanding, projectContext, verificationResult, investigation, dataFlow);
      this.logDecision(decision);
      
      // Step 8: Generate guidance if needed
      let instructions: AIInstructionSet | undefined;
      if (decision.action !== 'inform') {
        logger.info('\n📝 Step 7: Generating guidance...');
        instructions = await AIGuidanceGenerator.generate(context, verificationResult, taskUnderstanding.description);
      }
      
      // Step 9: Generate reports (enhanced with investigation data)
      const reports = await this.generateReports(
        projectPath, decision, verificationResult, instructions, opts,
        investigation, dataFlow, workspace
      );
      
      // Step 10: Determine next steps (enhanced)
      const nextSteps = this.determineNextSteps(decision, verificationResult, investigation, dataFlow);
      
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
      if (investigation) {
        logger.info(`Investigation findings: ${investigation.findings.length}`);
      }
      if (dataFlow) {
        logger.info(`Data flow paths: ${dataFlow.flowPaths.length}`);
      }
      
      return {
        success: true,
        decision,
        instructions,
        reports,
        nextSteps,
        investigation,
        dataFlow,
        crossReferences,
        workspace,
      };
      
    } catch (error) {
      logger.error('Agent processing failed:', error);
      throw error;
    }
  }

  /**
   * Detect the workspace root (parent directory with multiple projects)
   */
  private detectWorkspaceRoot(projectPath: string): string {
    // Check if parent directory has multiple project subdirectories
    const parentPath = path.dirname(projectPath);
    const projectName = path.basename(projectPath);
    
    // If the project name contains common patterns, parent might be workspace
    const workspaceIndicators = ['-api', '-ui', '-pms', '-tms', '-core', '-common', '-service'];
    if (workspaceIndicators.some(ind => projectName.toLowerCase().includes(ind))) {
      return parentPath;
    }
    
    // Default to project path itself
    return projectPath;
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
    verification: TaskVerificationResult,
    investigation?: InvestigationResult,
    dataFlow?: DataFlowTrace
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
    
    // Adjust based on deep investigation results
    if (investigation) {
      // If investigation found the bug in a different layer
      if (investigation.understanding.layer !== 'unknown') {
        reasoning += ` Layer detected: ${investigation.understanding.layer}.`;
      }
      
      // If duplicate logic was found
      if (dataFlow?.duplicateLogic && dataFlow.duplicateLogic.length > 0) {
        reasoning += ` WARNING: Duplicate logic found in ${dataFlow.duplicateLogic.length} locations.`;
        suggestedApproach.unshift('⚠️ Review duplicate logic across projects before making changes');
      }
      
      // If investigation has low confidence
      if (investigation.confidence < 50) {
        action = 'investigate';
        reasoning = `Investigation confidence is low (${investigation.confidence}%). More analysis needed.`;
        suggestedApproach = [
          ...investigation.uncertainties.map(u => `Clarify: ${u}`),
          'Gather more context from stakeholders',
          'Review related code manually',
          ...suggestedApproach,
        ];
      }
      
      // Add investigation-based actions
      for (const recAction of investigation.actions) {
        if (!suggestedApproach.includes(recAction.description)) {
          suggestedApproach.push(recAction.description);
        }
      }
    }
    
    const complexity = this.estimateComplexity(task, context, verification);
    const risks = this.identifyRisks(task, context, verification, investigation, dataFlow);
    
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
    verification: TaskVerificationResult,
    investigation?: InvestigationResult,
    dataFlow?: DataFlowTrace
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
    
    // Add risks from investigation
    if (investigation) {
      // CRITICAL: Detect layer mismatch
      const detectedLayer = investigation.understanding.layer;
      const currentProjectLang = context.language.toLowerCase();
      const isCurrentProjectBackend = ['java', 'kotlin', 'python', 'go', 'c#'].some(lang => 
        currentProjectLang.includes(lang)
      );
      const isCurrentProjectFrontend = ['typescript', 'javascript'].some(lang => 
        currentProjectLang.includes(lang)
      ) && (context.framework.toLowerCase().includes('angular') || 
            context.framework.toLowerCase().includes('react') ||
            context.framework.toLowerCase().includes('vue'));
      
      // CRITICAL WARNING: Task is frontend but we're analyzing backend
      if (detectedLayer === 'frontend' && isCurrentProjectBackend && !isCurrentProjectFrontend) {
        risks.unshift('🔴 CRITICAL MISMATCH: Task appears to be a FRONTEND bug but you are analyzing a BACKEND project!');
        risks.unshift('🔴 Look for a frontend project (e.g., *-ui, *-web, *-frontend) in the workspace');
      }
      
      // Warning: Task is backend but we're analyzing frontend
      if (detectedLayer === 'backend' && isCurrentProjectFrontend && !isCurrentProjectBackend) {
        risks.unshift('⚠️ MISMATCH: Task appears to be a BACKEND bug but you are analyzing a FRONTEND project');
      }
      
      // Multiple layers affected
      if (detectedLayer === 'multiple') {
        risks.push('Multiple layers affected (frontend/backend) - ensure consistency');
      }
      
      // Uncertainties from investigation
      for (const uncertainty of investigation.uncertainties.slice(0, 3)) {
        risks.push(`⚠️ ${uncertainty}`);
      }
    }
    
    // Add risks from data flow analysis
    if (dataFlow) {
      // Duplicate logic found
      if (dataFlow.duplicateLogic.length > 0) {
        risks.push(`🔴 CRITICAL: Same logic in ${dataFlow.duplicateLogic.length} locations - potential for inconsistent behavior`);
      }
      
      // Frontend-only calculations
      if (dataFlow.recommendations.some(r => r.includes('FRONTEND CALCULATION'))) {
        risks.push('Business logic in frontend - may cause sync issues with backend');
      }
      
      // Multi-project data
      const projects = new Set(dataFlow.dataPoints.map(dp => dp.location.project));
      if (projects.size >= 2) {
        risks.push(`Changes may be needed in ${projects.size} projects: ${[...projects].join(', ')}`);
      }
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
    options?: AgentOptions,
    investigation?: InvestigationResult,
    dataFlow?: DataFlowTrace,
    workspace?: Workspace
  ): Promise<AgentResponse['reports']> {
    if (options?.generateReports === false) {
      return { summary: '' };
    }

    const outputDir = options?.reportOutputDir || projectPath;
    const taskId = decision.details.taskUnderstanding.id || 'task';
    
    // Single combined report (default)
    if (options?.singleReportFile !== false) {
      const combinedReport = this.generateCombinedReport(
        decision, verification, instructions, investigation, dataFlow, workspace
      );
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
    instructions?: AIInstructionSet,
    investigation?: InvestigationResult,
    dataFlow?: DataFlowTrace,
    workspace?: Workspace
  ): string {
    const task = decision.details.taskUnderstanding;
    const context = decision.details.projectContext;
    
    // Check for critical alerts
    const criticalRisks = decision.details.risks.filter(r => r.includes('CRITICAL') || r.includes('MISMATCH'));
    const hasCriticalAlerts = criticalRisks.length > 0;
    
    // Detect layer for display
    const detectedLayer = investigation?.understanding.layer || 'unknown';
    
    let report = `# Task Analysis Report

> Task: ${task.id || 'N/A'} | Generated: ${new Date().toISOString()}
`;

    // Add critical alerts section at the very top if needed
    if (hasCriticalAlerts) {
      report += `
## 🚨 CRITICAL ALERTS

${criticalRisks.map(r => `**${r}**`).join('\n\n')}

---
`;
    }

    // Add layer detection info
    if (detectedLayer !== 'unknown') {
      report += `
> **Detected Layer**: ${detectedLayer.toUpperCase()} | **Current Project**: ${context.language} / ${context.framework}
`;
    }

    report += `
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

${this.deduplicateEvidence(verification.evidence).slice(0, 8).map(e => 
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

    // Add workspace analysis section if available
    if (workspace && workspace.projects.length > 1) {
      report += `
---

## Workspace Analysis

**Workspace Root**: ${workspace.rootPath}

### Projects Found (${workspace.projects.length})
| Project | Type | Language | Framework |
|---------|------|----------|-----------|
${workspace.projects.map(p => 
  `| ${p.name} | ${p.type} | ${p.language} | ${p.framework || '-'} |`
).join('\n')}

### Cross-Project Dependencies
${workspace.relationships.length > 0 
  ? workspace.relationships.slice(0, 10).map(r => `- ${r.from} → ${r.to} (${r.type})`).join('\n')
  : '_No cross-project dependencies detected_'}
`;
    }

    // Add deep investigation section if available
    if (investigation) {
      report += `
---

## Deep Investigation Results

**Investigation Confidence**: ${investigation.confidence}%

### Task Understanding
- **Type**: ${investigation.understanding.type}
- **Layer**: ${investigation.understanding.layer}
- **Expected Behavior**: ${investigation.understanding.expectedBehavior || '_Not specified_'}
- **Actual Behavior**: ${investigation.understanding.actualBehavior || '_Not specified_'}

### Extracted Concepts
${investigation.understanding.concepts.length > 0
  ? investigation.understanding.concepts.slice(0, 10).map(c => 
    `- **${c.name}** (${c.type}, ${c.importance})`
  ).join('\n')
  : '_No specific concepts extracted_'}

### Code Findings (${investigation.findings.length})
${investigation.findings.slice(0, 8).map(f => 
  `- **[${f.severity.toUpperCase()}]** ${f.type}: ${f.description}
    - File: \`${f.file}\`${f.recommendation ? `\n    - Recommendation: ${f.recommendation}` : ''}`
).join('\n') || '_No findings_'}

### Uncertainties
${investigation.uncertainties.length > 0
  ? investigation.uncertainties.map(u => `- ❓ ${u}`).join('\n')
  : '_No uncertainties identified_'}

### Recommended Actions
${investigation.actions.slice(0, 5).map((a, i) => 
  `${i + 1}. **[${a.type.toUpperCase()}]** ${a.description}
     - Reason: ${a.reason}
     - Files: ${a.files.length > 0 ? a.files.slice(0, 3).map(f => `\`${path.basename(f)}\``).join(', ') : '_none_'}`
).join('\n') || '_No actions recommended_'}
`;
    }

    // Add data flow analysis section if available
    if (dataFlow) {
      report += `
---

## Data Flow Analysis

**Query**: ${dataFlow.query}

### Data Points Found (${dataFlow.dataPoints.length})
${dataFlow.dataPoints.slice(0, 10).map(dp => 
  `- \`${dp.name}\` in **${dp.location.project}** → ${dp.location.layer} layer
    - File: \`${dp.location.file}\`${dp.location.line ? `:${dp.location.line}` : ''}`
).join('\n') || '_No data points found_'}

### Flow Paths (${dataFlow.flowPaths.length})
${dataFlow.flowPaths.map(fp => 
  `**${fp.description}**
${fp.steps.map(s => `  ${s.order}. ${s.project}: ${s.action}`).join('\n')}`
).join('\n\n') || '_No flow paths detected_'}

${dataFlow.duplicateLogic.length > 0 ? `
### ⚠️ DUPLICATE LOGIC DETECTED (${dataFlow.duplicateLogic.length})

${dataFlow.duplicateLogic.map(dup => 
  `**${dup.description}** (Risk: ${dup.risk})
${dup.locations.map(l => `  - ${l.project}: \`${l.file}\``).join('\n')}`
).join('\n\n')}
` : ''}

### Recommendations
${dataFlow.recommendations.map(r => `- ${r}`).join('\n') || '_None_'}
`;
    }

    report += `
---
_Generated by Task Automation Engine - Deep Investigation Mode_
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
  private determineNextSteps(
    decision: AgentDecision,
    verification: TaskVerificationResult,
    investigation?: InvestigationResult,
    dataFlow?: DataFlowTrace
  ): string[] {
    const steps: string[] = [];
    
    // Add warning if duplicate logic found
    if (dataFlow?.duplicateLogic && dataFlow.duplicateLogic.length > 0) {
      steps.push('⚠️ IMPORTANT: Duplicate logic detected - check all locations before implementing');
    }
    
    // Add warning if multi-project
    if (dataFlow) {
      const projects = new Set(dataFlow.dataPoints.map(dp => dp.location.project));
      if (projects.size >= 2) {
        steps.push(`⚠️ Changes may be needed in ${projects.size} projects: ${[...projects].join(', ')}`);
      }
    }
    
    switch (decision.action) {
      case 'implement':
        steps.push('Review the generated guidance document');
        steps.push('Identify all files that need modification');
        if (investigation?.understanding.layer === 'multiple') {
          steps.push('⚠️ This affects multiple layers - coordinate frontend and backend changes');
        }
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
        if (investigation?.uncertainties && investigation.uncertainties.length > 0) {
          steps.push(`Clarify uncertainties: ${investigation.uncertainties.slice(0, 3).join('; ')}`);
        }
        steps.push('Document findings');
        steps.push('Create implementation plan');
        break;
    }
    
    // Add investigation-specific next steps
    if (investigation?.actions) {
      for (const action of investigation.actions.slice(0, 3)) {
        if (!steps.some(s => s.includes(action.description))) {
          steps.push(`[${action.type.toUpperCase()}] ${action.description}`);
        }
      }
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

  /**
   * Deduplicate evidence by file and description to avoid repetitive output
   * Keeps the highest confidence evidence for each unique file
   */
  private deduplicateEvidence(evidence: TaskVerificationResult['evidence']): TaskVerificationResult['evidence'] {
    const seen = new Map<string, TaskVerificationResult['evidence'][0]>();
    
    for (const e of evidence) {
      // Create a unique key based on file and simplified description
      const key = `${path.basename(e.file)}:${e.type}`;
      const existing = seen.get(key);
      
      // Keep the one with higher confidence, or the first one if equal
      if (!existing || e.confidence > existing.confidence) {
        seen.set(key, e);
      }
    }
    
    // Sort by confidence (highest first)
    return Array.from(seen.values()).sort((a, b) => b.confidence - a.confidence);
  }
}

export default new AgentOrchestrator();
