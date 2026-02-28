# Task Automation Engine - Technical Specification

> Complete technical specification for full 7-phase automation framework

---

## 1. Core Architecture Overview

### System Design

The Task Automation Engine operates in **seven phases**, each building on the previous one:

1. **PHASE 0**: Setup (branch creation, context initialization)
2. **PHASE 1**: Project Analysis (detect architecture, dependencies)
3. **PHASE 2**: Extract Patterns (test conventions, coding standards)
4. **PHASE 3**: Implementation (AI generates feature code)
5. **PHASE 4**: Testing (AI generates tests, verify coverage)
6. **PHASE 5**: Code Review (auto-detect issues, security check)
7. **PHASE 6**: Validation (lint, coverage threshold verification)
8. **PHASE 7**: Finalization (consolidate reports, stage files)

### Component Categories

**Core**:
- TaskParser - Parse and validate task input
- WorkflowOrchestrator - Coordinate all phases
- ReportGenerator - Generate markdown reports

**Analysis**:
- ArchitectureAnalyzer - Detect project stack
- TestPatternsAnalyzer - Extract test conventions
- CodeStyleAnalyzer - Detect code patterns (future)

**Implementation** (Phase 2):
- FeatureImplementer - AI agent for coding
- TestImplementer - AI agent for test writing
- DocImplementer - Auto-generate documentation

**Validation** (Phase 2):
- BuildValidator - Verify compilation
- TestValidator - Run test suite
- LintValidator - Code style checking
- CodeCoverageValidator - Coverage threshold

**Review** (Phase 2):
- AutoCodeReviewer - Detect anti-patterns
- SecurityReviewer - OWASP compliance
- PerformanceReviewer - Optimization checks
- ReviewFixer - Auto-apply fixes

---

## 2. Integration with External Tools

### test-lens Integration

**Phase 1: Project Analysis**
```
ProjectAnalyzer.analyze()
├─ Calls: test-lens xray skill
│  ├─ Input: projectPath
│  └─ Output: xray-report.md
├─ Parse xray output
└─ Extract: architecture, stack, components
```

**Phase 2: Test Patterns**
```
TestPatternsAnalyzer.analyze()
├─ Calls: test-lens testlens skill
│  ├─ Input: projectPath
│  └─ Output: TEST_IMPROVEMENT_REPORT.md
├─ Parse testlens output
└─ Extract: framework versions, naming patterns
```

### jay-crew Integration

**Phase 3: Implementation**
```
GenerateCrewContext()
├─ Calls: jay-crew CLI
│  ├─ Input: project analysis + patterns
│  └─ Output: crew-context-{timestamp}.md
├─ Extract specialist definitions
└─ Create agent prompts with full context

FeatureImplementer Agent
├─ Input: crew context + task requirements
├─ Process: Generate production code
└─ Output: src/main/** files

TestImplementer Agent
├─ Input: implemented code + test patterns
├─ Process: Generate comprehensive tests
└─ Output: src/test/** files
```

---

## 3. Data Model

### Task

```typescript
interface Task {
  taskId: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  estimatedPoints: number;
  projectPath: string;
  customFields?: Record<string, unknown>;
}
```

### ExecutionContext

```typescript
interface ExecutionContext {
  task: ParsedTask;
  branchName: string;
  workingDir: string;
  projectAnalysis?: ProjectAnalysis;
  testPatterns?: TestPatterns;
  codeStylePatterns?: CodeStylePatterns;
  phaseResults: Map<number, WorkflowResult>;
  reports: Map<string, string>;
}
```

### ProjectAnalysis

```typescript
interface ProjectAnalysis {
  language: string;
  buildTool: string;
  framework: string;
  testFramework: string;
  components: string[];
  dependencies: Dependency[];
  architecture: string;
  xrayReportPath?: string;
}
```

### TestPatterns

```typescript
interface TestPatterns {
  framework: string;
  frameworkVersion: string;
  mockingLibrary: string;
  assertionLibrary: string;
  namingConvention: string;
  integrationTestPattern?: string;
  coverageBaseline: number;
  testlensReportPath?: string;
}
```

---

## 4. Configuration Schema

### company-patterns.json

```json
{
  "naming": {
    "className": "PascalCase",
    "methodName": "camelCase",
    "constantName": "UPPER_SNAKE_CASE",
    "variableName": "camelCase",
    "packageName": "com.company.domain"
  },
  "structure": {
    "services": "src/main/java/{domain}/service",
    "repositories": "src/main/java/{domain}/repository",
    "dtos": "src/main/java/{domain}/dto",
    "entities": "src/main/java/{domain}/entity",
    "tests": "src/test/java/{domain}/**Test.java"
  },
  "testing": {
    "minCoveragePercent": 70,
    "testNamingPattern": "*Test.java",
    "integrationTestPattern": "*IT.java",
    "requiredFrameworks": ["JUnit", "Mockito"],
    "mockingLibrary": "Mockito",
    "assertionLibrary": "AssertJ"
  },
  "codeReview": {
    "maxMethodLength": 20,
    "maxClassLength": 300,
    "maxCyclomaticComplexity": 10,
    "minCommentCoverage": 0.3,
    "enforceNamingRules": true
  },
  "documentation": {
    "requireJavadoc": true,
    "requireREADME": true,
    "requireChangelog": true,
    "docstringStyle": "javadoc"
  },
  "languages": ["Java", "TypeScript", "Python"],
  "buildTools": ["Maven", "Gradle", "npm"],
  "ciTools": ["GitHub Actions", "Jenkins"],
  "constraints": {
    "maxLineLengthJava": 120,
    "maxLineLengthTypeScript": 100,
    "indentationSpaces": 4,
    "indentationType": "spaces"
  }
}
```

