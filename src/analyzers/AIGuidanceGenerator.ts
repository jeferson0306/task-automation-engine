import path from 'path';
import { logger } from '../utils/logger.js';
import { ExecutionContext, Task, ProjectSnapshot, AntiPattern, XRayReport, ContractContext } from '../core/types.js';
import { TaskVerificationResult, AIGuidance } from './TaskVerifier.js';
import ProjectConventionsAnalyzer, { ProjectConventions } from './ProjectConventionsAnalyzer.js';

/**
 * Complete AI instruction set
 */
export interface AIInstructionSet {
  taskId: string;
  taskTitle: string;
  generatedAt: string;
  
  // High-level summary
  summary: {
    status: string;
    action: string;
    confidence: number;
    estimatedComplexity: 'trivial' | 'simple' | 'moderate' | 'complex' | 'very_complex';
  };

  // Project context
  projectContext: {
    language: string;
    framework: string;
    testFramework: string;
    buildTool: string;
    relevantPatterns: string[];
  };

  // Project conventions (learned from the codebase)
  conventions?: {
    formatting: {
      indentation: string;
      lineEnding: string;
    };
    naming: {
      classes: string;
      methods: string;
      constants: string;
    };
    logging: {
      framework: string;
      pattern: string;
      levels: string[];
    };
    errorHandling: {
      pattern: string;
      logsOnError: boolean;
    };
    similarCode?: string;
  };

  // Task requirements
  requirements: {
    description: string;
    acceptanceCriteria: string[];
    technicalDetails: string[];
    constraints: string[];
  };

  // Implementation guidance
  implementation: {
    filesToModify: FileModification[];
    filesToCreate: FileCreation[];
    codePatterns: CodePattern[];
    avoidPatterns: string[];
  };

  // Testing guidance
  testing: {
    testStrategy: string;
    testFiles: string[];
    testCases: TestCase[];
    coverageRequirements: string;
  };

  // Validation steps
  validation: {
    buildCommand: string;
    testCommand: string;
    lintCommand: string;
    manualChecks: string[];
  };

  // Step-by-step instructions
  steps: InstructionStep[];

  // Warnings and notes
  warnings: string[];
  notes: string[];
}

export interface FileModification {
  path: string;
  reason: string;
  suggestedChanges: string[];
  relatedTo: string; // which requirement
}

export interface FileCreation {
  suggestedPath: string;
  type: 'source' | 'test' | 'config';
  purpose: string;
  template?: string;
}

export interface CodePattern {
  name: string;
  description: string;
  example: string;
  useWhen: string;
}

export interface TestCase {
  name: string;
  type: 'unit' | 'integration' | 'e2e';
  description: string;
  input?: string;
  expectedOutput?: string;
}

export interface InstructionStep {
  order: number;
  action: string;
  description: string;
  commands?: string[];
  files?: string[];
  verification?: string;
}

/**
 * AI Guidance Generator
 * Generates comprehensive instructions for AI agents (Cursor, Claude, Copilot)
 */
export class AIGuidanceGenerator {
  /**
   * Generate complete instruction set for AI agents
   */
  async generate(
    context: ExecutionContext,
    verification: TaskVerificationResult,
    taskDescription: string
  ): Promise<AIInstructionSet> {
    logger.info('Generating AI instruction set...');

    const snapshot = context.projectSnapshot!;
    const task = context.task;

    // Analyze project conventions (LEARN from the codebase)
    const conventions = await ProjectConventionsAnalyzer.analyze(
      context.workingDir,
      snapshot,
      {
        keywords: verification.codeReferences?.patterns || [],
        relatedEntities: verification.relatedFiles.map(f => path.basename(f).replace(/\.[^.]+$/, '')),
      }
    );

    const instructionSet: AIInstructionSet = {
      taskId: task.taskId,
      taskTitle: task.title,
      generatedAt: new Date().toISOString(),

      summary: this.generateSummary(verification, taskDescription),
      projectContext: this.generateProjectContext(context, snapshot),
      conventions: this.formatConventions(conventions),
      requirements: this.generateRequirements(task, taskDescription, verification),
      implementation: this.generateImplementationGuidance(context, verification, taskDescription),
      testing: this.generateTestingGuidance(context, verification, taskDescription),
      validation: this.generateValidationSteps(context, snapshot),
      steps: this.generateStepByStep(verification, context, taskDescription),
      warnings: this.generateWarnings(verification, context),
      notes: this.generateNotes(verification, context, conventions),
    };

    logger.info('AI instruction set generated');
    return instructionSet;
  }

