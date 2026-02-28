/**
 * Task input from Jira, Slack, or JSON file
 */
export interface Task {
  taskId: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  estimatedPoints: number;
  projectPath: string;
  customFields?: Record<string, unknown>;
}

/**
 * Parsed task after validation
 */
export interface ParsedTask extends Task {
  parsedAt: string;
  status: TaskStatus;
}

export enum TaskStatus {
  PARSED = 'PARSED',
  SETUP_COMPLETE = 'SETUP_COMPLETE',
  ANALYSIS_COMPLETE = 'ANALYSIS_COMPLETE',
  PATTERNS_EXTRACTED = 'PATTERNS_EXTRACTED',
  IMPLEMENTATION_COMPLETE = 'IMPLEMENTATION_COMPLETE',
  TESTING_COMPLETE = 'TESTING_COMPLETE',
  REVIEW_COMPLETE = 'REVIEW_COMPLETE',
  VALIDATION_COMPLETE = 'VALIDATION_COMPLETE',
  FINALIZED = 'FINALIZED',
}

/**
 * Project analysis from xray
 */
export interface ProjectAnalysis {
  language: string;
  buildTool: string;
  framework: string;
  testFramework: string;
  components: string[];
  dependencies: Dependency[];
  architecture: string;
  xrayReportPath?: string;
}

/**
 * Dependency information
 */
export interface Dependency {
  name: string;
  version: string;
  scope: 'compile' | 'test' | 'provided' | 'runtime';
  fixed: boolean;
}

/**
 * Test patterns detected from testlens
 */
export interface TestPatterns {
  framework: string;
  frameworkVersion: string;
  mockingLibrary: string;
  assertionLibrary: string;
  namingConvention: string;
  integrationTestPattern?: string;
  coverageBaseline: number;
  testlensReportPath?: string;
}

/**
 * Code style patterns detected from analysis
 */
export interface CodeStylePatterns {
  namingConventions: Record<string, string>;
  packageStructure: string;
  imports: string[];
  indentation: string;
  lineLength: number;
  docstringStyle: string;
}

/**
 * Workflow execution result
 */
export interface WorkflowResult {
  phase: number;
  status: 'SUCCESS' | 'FAILURE' | 'PARTIAL';
  duration: number; // in milliseconds
  message: string;
  data?: Record<string, unknown>;
  errors?: string[];
}

/**
 * Validation result from validators (Phase 2)
 */
export interface ValidationResult {
  phase: string;
  success: boolean;
  errors: string[];
  warnings: string[];
  duration: number; // in milliseconds
  details: Record<string, unknown>;
}

/**
 * Execution context for all phases
 */
export interface ExecutionContext {
  task: ParsedTask;
  branchName: string;
  workingDir: string;
  projectAnalysis?: ProjectAnalysis;
  testPatterns?: TestPatterns;
  codeStylePatterns?: CodeStylePatterns;
  phaseResults: Map<number, WorkflowResult>;
  reports: Map<string, string>; // phase -> report path
}