---

## 5. API Reference

### TaskParser

```typescript
class TaskParser {
  // Parse from JSON file
  parseFromFile(filePath: string): Promise<ParsedTask>
  
  // Parse from object
  parseFromObject(task: Task): ParsedTask
  
  // Parse from CLI arguments
  parseFromCLI(args: Record<string, unknown>): ParsedTask
}
```

### ArchitectureAnalyzer

```typescript
class ArchitectureAnalyzer {
  // Analyze project architecture
  analyze(context: ExecutionContext): Promise<ProjectAnalysis>
}
```

### TestPatternsAnalyzer

```typescript
class TestPatternsAnalyzer {
  // Extract test patterns
  analyze(context: ExecutionContext): Promise<TestPatterns>
}
```

### WorkflowOrchestrator

```typescript
class WorkflowOrchestrator {
  // Initialize with parsed task
  initialize(task: ParsedTask): Promise<ExecutionContext>
  
  // Create feature branch
  createBranch(): Promise<void>
  
  // Record phase result
  recordPhaseResult(phase: number, result: WorkflowResult): void
  
  // Record generated report
  recordReport(phaseName: string, reportPath: string): void
  
  // Get current context
  getContext(): ExecutionContext
  
  // Get execution summary
  getSummary(): Record<string, unknown>
  
  // Save context to disk
  saveContext(): Promise<void>
}
```

### ReportGenerator

```typescript
class ReportGenerator {
  generateSetupReport(context: ExecutionContext): Promise<string>
  generateAnalysisReport(context: ExecutionContext): Promise<string>
  generatePatternsReport(context: ExecutionContext): Promise<string>
  generateImplementationReport(context: ExecutionContext): Promise<string>
  generateTestingReport(context: ExecutionContext): Promise<string>
  generateReviewReport(context: ExecutionContext): Promise<string>
  generateValidationReport(context: ExecutionContext): Promise<string>
  generateExecutionSummary(context: ExecutionContext): Promise<string>
}
```

---

## 6. Report Format

All reports are **Markdown files** saved to project root:

### Naming Convention
```
task-automation-{phase-name}-report.md
task-automation-summary.md
```

### Sample Report Structure

```markdown
# Task Automation - [Phase Name] Report
> Generated: {timestamp}

## Overview
- Task: {taskId}
- Status: {status}
- Duration: {duration}ms

## Details
[Phase-specific content]

## Metrics
[Key metrics if applicable]

## Next Steps
[What happens next]

---
Generated by Task Automation Engine
```

---

## 7. Command-Line Interface

### Available Commands

```bash
# Run full automation (all phases)
npm run full -- --task-file task.json

# Run Phase 0-2 analysis only
npm run phase1 -- --project-path /path/to/project

# Analyze specific project
npm run analyze -- --project-path /path --task-id PROJ-001

# Initialize new project
npm run init
```

### CLI Options

```
--task-file <path>          Path to task JSON file
--task-id <id>              Task ID (e.g., PROJ-123)
--task-title <title>        Task title
--task-desc <description>   Task description
--accept-criteria <list>    Comma-separated acceptance criteria
--estimated-points <num>    Story points (Fibonacci)
--project-path <path>       Path to target project
```

---

## 8. Error Handling Strategy

### Validation Errors
- Invalid task input → Clear error message + exit
- Missing project files → Alert user + suggest fix
- Git repo not found → Initialize git + continue

### Execution Errors
- Build failure → ErrorFixer attempts correction
- Test failure → ErrorFixer adds missing tests
- Compilation error → ErrorFixer fixes syntax

### Recovery Strategy
1. Log error with full context
2. Attempt auto-fix if applicable
3. If unable to fix: document error + stop gracefully
4. Provide clear next steps for user

---

## 9. Performance Metrics

### Target Times
- Phase 0: 2 minutes (setup)
- Phase 1: 3 minutes (analysis)
- Phase 2: 1 minute (patterns)
- Phase 3: 5 minutes (implementation)
- Phase 4: 4 minutes (testing)
- Phase 5: 2 minutes (review)
- Phase 6: 1 minute (validation)
- Phase 7: 1 minute (finalization)
- **TOTAL: ~19 minutes**

### Optimization Points
- Parallel analysis (Phase 1)
- Cached pattern detection
- Reuse crew context (jay-crew)
- Batch report generation

---

## 10. Security Considerations

- No credentials in reports
- No secrets in logs
- Task data isolated per execution
- Git operations signed with user credentials
- Context files with .gitignore rules

---

**See NEXT_STEPS.md for Phase 2-7 implementation roadmap**