  /**
   * Format conventions for inclusion in instruction set
   */
  private formatConventions(conventions: ProjectConventions): AIInstructionSet['conventions'] {
    return {
      formatting: {
        indentation: `${conventions.formatting.indentation.type}${conventions.formatting.indentation.size ? ` (${conventions.formatting.indentation.size})` : ''}`,
        lineEnding: conventions.formatting.lineEnding.type,
      },
      naming: {
        classes: conventions.naming.classes.pattern,
        methods: conventions.naming.methods.pattern,
        constants: conventions.naming.constants.pattern,
      },
      logging: {
        framework: conventions.logging.framework.name,
        pattern: conventions.logging.messagePatterns.pattern,
        levels: conventions.logging.levelsUsed,
      },
      errorHandling: {
        pattern: conventions.errorHandling.pattern,
        logsOnError: conventions.errorHandling.logsOnError,
      },
      similarCode: conventions.similarImplementations.length > 0
        ? conventions.similarImplementations[0].code
        : undefined,
    };
  }

  /**
   * Generate markdown format for AI consumption
   */
  async generateMarkdown(instructionSet: AIInstructionSet): Promise<string> {
    let md = `# AI Task Instructions: ${instructionSet.taskId}\n\n`;
    md += `> Generated: ${instructionSet.generatedAt}\n\n`;

    // Summary
    md += `## Summary\n`;
    md += `- **Status:** ${instructionSet.summary.status}\n`;
    md += `- **Action Required:** ${instructionSet.summary.action}\n`;
    md += `- **Confidence:** ${instructionSet.summary.confidence}%\n`;
    md += `- **Complexity:** ${instructionSet.summary.estimatedComplexity}\n\n`;

    // Warnings first
    if (instructionSet.warnings.length > 0) {
      md += `## ⚠️ Warnings\n`;
      for (const warning of instructionSet.warnings) {
        md += `- ${warning}\n`;
      }
      md += '\n';
    }

    // Project Context
    md += `## Project Context\n`;
    md += `- **Language:** ${instructionSet.projectContext.language}\n`;
    md += `- **Framework:** ${instructionSet.projectContext.framework}\n`;
    md += `- **Test Framework:** ${instructionSet.projectContext.testFramework}\n`;
    md += `- **Build Tool:** ${instructionSet.projectContext.buildTool}\n\n`;

    // Project Conventions (learned from codebase)
    if (instructionSet.conventions) {
      md += `## Project Conventions (Follow These!)\n\n`;
      md += `> These conventions were learned from analyzing the existing codebase.\n\n`;
      
      md += `### Formatting\n`;
      md += `- **Indentation:** ${instructionSet.conventions.formatting.indentation}\n`;
      md += `- **Line Ending:** ${instructionSet.conventions.formatting.lineEnding}\n\n`;
      
      md += `### Naming\n`;
      md += `- **Classes:** ${instructionSet.conventions.naming.classes}\n`;
      md += `- **Methods:** ${instructionSet.conventions.naming.methods}\n`;
      md += `- **Constants:** ${instructionSet.conventions.naming.constants}\n\n`;
      
      md += `### Logging\n`;
      md += `- **Framework:** ${instructionSet.conventions.logging.framework}\n`;
      md += `- **Pattern:** ${instructionSet.conventions.logging.pattern}\n`;
      if (instructionSet.conventions.logging.levels.length > 0) {
        md += `- **Levels Used:** ${instructionSet.conventions.logging.levels.join(', ')}\n`;
      }
      md += '\n';
      
      md += `### Error Handling\n`;
      md += `- **Pattern:** ${instructionSet.conventions.errorHandling.pattern}\n`;
      md += `- **Log on Error:** ${instructionSet.conventions.errorHandling.logsOnError ? 'Yes' : 'No'}\n\n`;
      
      if (instructionSet.conventions.similarCode) {
        md += `### Similar Implementation (Reference)\n`;
        md += `\`\`\`\n${instructionSet.conventions.similarCode.substring(0, 800)}\n\`\`\`\n\n`;
      }
    }

    // Requirements
    md += `## Requirements\n`;
    md += `### Description\n${instructionSet.requirements.description}\n\n`;
    
    if (instructionSet.requirements.acceptanceCriteria.length > 0) {
      md += `### Acceptance Criteria\n`;
      for (const criteria of instructionSet.requirements.acceptanceCriteria) {
        md += `- [ ] ${criteria}\n`;
      }
      md += '\n';
    }

    if (instructionSet.requirements.technicalDetails.length > 0) {
      md += `### Technical Details\n`;
      for (const detail of instructionSet.requirements.technicalDetails) {
        md += `- ${detail}\n`;
      }
      md += '\n';
    }

    // Implementation
    md += `## Implementation\n`;
    
    if (instructionSet.implementation.filesToModify.length > 0) {
      md += `### Files to Modify\n`;
      for (const file of instructionSet.implementation.filesToModify) {
        md += `#### ${file.path}\n`;
        md += `- **Reason:** ${file.reason}\n`;
        if (file.suggestedChanges.length > 0) {
          md += `- **Changes:**\n`;
          for (const change of file.suggestedChanges) {
            md += `  - ${change}\n`;
          }
        }
        md += '\n';
      }
    }

    if (instructionSet.implementation.filesToCreate.length > 0) {
      md += `### Files to Create\n`;
      for (const file of instructionSet.implementation.filesToCreate) {
        md += `- **${file.suggestedPath}** (${file.type}): ${file.purpose}\n`;
      }
      md += '\n';
    }

    if (instructionSet.implementation.avoidPatterns.length > 0) {
      md += `### Patterns to Avoid\n`;
      for (const pattern of instructionSet.implementation.avoidPatterns) {
        md += `- ❌ ${pattern}\n`;
      }
      md += '\n';
    }

    // Testing
    md += `## Testing\n`;
    md += `### Strategy\n${instructionSet.testing.testStrategy}\n\n`;
    
    if (instructionSet.testing.testCases.length > 0) {
      md += `### Test Cases\n`;
      for (const tc of instructionSet.testing.testCases) {
        md += `- **${tc.name}** (${tc.type}): ${tc.description}\n`;
      }
      md += '\n';
    }

    // Validation
    md += `## Validation Commands\n`;
    md += `\`\`\`bash\n`;
    md += `# Build\n${instructionSet.validation.buildCommand}\n\n`;
    md += `# Test\n${instructionSet.validation.testCommand}\n\n`;
    md += `# Lint\n${instructionSet.validation.lintCommand}\n`;
    md += `\`\`\`\n\n`;

    // Step by step
    md += `## Step-by-Step Instructions\n`;
    for (const step of instructionSet.steps) {
      md += `### Step ${step.order}: ${step.action}\n`;
      md += `${step.description}\n`;
      if (step.commands && step.commands.length > 0) {
        md += `\`\`\`bash\n${step.commands.join('\n')}\n\`\`\`\n`;
      }
      if (step.files && step.files.length > 0) {
        md += `Files: ${step.files.join(', ')}\n`;
      }
      if (step.verification) {
        md += `✓ Verify: ${step.verification}\n`;
      }
      md += '\n';
    }

    // Notes
    if (instructionSet.notes.length > 0) {
      md += `## Notes\n`;
      for (const note of instructionSet.notes) {
        md += `- ${note}\n`;
      }
    }

    return md;
  }

