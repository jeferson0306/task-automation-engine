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
  projectSnapshot?: ProjectSnapshot;
  contractContext?: ContractContext;
  xrayReport?: XRayReport;
  phaseResults: Map<number, WorkflowResult>;
  reports: Map<string, string>; // phase -> report path
}

// ============================================================================
// JAY-CREW PATTERNS: Project Scanner, Skeletal Reading, Priority Classification
// ============================================================================

/**
 * File priority classification (from jay-crew)
 * P0: Critical files that need full reading (schemas, migrations, configs)
 * P1: Important files with skeletal reading (controllers, services)
 * P2: Regular files with minimal reading
 */
export enum FilePriority {
  P0_CRITICAL = 0,
  P1_IMPORTANT = 1,
  P2_REGULAR = 2,
}

/**
 * Scanned file with priority and content
 */
export interface ScannedFile {
  path: string;
  relativePath: string;
  priority: FilePriority;
  language: string;
  size: number;
  content?: string;
  skeletalContent?: SkeletalContent;
  classification: FileClassification;
}

/**
 * File classification for smart scanning
 */
export type FileClassification =
  | 'schema'
  | 'migration'
  | 'config'
  | 'controller'
  | 'service'
  | 'repository'
  | 'entity'
  | 'dto'
  | 'test'
  | 'util'
  | 'unknown';

/**
 * Skeletal content - structure only, no implementation details
 */
export interface SkeletalContent {
  package?: string;
  imports: string[];
  classes: ClassSkeleton[];
  interfaces: InterfaceSkeleton[];
  functions: FunctionSkeleton[];
  exports: string[];
}

/**
 * Class skeleton for skeletal reading
 */
export interface ClassSkeleton {
  name: string;
  extends?: string;
  implements: string[];
  annotations: string[];
  methods: MethodSignature[];
  fields: FieldSignature[];
}

/**
 * Interface skeleton
 */
export interface InterfaceSkeleton {
  name: string;
  extends: string[];
  methods: MethodSignature[];
}

/**
 * Function skeleton
 */
export interface FunctionSkeleton {
  name: string;
  parameters: ParameterSignature[];
  returnType?: string;
  isAsync: boolean;
  isExported: boolean;
}

/**
 * Method signature for skeletal content
 */
export interface MethodSignature {
  name: string;
  visibility: 'public' | 'private' | 'protected' | 'package';
  parameters: ParameterSignature[];
  returnType?: string;
  annotations: string[];
  isStatic: boolean;
  isAsync: boolean;
}

/**
 * Parameter signature
 */
export interface ParameterSignature {
  name: string;
  type: string;
  isOptional: boolean;
  defaultValue?: string;
}

/**
 * Field signature
 */
export interface FieldSignature {
  name: string;
  type: string;
  visibility: 'public' | 'private' | 'protected' | 'package';
  annotations: string[];
  isStatic: boolean;
  isFinal: boolean;
}

/**
 * Complete project snapshot from scanning
 */
export interface ProjectSnapshot {
  scanTime: string;
  rootPath: string;
  totalFiles: number;
  totalSize: number;
  languageBreakdown: Record<string, number>;
  files: ScannedFile[];
  services: DetectedService[];
  configFiles: ConfigFile[];
  dependencies: ExtendedDependency[];
  detectedStack: DetectedStack;
}

/**
 * Detected service in monorepo
 */
export interface DetectedService {
  name: string;
  path: string;
  type: 'backend' | 'frontend' | 'mobile' | 'library' | 'shared';
  language: string;
  framework?: string;
  buildTool?: string;
}

/**
 * Configuration file
 */
export interface ConfigFile {
  path: string;
  type: string;
  content: string;
}

/**
 * Extended dependency with more metadata
 */
export interface ExtendedDependency extends Dependency {
  latest?: string;
  isOutdated: boolean;
  vulnerabilities: string[];
}

/**
 * Detected technology stack
 */
export interface DetectedStack {
  languages: LanguageInfo[];
  frameworks: FrameworkInfo[];
  databases: string[];
  messageBrokers: string[];
  cloudServices: string[];
  cicd: string[];
  containerization: string[];
}

/**
 * Language info with version
 */
export interface LanguageInfo {
  name: string;
  version?: string;
  percentage: number;
}

/**
 * Framework info
 */
export interface FrameworkInfo {
  name: string;
  version?: string;
  type: 'web' | 'api' | 'orm' | 'test' | 'build' | 'other';
}

// ============================================================================
// JAY-CREW PATTERNS: X-Ray Mode Analysis
// ============================================================================

