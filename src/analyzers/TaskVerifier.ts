import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import { logger } from '../utils/logger.js';
import { ExecutionContext, Task, ProjectSnapshot } from '../core/types.js';
import ProjectScanner from './ProjectScanner.js';

/**
 * Task implementation status
 */
export type TaskImplementationStatus = 
  | 'NOT_IMPLEMENTED'
  | 'PARTIALLY_IMPLEMENTED'
  | 'IMPLEMENTED'
  | 'IMPLEMENTED_NOT_COMMITTED'
  | 'NEEDS_REVIEW';

/**
 * Evidence of task implementation
 */
export interface TaskEvidence {
  type: 'code_match' | 'git_change' | 'task_reference' | 'test_coverage' | 'semantic_match';
  file: string;
  line?: number;
  snippet: string;
  confidence: number; // 0-100
  description: string;
}

/**
 * Git change information
 */
export interface GitChange {
  file: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked';
  staged: boolean;
  diff?: string;
}

/**
 * Task verification result
 */
export interface TaskVerificationResult {
  taskId: string;
  status: TaskImplementationStatus;
  confidence: number; // 0-100
  summary: string;
  evidence: TaskEvidence[];
  gitChanges: GitChange[];
  relatedFiles: string[];
  testCoverage: {
    hasTests: boolean;
    testFiles: string[];
    coverageStatus: 'covered' | 'partial' | 'uncovered';
  };
  recommendations: string[];
  aiGuidance: AIGuidance;
}

/**
 * Guidance for AI agents
 */
export interface AIGuidance {
  action: 'implement' | 'review' | 'test' | 'commit' | 'none';
  priority: 'high' | 'medium' | 'low';
  context: string;
  steps: string[];
  filesToModify: string[];
  filesToCreate: string[];
  warnings: string[];
}

/**
 * Task Verifier - Checks if a task has been implemented
 * Analyzes git status, code changes, and semantic matching
 */
export class TaskVerifier {
  /**
   * Verify if a task has been implemented
   */
  async verify(context: ExecutionContext, taskDescription: string): Promise<TaskVerificationResult> {
    logger.info(`Verifying task: ${context.task.taskId}`);

    const snapshot = context.projectSnapshot || await ProjectScanner.scan(context.workingDir);
    context.projectSnapshot = snapshot;

    const gitChanges = await this.analyzeGitStatus(context.workingDir);
    const taskReferences = await this.findTaskReferences(context, snapshot);
    const semanticMatches = await this.findSemanticMatches(context, taskDescription, snapshot);
    const testCoverage = await this.analyzeTestCoverage(context, taskDescription, snapshot);

    const evidence: TaskEvidence[] = [
      ...taskReferences,
      ...semanticMatches,
    ];

    const status = this.determineStatus(evidence, gitChanges, testCoverage);
    const confidence = this.calculateConfidence(evidence, gitChanges, testCoverage);
    const relatedFiles = this.identifyRelatedFiles(evidence, gitChanges);
    const recommendations = this.generateRecommendations(status, evidence, gitChanges, testCoverage);
    const aiGuidance = this.generateAIGuidance(status, context.task, evidence, gitChanges, testCoverage, taskDescription);

    const result: TaskVerificationResult = {
      taskId: context.task.taskId,
      status,
      confidence,
      summary: this.generateSummary(status, confidence, evidence, gitChanges),
      evidence,
      gitChanges,
      relatedFiles,
      testCoverage,
      recommendations,
      aiGuidance,
    };

    logger.info(`Task verification complete: ${status} (${confidence}% confidence)`);
    return result;
  }

  /**
   * Analyze git status for uncommitted changes
   */
  private async analyzeGitStatus(workingDir: string): Promise<GitChange[]> {
    const changes: GitChange[] = [];

    try {
      const statusOutput = execSync('git status --porcelain', {
        cwd: workingDir,
        encoding: 'utf-8',
      });

      for (const line of statusOutput.split('\n').filter(l => l.trim())) {
        const statusCode = line.substring(0, 2);
        const filePath = line.substring(3).trim();

        let status: GitChange['status'] = 'modified';
        let staged = false;

        if (statusCode.startsWith('?')) {
          status = 'untracked';
        } else if (statusCode.startsWith('A') || statusCode.endsWith('A')) {
          status = 'added';
          staged = statusCode.startsWith('A');
        } else if (statusCode.startsWith('D') || statusCode.endsWith('D')) {
          status = 'deleted';
          staged = statusCode.startsWith('D');
        } else if (statusCode.startsWith('M') || statusCode.endsWith('M')) {
          status = 'modified';
          staged = statusCode.startsWith('M');
        }

        let diff: string | undefined;
        if (status !== 'untracked' && status !== 'deleted') {
          try {
            diff = execSync(`git diff HEAD -- "${filePath}"`, {
              cwd: workingDir,
              encoding: 'utf-8',
              maxBuffer: 1024 * 1024,
            });
          } catch {
            // File might be new
          }
        }

        changes.push({ file: filePath, status, staged, diff });
      }
    } catch (error) {
      logger.warn('Failed to get git status:', error);
    }

    return changes;
  }