  private generateSummary(verification: TaskVerificationResult, taskDescription: string): AIInstructionSet['summary'] {
    const complexity = this.estimateComplexity(taskDescription, verification);
    
    return {
      status: verification.status,
      action: verification.aiGuidance.action,
      confidence: verification.confidence,
      estimatedComplexity: complexity,
    };
  }

  private estimateComplexity(taskDescription: string, verification: TaskVerificationResult): AIInstructionSet['summary']['estimatedComplexity'] {
    const factors = {
      filesCount: verification.relatedFiles.length,
      evidenceCount: verification.evidence.length,
      descriptionLength: taskDescription.length,
      hasTests: verification.testCoverage.hasTests,
    };

    if (factors.filesCount <= 1 && factors.descriptionLength < 200) {
      return 'trivial';
    }
    if (factors.filesCount <= 2 && factors.descriptionLength < 500) {
      return 'simple';
    }
    if (factors.filesCount <= 5 && factors.descriptionLength < 1000) {
      return 'moderate';
    }
    if (factors.filesCount <= 10) {
      return 'complex';
    }
    return 'very_complex';
  }

  private generateProjectContext(context: ExecutionContext, snapshot: ProjectSnapshot): AIInstructionSet['projectContext'] {
    const stack = snapshot.detectedStack;
    const primaryLang = stack.languages[0]?.name || 'Unknown';
    const primaryFramework = stack.frameworks[0]?.name || 'None';

    let testFramework = 'Unknown';
    let buildTool = 'Unknown';

    // Detect from snapshot
    for (const dep of snapshot.dependencies) {
      if (['junit', 'jest', 'pytest', 'mocha', 'vitest'].includes(dep.name.toLowerCase())) {
        testFramework = dep.name;
      }
      if (['maven', 'gradle', 'npm', 'yarn', 'pip', 'cargo'].includes(dep.name.toLowerCase())) {
        buildTool = dep.name;
      }
    }

    // Fallback from config files
    for (const config of snapshot.configFiles) {
      if (config.path.includes('pom.xml')) buildTool = 'Maven';
      if (config.path.includes('build.gradle')) buildTool = 'Gradle';
      if (config.path.includes('package.json')) buildTool = 'npm';
    }

    return {
      language: primaryLang,
      framework: primaryFramework,
      testFramework,
      buildTool,
      relevantPatterns: this.extractRelevantPatterns(context),
    };
  }