/**
 * X-Ray report from specialist analysis
 */
export interface XRayReport {
  timestamp: string;
  projectPath: string;
  taskContext?: string;
  stackSummary: DetectedStack;
  specialists: SpecialistXRay[];
  synthesis: XRaySynthesis;
}

/**
 * Individual specialist X-Ray analysis
 */
export interface SpecialistXRay {
  specialistId: string;
  specialistName: string;
  focus: string;
  findings: XRayFinding[];
  recommendations: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * X-Ray finding
 */
export interface XRayFinding {
  category: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  description: string;
  file?: string;
  line?: number;
  codeSnippet?: string;
  suggestion?: string;
}

/**
 * X-Ray synthesis - unified analysis
 */
export interface XRaySynthesis {
  executiveSummary: string;
  conflictsResolved: ConflictResolution[];
  implementationRoadmap: RoadmapItem[];
  risks: RiskItem[];
  immediateActions: string[];
}

/**
 * Conflict resolution between specialists
 */
export interface ConflictResolution {
  specialists: string[];
  conflict: string;
  resolution: string;
  rationale: string;
}

/**
 * Implementation roadmap item
 */
export interface RoadmapItem {
  order: number;
  task: string;
  owner: string;
  dependencies: string[];
  effort: 'trivial' | 'small' | 'medium' | 'large' | 'xlarge';
}

/**
 * Risk item
 */
export interface RiskItem {
  risk: string;
  probability: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high' | 'critical';
  mitigation: string;
}

// ============================================================================
// TEST-LENS PATTERNS: Contract Extraction
// ============================================================================

/**
 * Contract context extracted from source code
 */
export interface ContractContext {
  extractedAt: string;
  projectPath: string;
  enums: EnumContract[];
  exceptions: ExceptionContract[];
  httpEndpoints: HttpEndpointContract[];
  domainModels: DomainModelContract[];
  serviceContracts: ServiceContract[];
  conventions: ProjectConventions;
}

/**
 * Enum contract - exact values from source
 */
export interface EnumContract {
  name: string;
  file: string;
  values: EnumValue[];
  usedIn: string[];
}

/**
 * Enum value
 */
export interface EnumValue {
  name: string;
  value?: string | number;
  description?: string;
}

/**
 * Exception contract - exact messages from source
 */
export interface ExceptionContract {
  name: string;
  file: string;
  extends?: string;
  messages: string[];
  thrownBy: string[];
}

/**
 * HTTP endpoint contract
 */
export interface HttpEndpointContract {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  controller: string;
  methodName: string;
  parameters: EndpointParameter[];
  requestBody?: string;
  responses: EndpointResponse[];
}

/**
 * Endpoint parameter
 */
export interface EndpointParameter {
  name: string;
  type: string;
  source: 'path' | 'query' | 'header' | 'body';
  required: boolean;
  validation?: string;
}

/**
 * Endpoint response
 */
export interface EndpointResponse {
  status: number;
  description?: string;
  bodyType?: string;
  condition?: string;
}

/**
 * Domain model contract
 */
export interface DomainModelContract {
  name: string;
  file: string;
  type: 'entity' | 'valueObject' | 'aggregate' | 'dto' | 'record';
  fields: DomainField[];
  validations: string[];
  relationships: DomainRelationship[];
}

/**
 * Domain field
 */
export interface DomainField {
  name: string;
  type: string;
  nullable: boolean;
  constraints: string[];
  defaultValue?: string;
}

/**
 * Domain relationship
 */
export interface DomainRelationship {
  type: 'oneToOne' | 'oneToMany' | 'manyToOne' | 'manyToMany';
  target: string;
  mappedBy?: string;
  cascade: string[];
}

/**
 * Service contract
 */
export interface ServiceContract {
  name: string;
  file: string;
  dependencies: string[];
  methods: ServiceMethod[];
}

/**
 * Service method
 */
export interface ServiceMethod {
  name: string;
  parameters: ParameterSignature[];
  returnType: string;
  throwsExceptions: string[];
  invokes: MethodInvocation[];
}

/**
 * Method invocation for verify() counts
 */
export interface MethodInvocation {
  target: string;
  method: string;
  expectedCalls: number;
}

/**
 * Project conventions extracted from existing code
 */
export interface ProjectConventions {
  testImport: 'junit5' | 'junit4' | 'testng' | 'jest' | 'vitest' | 'pytest';
  mockitoSetup: '@ExtendWith' | '@RunWith' | 'manual' | 'none';
  assertionLibrary: 'assertj' | 'junit' | 'hamcrest' | 'jest' | 'chai';
  namingConvention: 'camelCase' | 'snake_case' | 'methodName_when_then';
  mockPattern: '@Mock+@InjectMocks' | 'manual' | 'mockk';
  staticImports: boolean;
  testDirectory: string;
  sourceDirectory: string;
}

// ============================================================================
// TEST-LENS PATTERNS: Anti-Pattern Detection
// ============================================================================

/**
 * Detected anti-pattern in code
 */
export interface AntiPattern {
  id: string;
  category: AntiPatternCategory;
  severity: 'critical' | 'high' | 'medium' | 'low';
  name: string;
  description: string;
  file: string;
  line: number;
  column?: number;
  codeSnippet: string;
  fix?: AntiPatternFix;
}

/**
 * Anti-pattern categories
 */
export type AntiPatternCategory =
  | 'flaky-test'
  | 'weak-assertion'
  | 'code-smell'
  | 'mockito-misuse'
  | 'framework-issue'
  | 'security-risk'
  | 'performance-issue'
  | 'maintainability';

/**
 * Suggested fix for anti-pattern
 */
export interface AntiPatternFix {
  description: string;
  before: string;
  after: string;
  autoFixable: boolean;
}

// ============================================================================
// TEST-LENS PATTERNS: Self-Healing Pipeline
// ============================================================================

/**
 * Self-healing pipeline result
 */
export interface SelfHealingResult {
  startedAt: string;
  completedAt: string;
  iterations: HealingIteration[];
  finalStatus: 'success' | 'partial' | 'failed';
  totalFixesApplied: number;
  remainingIssues: string[];
}

/**
 * Single healing iteration
 */
export interface HealingIteration {
  iteration: number;
  phase: 'compile' | 'test' | 'lint';
  errors: HealingError[];
  fixes: HealingFix[];
  status: 'fixed' | 'partial' | 'failed';
}

/**
 * Error during healing
 */
export interface HealingError {
  type: 'compilation' | 'test-failure' | 'lint-violation';
  file: string;
  line?: number;
  message: string;
  code?: string;
}

/**
 * Applied fix
 */
export interface HealingFix {
  errorType: string;
  file: string;
  description: string;
  before: string;
  after: string;
  success: boolean;
}

// ============================================================================
// AST PARSING TYPES
// ============================================================================

/**
 * AST node base
 */
export interface ASTNode {
  type: string;
  start: number;
  end: number;
  line: number;
  column: number;
}

/**
 * Parsed file AST
 */
export interface ParsedFileAST {
  filePath: string;
  language: string;
  parseTime: number;
  success: boolean;
  errors: string[];
  ast?: ASTNode;
  imports: ImportNode[];
  classes: ClassNode[];
  functions: FunctionNode[];
  variables: VariableNode[];
}

/**
 * Import node
 */
export interface ImportNode extends ASTNode {
  source: string;
  specifiers: string[];
  isDefault: boolean;
  isNamespace: boolean;
}

/**
 * Class node
 */
export interface ClassNode extends ASTNode {
  name: string;
  superClass?: string;
  interfaces: string[];
  decorators: string[];
  methods: MethodNode[];
  properties: PropertyNode[];
  isAbstract: boolean;
  isExported: boolean;
}

/**
 * Method node
 */
export interface MethodNode extends ASTNode {
  name: string;
  visibility: 'public' | 'private' | 'protected';
  parameters: ParameterNode[];
  returnType?: string;
  decorators: string[];
  isStatic: boolean;
  isAsync: boolean;
  isAbstract: boolean;
  body?: string;
  complexity: number;
}

/**
 * Property node
 */
export interface PropertyNode extends ASTNode {
  name: string;
  propertyType?: string;
  visibility: 'public' | 'private' | 'protected';
  decorators: string[];
  isStatic: boolean;
  isReadonly: boolean;
  initialValue?: string;
}

/**
 * Function node
 */
export interface FunctionNode extends ASTNode {
  name: string;
  parameters: ParameterNode[];
  returnType?: string;
  isAsync: boolean;
  isExported: boolean;
  isArrow: boolean;
  body?: string;
  complexity: number;
}

/**
 * Parameter node
 */
export interface ParameterNode extends ASTNode {
  name: string;
  parameterType?: string;
  isOptional: boolean;
  isRest: boolean;
  defaultValue?: string;
  decorators: string[];
}

/**
 * Variable node
 */
export interface VariableNode extends ASTNode {
  name: string;
  variableType?: string;
  kind: 'var' | 'let' | 'const' | 'final';
  isExported: boolean;
  initialValue?: string;
}