  /**
   * Find explicit references to task ID in code
   */
  private async findTaskReferences(
    context: ExecutionContext,
    snapshot: ProjectSnapshot
  ): Promise<TaskEvidence[]> {
    const evidence: TaskEvidence[] = [];
    const taskId = context.task.taskId;

    // Search patterns for task references
    const patterns = [
      new RegExp(`${taskId}`, 'gi'),
      new RegExp(`(?:fix|fixes|fixed|resolve|resolves|close|closes)\\s*:?\\s*${taskId}`, 'gi'),
      new RegExp(`(?:ticket|issue|task|jira)\\s*:?\\s*${taskId}`, 'gi'),
    ];

    for (const file of snapshot.files) {
      if (!file.content) continue;

      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const pattern of patterns) {
          if (pattern.test(line)) {
            evidence.push({
              type: 'task_reference',
              file: file.path,
              line: i + 1,
              snippet: line.trim(),
              confidence: 95,
              description: `Direct reference to task ${taskId} found`,
            });
            break;
          }
        }
      }
    }

    // Check git log for task references
    try {
      const logOutput = execSync(`git log --oneline --grep="${taskId}" -10`, {
        cwd: context.workingDir,
        encoding: 'utf-8',
      });

      if (logOutput.trim()) {
        for (const line of logOutput.split('\n').filter(l => l.trim())) {
          evidence.push({
            type: 'task_reference',
            file: 'git-history',
            snippet: line.trim(),
            confidence: 90,
            description: `Task ${taskId} referenced in commit history`,
          });
        }
      }
    } catch {
      // Git might not be available
    }

    return evidence;
  }

  /**
   * Find semantic matches between task description and code
   */
  private async findSemanticMatches(
    context: ExecutionContext,
    taskDescription: string,
    snapshot: ProjectSnapshot
  ): Promise<TaskEvidence[]> {
    const evidence: TaskEvidence[] = [];

    // Extract key terms from task description
    const keyTerms = this.extractKeyTerms(taskDescription);
    const codePatterns = this.extractCodePatterns(taskDescription);

    logger.info(`Searching for key terms: ${keyTerms.join(', ')}`);
    logger.info(`Searching for code patterns: ${codePatterns.join(', ')}`);

    for (const file of snapshot.files) {
      if (!file.content) continue;

      const lines = file.content.split('\n');
      
      // Check for method/class name matches
      for (const pattern of codePatterns) {
        const regex = new RegExp(pattern, 'gi');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (regex.test(line)) {
            evidence.push({
              type: 'semantic_match',
              file: file.path,
              line: i + 1,
              snippet: line.trim(),
              confidence: 70,
              description: `Code pattern "${pattern}" matches task description`,
            });
          }
        }
      }

      // Check for key term matches in comments
      const content = file.content.toLowerCase();
      let termMatches = 0;
      for (const term of keyTerms) {
        if (content.includes(term.toLowerCase())) {
          termMatches++;
        }
      }

      if (termMatches >= 2) {
        evidence.push({
          type: 'semantic_match',
          file: file.path,
          snippet: `${termMatches}/${keyTerms.length} key terms found`,
          confidence: Math.min(50 + termMatches * 10, 80),
          description: `Multiple key terms from task found in file`,
        });
      }
    }

    // Check git diff for semantic matches
    const gitChanges = await this.analyzeGitStatus(context.workingDir);
    for (const change of gitChanges) {
      if (!change.diff) continue;

      for (const pattern of codePatterns) {
        if (new RegExp(pattern, 'gi').test(change.diff)) {
          evidence.push({
            type: 'code_match',
            file: change.file,
            snippet: `Modified: contains "${pattern}"`,
            confidence: 85,
            description: `Uncommitted change matches task pattern "${pattern}"`,
          });
        }
      }
    }

    return evidence;
  }

  /**
   * Extract key terms from task description
   */
  private extractKeyTerms(description: string): string[] {
    const terms: string[] = [];
    
    // Common technical terms to look for
    const techTermPatterns = [
      /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g, // CamelCase
      /\b([a-z]+_[a-z]+(?:_[a-z]+)*)\b/g, // snake_case
      /\b(calculate|compute|fix|update|change|modify|add|remove|delete|create)\w*\b/gi,
      /\b(date|time|order|status|delivery|estimated|publication)\b/gi,
    ];

    for (const pattern of techTermPatterns) {
      const matches = description.match(pattern);
      if (matches) {
        terms.push(...matches.map(m => m.toLowerCase()));
      }
    }

    // Extract quoted strings
    const quotedMatches = description.match(/"([^"]+)"|'([^']+)'/g);
    if (quotedMatches) {
      terms.push(...quotedMatches.map(m => m.replace(/["']/g, '')));
    }

    return [...new Set(terms)];
  }

  /**
   * Extract code patterns from task description (method names, class names)
   */
  private extractCodePatterns(description: string): string[] {
    const patterns: string[] = [];

    // Method/function patterns
    const methodPatterns = description.match(/\b([a-z]+[A-Z]\w+)\s*\(/g);
    if (methodPatterns) {
      patterns.push(...methodPatterns.map(m => m.replace('(', '').trim()));
    }

    // Class patterns
    const classPatterns = description.match(/\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g);
    if (classPatterns) {
      patterns.push(...classPatterns);
    }

    // Property/field patterns
    const propertyPatterns = description.match(/\b(\.([a-z]\w+))\b/g);
    if (propertyPatterns) {
      patterns.push(...propertyPatterns.map(p => p.replace('.', '')));
    }

    // Explicit code references like `ClassName.methodName()`
    const codeRefPatterns = description.match(/`([^`]+)`/g);
    if (codeRefPatterns) {
      for (const ref of codeRefPatterns) {
        const clean = ref.replace(/`/g, '').replace(/\(\)/g, '');
        if (clean.includes('.')) {
          patterns.push(...clean.split('.'));
        } else {
          patterns.push(clean);
        }
      }
    }

    return [...new Set(patterns)].filter(p => p.length > 2);
  }

  /**
   * Analyze test coverage for the task
   */
  private async analyzeTestCoverage(
    context: ExecutionContext,
    taskDescription: string,
    snapshot: ProjectSnapshot
  ): Promise<TaskVerificationResult['testCoverage']> {
    const testFiles: string[] = [];
    const codePatterns = this.extractCodePatterns(taskDescription);

    for (const file of snapshot.files) {
      if (file.classification !== 'test') continue;
      if (!file.content) continue;

      // Check if test file tests relevant code
      for (const pattern of codePatterns) {
        if (file.content.includes(pattern)) {
          testFiles.push(file.path);
          break;
        }
      }
    }

    // Check for new/modified test files in git
    const gitChanges = await this.analyzeGitStatus(context.workingDir);
    for (const change of gitChanges) {
      if (change.file.includes('test') || change.file.includes('Test')) {
        if (!testFiles.includes(change.file)) {
          testFiles.push(change.file);
        }
      }
    }

    return {
      hasTests: testFiles.length > 0,
      testFiles,
      coverageStatus: testFiles.length === 0 ? 'uncovered' : 
                      testFiles.length >= 2 ? 'covered' : 'partial',
    };
  }

  /**
   * Determine implementation status
   */
  private determineStatus(
    evidence: TaskEvidence[],
    gitChanges: GitChange[],
    testCoverage: TaskVerificationResult['testCoverage']
  ): TaskImplementationStatus {
    const highConfidenceEvidence = evidence.filter(e => e.confidence >= 70);
    const hasTaskReferences = evidence.some(e => e.type === 'task_reference');
    const hasCodeMatches = evidence.some(e => e.type === 'code_match' || e.type === 'semantic_match');
    const hasUncommittedChanges = gitChanges.length > 0;

    // Check for commit references
    const hasCommitReference = evidence.some(
      e => e.type === 'task_reference' && e.file === 'git-history'
    );

    if (hasCommitReference && !hasUncommittedChanges) {
      return testCoverage.hasTests ? 'IMPLEMENTED' : 'NEEDS_REVIEW';
    }

    if (highConfidenceEvidence.length >= 3 && hasUncommittedChanges) {
      return 'IMPLEMENTED_NOT_COMMITTED';
    }

    if (highConfidenceEvidence.length >= 2) {
      if (hasUncommittedChanges) {
        return 'IMPLEMENTED_NOT_COMMITTED';
      }
      return 'NEEDS_REVIEW';
    }

    if (evidence.length > 0 && (hasTaskReferences || hasCodeMatches)) {
      return 'PARTIALLY_IMPLEMENTED';
    }

    return 'NOT_IMPLEMENTED';
  }

  /**
   * Calculate overall confidence
   */
  private calculateConfidence(
    evidence: TaskEvidence[],
    gitChanges: GitChange[],
    testCoverage: TaskVerificationResult['testCoverage']
  ): number {
    if (evidence.length === 0) return 0;

    let confidence = Math.max(...evidence.map(e => e.confidence));

    // Boost for multiple evidence types
    const evidenceTypes = new Set(evidence.map(e => e.type));
    confidence += (evidenceTypes.size - 1) * 5;

    // Boost for uncommitted changes that match
    const matchingChanges = gitChanges.filter(g => 
      evidence.some(e => e.file === g.file)
    );
    if (matchingChanges.length > 0) {
      confidence += 10;
    }

    // Boost for test coverage
    if (testCoverage.hasTests) {
      confidence += 10;
    }

    return Math.min(confidence, 100);
  }

  /**
   * Identify files related to the task
   */
  private identifyRelatedFiles(evidence: TaskEvidence[], gitChanges: GitChange[]): string[] {
    const files = new Set<string>();

    for (const e of evidence) {
      if (e.file !== 'git-history') {
        files.add(e.file);
      }
    }

    for (const change of gitChanges) {
      files.add(change.file);
    }

    return Array.from(files);
  }

  /**
   * Generate recommendations based on status
   */
  private generateRecommendations(
    status: TaskImplementationStatus,
    evidence: TaskEvidence[],
    gitChanges: GitChange[],
    testCoverage: TaskVerificationResult['testCoverage']
  ): string[] {
    const recommendations: string[] = [];

    switch (status) {
      case 'NOT_IMPLEMENTED':
        recommendations.push('Task has not been implemented yet');
        recommendations.push('Review the task description and acceptance criteria');
        recommendations.push('Identify the files that need to be modified');
        break;

      case 'PARTIALLY_IMPLEMENTED':
        recommendations.push('Task appears to be partially implemented');
        recommendations.push('Review the existing changes and complete the implementation');
        if (!testCoverage.hasTests) {
          recommendations.push('Add tests for the implemented functionality');
        }
        break;

      case 'IMPLEMENTED_NOT_COMMITTED':
        recommendations.push('Implementation found but NOT committed');
        if (testCoverage.hasTests) {
          recommendations.push('Run tests to verify the implementation');
        } else {
          recommendations.push('Add tests before committing');
        }
        recommendations.push('Review changes and commit when ready');
        break;

      case 'IMPLEMENTED':
        recommendations.push('Task has been implemented and committed');
        if (!testCoverage.hasTests) {
          recommendations.push('Consider adding tests for better coverage');
        }
        break;

      case 'NEEDS_REVIEW':
        recommendations.push('Implementation found but needs review');
        recommendations.push('Verify the implementation matches the task requirements');
        if (!testCoverage.hasTests) {
          recommendations.push('Add tests to validate the implementation');
        }
        break;
    }

    return recommendations;
  }

  /**
   * Generate summary
   */
  private generateSummary(
    status: TaskImplementationStatus,
    confidence: number,
    evidence: TaskEvidence[],
    gitChanges: GitChange[]
  ): string {
    const statusDescriptions: Record<TaskImplementationStatus, string> = {
      'NOT_IMPLEMENTED': 'Task has NOT been implemented',
      'PARTIALLY_IMPLEMENTED': 'Task is PARTIALLY implemented',
      'IMPLEMENTED_NOT_COMMITTED': 'Task is IMPLEMENTED but NOT COMMITTED',
      'IMPLEMENTED': 'Task has been IMPLEMENTED and committed',
      'NEEDS_REVIEW': 'Implementation found but NEEDS REVIEW',
    };

    let summary = `${statusDescriptions[status]} (${confidence}% confidence).`;

    if (evidence.length > 0) {
      summary += ` Found ${evidence.length} evidence items.`;
    }

    if (gitChanges.length > 0) {
      const uncommitted = gitChanges.filter(g => !g.staged).length;
      const staged = gitChanges.filter(g => g.staged).length;
      summary += ` Git: ${uncommitted} uncommitted, ${staged} staged changes.`;
    }

    return summary;
  }

  /**
   * Generate guidance for AI agents
   */
  private generateAIGuidance(
    status: TaskImplementationStatus,
    task: Task,
    evidence: TaskEvidence[],
    gitChanges: GitChange[],
    testCoverage: TaskVerificationResult['testCoverage'],
    taskDescription: string
  ): AIGuidance {
    const filesToModify: string[] = [];
    const filesToCreate: string[] = [];
    const warnings: string[] = [];
    const steps: string[] = [];
    let action: AIGuidance['action'] = 'implement';
    let priority: AIGuidance['priority'] = 'medium';

    // Determine action based on status
    switch (status) {
      case 'NOT_IMPLEMENTED':
        action = 'implement';
        priority = 'high';
        steps.push('1. Analyze the task requirements thoroughly');
        steps.push('2. Identify files to modify based on task description');
        steps.push('3. Implement the required changes');
        steps.push('4. Add comprehensive tests');
        steps.push('5. Run all tests to verify');
        break;

      case 'PARTIALLY_IMPLEMENTED':
        action = 'implement';
        priority = 'medium';
        steps.push('1. Review existing partial implementation');
        steps.push('2. Identify what is missing');
        steps.push('3. Complete the implementation');
        steps.push('4. Add or update tests');
        break;

      case 'IMPLEMENTED_NOT_COMMITTED':
        action = testCoverage.hasTests ? 'commit' : 'test';
        priority = 'low';
        if (!testCoverage.hasTests) {
          steps.push('1. Add tests for the implementation');
          steps.push('2. Run tests to verify');
          steps.push('3. Review changes');
          steps.push('4. Commit when verified');
          warnings.push('Implementation exists but has no tests');
        } else {
          steps.push('1. Run existing tests to verify');
          steps.push('2. Review the implementation');
          steps.push('3. Commit the changes');
        }
        break;

      case 'IMPLEMENTED':
        action = 'none';
        priority = 'low';
        steps.push('Task is already implemented and committed');
        if (!testCoverage.hasTests) {
          steps.push('Consider adding tests for better coverage');
        }
        break;

      case 'NEEDS_REVIEW':
        action = 'review';
        priority = 'medium';
        steps.push('1. Review the existing implementation');
        steps.push('2. Verify it matches task requirements');
        steps.push('3. Add tests if missing');
        steps.push('4. Make corrections if needed');
        break;
    }

    // Identify files from evidence
    for (const e of evidence) {
      if (e.file !== 'git-history' && !filesToModify.includes(e.file)) {
        filesToModify.push(e.file);
      }
    }

    // Add modified files from git
    for (const change of gitChanges) {
      if (!filesToModify.includes(change.file)) {
        filesToModify.push(change.file);
      }
    }

    // Suggest test file creation if needed
    if (!testCoverage.hasTests && action !== 'none') {
      const codePatterns = this.extractCodePatterns(taskDescription);
      if (codePatterns.length > 0) {
        filesToCreate.push(`Test file for: ${codePatterns[0]}`);
      }
      warnings.push('No tests found for this task');
    }

    // Build context
    const context = this.buildAIContext(task, taskDescription, status, evidence, gitChanges);

    return {
      action,
      priority,
      context,
      steps,
      filesToModify,
      filesToCreate,
      warnings,
    };
  }

  /**
   * Build context string for AI agents
   */
  private buildAIContext(
    task: Task,
    taskDescription: string,
    status: TaskImplementationStatus,
    evidence: TaskEvidence[],
    gitChanges: GitChange[]
  ): string {
    let context = `## Task: ${task.taskId} - ${task.title}\n\n`;
    context += `### Status: ${status}\n\n`;
    context += `### Description:\n${taskDescription}\n\n`;

    if (evidence.length > 0) {
      context += `### Evidence Found:\n`;
      for (const e of evidence.slice(0, 10)) {
        context += `- [${e.type}] ${e.file}${e.line ? `:${e.line}` : ''}: ${e.description}\n`;
      }
      context += '\n';
    }

    if (gitChanges.length > 0) {
      context += `### Uncommitted Changes:\n`;
      for (const change of gitChanges) {
        context += `- ${change.status}: ${change.file} (${change.staged ? 'staged' : 'unstaged'})\n`;
      }
      context += '\n';
    }

    context += `### Acceptance Criteria:\n`;
    for (const criteria of task.acceptanceCriteria) {
      context += `- [ ] ${criteria}\n`;
    }

    return context;
  }
}

export default new TaskVerifier();