  private extractRelevantPatterns(context: ExecutionContext): string[] {
    const patterns: string[] = [];

    if (context.contractContext) {
      if (context.contractContext.conventions.namingConvention) {
        patterns.push(`Naming: ${context.contractContext.conventions.namingConvention}`);
      }
      if (context.contractContext.conventions.assertionLibrary) {
        patterns.push(`Assertions: ${context.contractContext.conventions.assertionLibrary}`);
      }
    }

    if (context.testPatterns) {
      patterns.push(`Test pattern: ${context.testPatterns.namingConvention}`);
    }

    return patterns;
  }

  private generateRequirements(task: Task, taskDescription: string, verification: TaskVerificationResult): AIInstructionSet['requirements'] {
    const technicalDetails: string[] = [];
    const constraints: string[] = [];

    // Extract technical details from description
    const methodMatches = taskDescription.match(/\b([A-Z][a-z]+(?:[A-Z][a-z]+)*\.[a-z]\w+\(\))/g);
    if (methodMatches) {
      technicalDetails.push(`Methods to modify: ${methodMatches.join(', ')}`);
    }

    const classMatches = taskDescription.match(/\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g);
    if (classMatches) {
      technicalDetails.push(`Classes involved: ${[...new Set(classMatches)].join(', ')}`);
    }

    // Extract constraints from description
    if (taskDescription.toLowerCase().includes('should') || taskDescription.toLowerCase().includes('must')) {
      const constraintLines = taskDescription.split(/[.!?]/).filter(
        line => line.toLowerCase().includes('should') || line.toLowerCase().includes('must')
      );
      constraints.push(...constraintLines.map(l => l.trim()).filter(l => l.length > 10));
    }

    return {
      description: taskDescription,
      acceptanceCriteria: task.acceptanceCriteria,
      technicalDetails,
      constraints,
    };
  }

