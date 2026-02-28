import path from 'path';
import { execSync } from 'child_process';
import { simpleGit, SimpleGit } from 'simple-git';
import { logger } from '../utils/logger.js';
import { ensureDir, writeJson } from '../utils/file-utils.js';
import { ExecutionContext, ParsedTask, TaskStatus, WorkflowResult } from './types.js';

/**
 * Orchestrates the entire workflow
 */
export class WorkflowOrchestrator {
  private context: ExecutionContext | null = null;
  private git: SimpleGit | null = null;

  /**
   * Initialize context and setup
   */
  async initialize(task: ParsedTask): Promise<ExecutionContext> {
    logger.info(`Initializing workflow for task: ${task.taskId}`);

    // Create branch name from task
    const branchName = this.createBranchName(task);

    // Setup working directory
    const workingDir = task.projectPath;
    await ensureDir(workingDir);

    // Initialize context
    this.context = {
      task: { ...task, status: TaskStatus.SETUP_COMPLETE },
      branchName,
      workingDir,
      phaseResults: new Map(),
      reports: new Map(),
    };

    // Initialize git
    this.git = simpleGit(workingDir);

    logger.info(`Workflow initialized`);
    logger.info(`  Branch: ${branchName}`);
    logger.info(`  Working directory: ${workingDir}`);

    return this.context;
  }

  /**
   * Create branch name from task
   */
  private createBranchName(task: ParsedTask): string {
    // Format: feature/PROJ-123-add-jwt-authentication
    const slug = task.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 30);

    return `feature/${task.taskId.toLowerCase()}-${slug}`;
  }

  /**
   * Create git branch
   */
  async createBranch(): Promise<void> {
    if (!this.context || !this.git) {
      throw new Error('Workflow not initialized');
    }

    const branchName = this.context.branchName;
    logger.info(`Creating branch: ${branchName}`);

    try {
      // Fetch latest changes
      await this.git.fetch();

      // Check if branch exists, if not create from main/master
      const branches = await this.git.branch(['-a']);

      if (!branches.all.includes(branchName)) {
        // Try main first, then master
        const baseBranch = branches.all.includes('origin/main') ? 'origin/main' : 'origin/master';
        await this.git.checkoutLocalBranch(branchName, baseBranch as any);
        logger.info(`Branch created from: ${baseBranch}`);
      } else {
        await this.git.checkout(branchName);
        logger.info(`Checked out existing branch`);
      }
    } catch (error) {
      // If fetching fails, try local branch creation
      logger.warn(`Could not fetch, creating local branch: ${error}`);
      try {
        await this.git.checkout(['-b', branchName]);
      } catch (err) {
        await this.git.checkout(branchName);
      }
    }
  }

  /**
   * Record phase result
   */
  recordPhaseResult(phase: number, result: WorkflowResult): void {
    if (!this.context) {
      throw new Error('Workflow not initialized');
    }

    this.context.phaseResults.set(phase, result);
    logger.info(`Phase ${phase} recorded: ${result.status} (${result.duration}ms)`);
  }

  /**
   * Record phase report
   */
  recordReport(phaseName: string, reportPath: string): void {
    if (!this.context) {
      throw new Error('Workflow not initialized');
    }

    this.context.reports.set(phaseName, reportPath);
    logger.info(`Report recorded: ${phaseName} -> ${reportPath}`);
  }

  /**
   * Get current context
   */
  getContext(): ExecutionContext {
    if (!this.context) {
      throw new Error('Workflow not initialized');
    }
    return this.context;
  }

  /**
   * Get execution summary
   */
  getSummary(): Record<string, unknown> {
    if (!this.context) {
      throw new Error('Workflow not initialized');
    }

    const results: Record<string, unknown> = {};
    this.context.phaseResults.forEach((result, phase) => {
      results[`phase_${phase}`] = {
        status: result.status,
        duration: result.duration,
        message: result.message,
      };
    });

    return {
      taskId: this.context.task.taskId,
      branch: this.context.branchName,
      startedAt: this.context.task.parsedAt,
      phaseResults: results,
      reports: Object.fromEntries(this.context.reports),
    };
  }

  /**
   * Save execution context to file
   */
  async saveContext(): Promise<void> {
    if (!this.context) {
      throw new Error('Workflow not initialized');
    }

    const contextPath = path.join(
      this.context.workingDir,
      '.task-automation',
      `${this.context.task.taskId}.json`
    );

    const data = {
      task: this.context.task,
      branchName: this.context.branchName,
      workingDir: this.context.workingDir,
      projectAnalysis: this.context.projectAnalysis,
      testPatterns: this.context.testPatterns,
      codeStylePatterns: this.context.codeStylePatterns,
      summary: this.getSummary(),
    };

    await writeJson(contextPath, data);
    logger.info(`Context saved to: ${contextPath}`);
  }
}

export default new WorkflowOrchestrator();