  private generateImplementationGuidance(
    context: ExecutionContext,
    verification: TaskVerificationResult,
    taskDescription: string
  ): AIInstructionSet['implementation'] {
    const filesToModify: FileModification[] = [];
    const filesToCreate: FileCreation[] = [];
    const codePatterns: CodePattern[] = [];
    const avoidPatterns: string[] = [];

    // Files from evidence
    for (const file of verification.relatedFiles) {
      if (!file.includes('test') && !file.includes('Test')) {
        const evidence = verification.evidence.filter(e => e.file === file);
        filesToModify.push({
          path: file,
          reason: evidence.length > 0 ? evidence[0].description : 'Related to task',
          suggestedChanges: evidence.map(e => e.snippet).slice(0, 3),
          relatedTo: 'Main implementation',
        });
      }
    }

    // Suggest test file if needed
    if (!verification.testCoverage.hasTests) {
      const mainFile = filesToModify[0];
      if (mainFile) {
        const testPath = mainFile.path
          .replace('/main/', '/test/')
          .replace('.java', 'Test.java')
          .replace('.ts', '.test.ts')
          .replace('.py', '_test.py');
        
        filesToCreate.push({
          suggestedPath: testPath,
          type: 'test',
          purpose: 'Test coverage for the implementation',
        });
      }
    }

    // Add common patterns to avoid based on anti-patterns detected
    if (context.contractContext) {
      avoidPatterns.push('Avoid hardcoded values - use constants');
      avoidPatterns.push('Avoid null without proper handling');
    }

    return {
      filesToModify,
      filesToCreate,
      codePatterns,
      avoidPatterns,
    };
  }

  private generateTestingGuidance(
    context: ExecutionContext,
    verification: TaskVerificationResult,
    taskDescription: string
  ): AIInstructionSet['testing'] {
    const testCases: TestCase[] = [];

    // Extract test cases from description
    if (taskDescription.toLowerCase().includes('when') || taskDescription.toLowerCase().includes('if')) {
      const scenarios = taskDescription.split(/[.!?]/).filter(
        line => line.toLowerCase().includes('when') || line.toLowerCase().includes('if')
      );
      
      for (const scenario of scenarios.slice(0, 5)) {
        testCases.push({
          name: this.generateTestName(scenario),
          type: 'unit',
          description: scenario.trim(),
        });
      }
    }

    // Add basic test cases
    if (testCases.length === 0) {
      testCases.push({
        name: 'should_handle_normal_case',
        type: 'unit',
        description: 'Test the main functionality works correctly',
      });
      testCases.push({
        name: 'should_handle_edge_cases',
        type: 'unit',
        description: 'Test boundary conditions and edge cases',
      });
      testCases.push({
        name: 'should_handle_error_cases',
        type: 'unit',
        description: 'Test error handling and invalid inputs',
      });
    }

    return {
      testStrategy: verification.testCoverage.hasTests
        ? 'Extend existing tests to cover new functionality'
        : 'Create new test file with comprehensive coverage',
      testFiles: verification.testCoverage.testFiles,
      testCases,
      coverageRequirements: 'Minimum 80% coverage for modified code',
    };
  }

  private generateTestName(scenario: string): string {
    return scenario
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 6)
      .join('_');
  }

  private generateValidationSteps(context: ExecutionContext, snapshot: ProjectSnapshot): AIInstructionSet['validation'] {
    let buildCommand = 'echo "Build command not detected"';
    let testCommand = 'echo "Test command not detected"';
    let lintCommand = 'echo "Lint command not detected"';

    // Detect from config files
    for (const config of snapshot.configFiles) {
      if (config.path.includes('pom.xml')) {
        buildCommand = 'mvn compile';
        testCommand = 'mvn test';
        lintCommand = 'mvn checkstyle:check';
      } else if (config.path.includes('build.gradle')) {
        buildCommand = './gradlew build';
        testCommand = './gradlew test';
        lintCommand = './gradlew check';
      } else if (config.path.includes('package.json')) {
        buildCommand = 'npm run build';
        testCommand = 'npm test';
        lintCommand = 'npm run lint';
      }
    }

    return {
      buildCommand,
      testCommand,
      lintCommand,
      manualChecks: [
        'Verify the implementation matches requirements',
        'Check for any regressions',
        'Review code for best practices',
      ],
    };
  }

  private generateStepByStep(
    verification: TaskVerificationResult,
    context: ExecutionContext,
    taskDescription: string
  ): InstructionStep[] {
    const steps: InstructionStep[] = [];
    let order = 1;

    const action = verification.aiGuidance.action;

    if (action === 'implement') {
      steps.push({
        order: order++,
        action: 'Understand Requirements',
        description: 'Read and understand the task description and acceptance criteria',
        verification: 'Can explain the task in your own words',
      });

      steps.push({
        order: order++,
        action: 'Identify Files',
        description: 'Locate the files that need to be modified',
        files: verification.relatedFiles,
        verification: 'All relevant files identified',
      });

      steps.push({
        order: order++,
        action: 'Implement Changes',
        description: 'Make the required code changes',
        files: verification.aiGuidance.filesToModify,
        verification: 'Code compiles without errors',
      });

      steps.push({
        order: order++,
        action: 'Add Tests',
        description: 'Create or update tests for the changes',
        files: verification.aiGuidance.filesToCreate,
        verification: 'All tests pass',
      });

    } else if (action === 'review') {
      steps.push({
        order: order++,
        action: 'Review Implementation',
        description: 'Check existing implementation against requirements',
        files: verification.relatedFiles,
        verification: 'Implementation matches requirements',
      });

      steps.push({
        order: order++,
        action: 'Verify Tests',
        description: 'Ensure tests cover the implementation',
        verification: 'Test coverage is adequate',
      });

    } else if (action === 'test') {
      steps.push({
        order: order++,
        action: 'Add Missing Tests',
        description: 'Implementation exists but needs test coverage',
        verification: 'All new tests pass',
      });

    } else if (action === 'commit') {
      steps.push({
        order: order++,
        action: 'Run Final Verification',
        description: 'Run all tests and linting',
        verification: 'All checks pass',
      });

      steps.push({
        order: order++,
        action: 'Commit Changes',
        description: `Commit with message referencing ${context.task.taskId}`,
        commands: [
          'git add -A',
          `git commit -m "${context.task.taskId}: ${context.task.title}"`,
        ],
        verification: 'Commit successful',
      });
    }

    // Always add final verification
    steps.push({
      order: order++,
      action: 'Final Verification',
      description: 'Verify the complete implementation',
      verification: 'All acceptance criteria met',
    });

    return steps;
  }

  private generateWarnings(verification: TaskVerificationResult, context: ExecutionContext): string[] {
    const warnings: string[] = [...verification.aiGuidance.warnings];

    if (verification.gitChanges.some(g => g.status === 'untracked')) {
      warnings.push('There are untracked files that might be related');
    }

    if (verification.confidence < 50) {
      warnings.push('Low confidence in verification - manual review recommended');
    }

    return warnings;
  }

  private generateNotes(
    verification: TaskVerificationResult, 
    context: ExecutionContext,
    conventions?: ProjectConventions
  ): string[] {
    const notes: string[] = [];

    if (verification.status === 'IMPLEMENTED_NOT_COMMITTED') {
      notes.push('Changes found but not committed - review before committing');
    }

    if (verification.evidence.some(e => e.type === 'task_reference' && e.file === 'git-history')) {
      notes.push('Task was previously referenced in git history');
    }

    // Add convention-based notes
    if (conventions) {
      if (conventions.logging.framework.name !== 'unknown') {
        notes.push(`Use ${conventions.logging.framework.name} for logging (follow existing patterns)`);
      }
      
      if (conventions.errorHandling.logsOnError) {
        notes.push('Remember to log errors in catch blocks (project convention)');
      }

      if (conventions.codeStructure.documentationStyle.hasJavadoc) {
        notes.push('Add Javadoc/documentation following project style');
      }

      if (conventions.similarImplementations.length > 0) {
        notes.push(`Reference similar implementation: ${conventions.similarImplementations[0].methodName}`);
      }
    }

    return notes;
  }
}

export default new AIGuidanceGenerator();
