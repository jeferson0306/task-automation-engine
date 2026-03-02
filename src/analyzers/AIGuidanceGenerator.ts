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
  priority: 'primary' | 'secondary' | 'optional';  // NEW: Priority for ordering
  pseudoDiff?: string;  // NEW: Expected changes in diff format
}

export interface FileCreation {
  suggestedPath: string;
  type: 'source' | 'test' | 'config';
  purpose: string;
  template?: string;
  sourceRoot?: string;  // NEW: Detected source root for correct path
}

// NEW: Source root detection
export interface SourceRoots {
  mainSource: string;     // e.g., src/main/java, src, lib
  testSource: string;     // e.g., src/test/java, test, tests
  resourcesDir?: string;  // e.g., src/main/resources
  detected: boolean;
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
   * Detect source roots from project structure
   * Handles Java/Maven/Gradle, Node.js, Python, Go, etc.
   */
  private detectSourceRoots(snapshot: ProjectSnapshot, workingDir: string): SourceRoots {
    const roots: SourceRoots = {
      mainSource: 'src',
      testSource: 'test',
      detected: false,
    };

    // Check for Maven/Gradle structure (Java/Kotlin)
    const hasMavenStructure = snapshot.files.some(f => 
      f.path.includes('src/main/java') || f.path.includes('src/main/kotlin')
    );
    const hasGradleStructure = snapshot.files.some(f => 
      f.path.includes('src/main/java') || f.path.includes('src/main/kotlin')
    );

    if (hasMavenStructure || hasGradleStructure) {
      // Detect language (Java or Kotlin)
      const hasJava = snapshot.files.some(f => f.path.includes('src/main/java'));
      const hasKotlin = snapshot.files.some(f => f.path.includes('src/main/kotlin'));
      
      roots.mainSource = hasKotlin ? 'src/main/kotlin' : 'src/main/java';
      roots.testSource = hasKotlin ? 'src/test/kotlin' : 'src/test/java';
      roots.resourcesDir = 'src/main/resources';
      roots.detected = true;
      logger.info(`  Detected Maven/Gradle structure: ${roots.mainSource}`);
      return roots;
    }

    // Check for Node.js/TypeScript structure
    const hasNodeStructure = snapshot.configFiles.some(c => 
      c.path.includes('package.json') || c.path.includes('tsconfig.json')
    );
    if (hasNodeStructure) {
      // Common patterns: src/, lib/, app/
      if (snapshot.files.some(f => f.path.startsWith('src/'))) {
        roots.mainSource = 'src';
        roots.testSource = snapshot.files.some(f => f.path.includes('__tests__')) 
          ? 'src/__tests__' 
          : 'test';
        roots.detected = true;
        logger.info('  Detected Node.js/TypeScript structure');
        return roots;
      }
    }

    // Check for Python structure
    const hasPythonStructure = snapshot.configFiles.some(c => 
      c.path.includes('setup.py') || c.path.includes('pyproject.toml')
    );
    if (hasPythonStructure) {
      roots.mainSource = 'src';
      roots.testSource = 'tests';
      roots.detected = true;
      logger.info('  Detected Python structure');
      return roots;
    }

    // Check for Go structure
    const hasGoStructure = snapshot.files.some(f => f.path.endsWith('.go'));
    if (hasGoStructure) {
      roots.mainSource = '.';
      roots.testSource = '.';  // Go tests are in same directory
      roots.detected = true;
      logger.info('  Detected Go structure');
      return roots;
    }

    logger.info('  Using default source roots (src, test)');
    return roots;
  }

  /**
   * Generate correct test file path based on source roots
   */
  private generateTestFilePath(
    mainFilePath: string, 
    sourceRoots: SourceRoots,
    language: string
  ): string {
    let testPath = mainFilePath;

    // Replace main source root with test source root
    if (mainFilePath.includes(sourceRoots.mainSource)) {
      testPath = mainFilePath.replace(sourceRoots.mainSource, sourceRoots.testSource);
    }

    // Add test suffix based on language
    const langLower = language.toLowerCase();
    if (langLower === 'java' || langLower === 'kotlin') {
      // Java/Kotlin: ClassName.java -> ClassNameTest.java
      testPath = testPath.replace(/\.(java|kt)$/, 'Test.$1');
    } else if (langLower === 'typescript' || langLower === 'javascript') {
      // TypeScript/JS: file.ts -> file.test.ts or file.spec.ts
      testPath = testPath.replace(/\.(ts|tsx|js|jsx)$/, '.test.$1');
    } else if (langLower === 'python') {
      // Python: module.py -> test_module.py
      const dir = path.dirname(testPath);
      const filename = path.basename(testPath);
      testPath = path.join(dir, `test_${filename}`);
    } else if (langLower === 'go') {
      // Go: file.go -> file_test.go (same directory)
      testPath = mainFilePath.replace('.go', '_test.go');
    }

    return testPath;
  }

  /**
   * Generate pseudo-diff showing expected changes
   */
  private generatePseudoDiff(
    taskDescription: string,
    verification: TaskVerificationResult
  ): string {
    const lines: string[] = [];
    
    // Extract bug and fix patterns from verification evidence
    const bugPatterns: string[] = [];
    const fixPatterns: string[] = [];
    
    for (const ev of verification.evidence) {
      if (ev.description.toLowerCase().includes('bug') || ev.description.toLowerCase().includes('wrong')) {
        // Extract pattern from description
        const match = ev.description.match(/uses?\s+(\w+)/i);
        if (match) bugPatterns.push(match[1]);
      }
      if (ev.description.toLowerCase().includes('should use') || ev.description.toLowerCase().includes('fix')) {
        const match = ev.description.match(/use\s+(\w+)/i);
        if (match) fixPatterns.push(match[1]);
      }
    }

    // Also extract from task description
    const useInsteadMatch = taskDescription.match(/use\s+([a-zA-Z0-9_.]+)\s+instead\s+of\s+([a-zA-Z0-9_.]+)/i);
    if (useInsteadMatch) {
      fixPatterns.push(useInsteadMatch[1]);
      bugPatterns.push(useInsteadMatch[2]);
    }

    if (bugPatterns.length > 0 || fixPatterns.length > 0) {
      lines.push('```diff');
      lines.push('# Expected changes (pseudo-diff):');
      
      for (const bug of [...new Set(bugPatterns)]) {
        lines.push(`- // OLD: code using ${bug}`);
      }
      for (const fix of [...new Set(fixPatterns)]) {
        lines.push(`+ // NEW: code using ${fix}`);
      }
      
      // Add more specific example if we have both
      if (bugPatterns.length > 0 && fixPatterns.length > 0) {
        lines.push('');
        lines.push('# Example transformation:');
        lines.push(`- result = entity.get${this.capitalize(bugPatterns[0])}();`);
        lines.push(`+ result = entity.get${this.capitalize(fixPatterns[0])}();`);
      }
      
      lines.push('```');
    }

    return lines.join('\n');
  }

  private capitalize(str: string): string {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

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
    
    // Detect source roots for correct file paths
    const sourceRoots = this.detectSourceRoots(snapshot, context.workingDir);
    logger.info(`  Source roots: main=${sourceRoots.mainSource}, test=${sourceRoots.testSource}`);

    // Analyze project conventions (LEARN from the codebase)
    const conventions = await ProjectConventionsAnalyzer.analyze(
      context.workingDir,
      snapshot,
      {
        keywords: verification.codeReferences?.patterns || [],
        relatedEntities: verification.relatedFiles.map(f => path.basename(f).replace(/\.[^.]+$/, '')),
      }
    );

    // Get project context for language detection
    const projectContext = this.generateProjectContext(context, snapshot);
    
    const instructionSet: AIInstructionSet = {
      taskId: task.taskId,
      taskTitle: task.title,
      generatedAt: new Date().toISOString(),

      summary: this.generateSummary(verification, taskDescription),
      projectContext,
      conventions: this.formatConventions(conventions),
      requirements: this.generateRequirements(task, taskDescription, verification),
      implementation: this.generateImplementationGuidance(context, verification, taskDescription, sourceRoots, projectContext.language),
      testing: this.generateTestingGuidance(context, verification, taskDescription, sourceRoots, projectContext.language),
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
    md += `## Implementation\n\n`;
    
    // CRITICAL: Add explicit instruction about order
    md += `> ⚠️ **IMPORTANT**: Modify the main source code FIRST, then create/update tests.\n`;
    md += `> Do NOT create test files before fixing the actual bug in the source code.\n\n`;
    
    if (instructionSet.implementation.filesToModify.length > 0) {
      // Separate primary and secondary files
      const primaryFiles = instructionSet.implementation.filesToModify.filter(f => f.priority === 'primary');
      const secondaryFiles = instructionSet.implementation.filesToModify.filter(f => f.priority !== 'primary');
      
      if (primaryFiles.length > 0) {
        md += `### 🎯 Primary Files to Modify (FIX THESE FIRST)\n\n`;
        for (const file of primaryFiles) {
          md += `#### ${file.path}\n`;
          md += `- **Priority:** PRIMARY - This is where the bug exists\n`;
          md += `- **Reason:** ${file.reason}\n`;
          if (file.suggestedChanges.length > 0) {
            md += `- **Changes:**\n`;
            for (const change of file.suggestedChanges) {
              md += `  - ${change}\n`;
            }
          }
          // Add pseudo-diff if available
          if (file.pseudoDiff) {
            md += `\n**Expected Changes:**\n${file.pseudoDiff}\n`;
          }
          md += '\n';
        }
      }
      
      if (secondaryFiles.length > 0) {
        md += `### Secondary Files (Review if needed)\n`;
        for (const file of secondaryFiles) {
          md += `- **${file.path}** - ${file.reason}\n`;
        }
        md += '\n';
      }
    }

    if (instructionSet.implementation.filesToCreate.length > 0) {
      md += `### Files to Create (AFTER fixing the code)\n\n`;
      md += `> Create these files only AFTER the main fix is complete and verified.\n\n`;
      for (const file of instructionSet.implementation.filesToCreate) {
        md += `- **${file.suggestedPath}**\n`;
        md += `  - Type: ${file.type}\n`;
        md += `  - Purpose: ${file.purpose}\n`;
        if (file.sourceRoot) {
          md += `  - Source Root: \`${file.sourceRoot}\`\n`;
        }
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
    taskDescription: string,
    sourceRoots: SourceRoots,
    language: string
  ): AIInstructionSet['implementation'] {
    const filesToModify: FileModification[] = [];
    const filesToCreate: FileCreation[] = [];
    const codePatterns: CodePattern[] = [];
    const avoidPatterns: string[] = [];
    const seenPaths = new Set<string>();

    // Generate pseudo-diff for expected changes
    const pseudoDiff = this.generatePseudoDiff(taskDescription, verification);

    // PRIORITY: Process main source files FIRST (not tests)
    // This ensures the AI modifies the actual code before creating tests
    for (const file of verification.relatedFiles) {
      const isTestFile = file.toLowerCase().includes('test') || 
                         file.includes('__tests__') ||
                         file.includes('_test.') ||
                         file.includes('.test.') ||
                         file.includes('.spec.');
      
      if (!isTestFile) {
        // Normalize path to avoid duplicates (absolute vs relative)
        const normalizedPath = file.includes(sourceRoots.mainSource)
          ? file.substring(file.indexOf(sourceRoots.mainSource))
          : file;
        
        if (seenPaths.has(normalizedPath) || seenPaths.has(path.basename(file))) {
          continue; // Skip duplicate paths
        }
        seenPaths.add(normalizedPath);
        seenPaths.add(path.basename(file));
        
        const evidence = verification.evidence.filter(e => e.file === file);
        const hasBugEvidence = evidence.some(e => 
          e.description.toLowerCase().includes('bug') || 
          e.type === 'code_validation'
        );
        
        filesToModify.push({
          path: normalizedPath,
          reason: evidence.length > 0 ? evidence[0].description : 'Related to task',
          suggestedChanges: evidence.map(e => e.snippet).filter(s => s).slice(0, 3),
          relatedTo: 'Main implementation',
          priority: hasBugEvidence ? 'primary' : 'secondary',
          pseudoDiff: hasBugEvidence ? pseudoDiff : undefined,
        });
      }
    }

    // Sort by priority: primary files first
    filesToModify.sort((a, b) => {
      if (a.priority === 'primary' && b.priority !== 'primary') return -1;
      if (b.priority === 'primary' && a.priority !== 'primary') return 1;
      return 0;
    });

    // Generate test file path correctly using source roots
    if (!verification.testCoverage.hasTests || verification.testCoverage.coverageStatus === 'uncovered') {
      const mainFile = filesToModify.find(f => f.priority === 'primary') || filesToModify[0];
      if (mainFile) {
        const testPath = this.generateTestFilePath(mainFile.path, sourceRoots, language);
        
        filesToCreate.push({
          suggestedPath: testPath,
          type: 'test',
          purpose: 'Test coverage for the implementation',
          sourceRoot: sourceRoots.testSource,
        });
      }
    }

    // Add common patterns to avoid based on anti-patterns detected
    if (context.contractContext) {
      avoidPatterns.push('Avoid hardcoded values - use constants');
      avoidPatterns.push('Avoid null without proper handling');
    }
    
    // Add task-specific patterns to avoid
    if (taskDescription.toLowerCase().includes('instead of')) {
      const match = taskDescription.match(/instead\s+of\s+([a-zA-Z0-9_.]+)/i);
      if (match) {
        avoidPatterns.push(`Do NOT use ${match[1]} (this is the bug we're fixing)`);
      }
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
    taskDescription: string,
    sourceRoots: SourceRoots,
    language: string
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
    
    // Separate main source files from test files
    const mainFiles = verification.aiGuidance.filesToModify.filter(f => 
      !f.toLowerCase().includes('test') && !f.includes('_test.') && !f.includes('.test.')
    );
    const testFiles = verification.aiGuidance.filesToCreate.filter(f => 
      f.toLowerCase().includes('test') || f.includes('_test.') || f.includes('.test.')
    );

    if (action === 'implement') {
      steps.push({
        order: order++,
        action: 'Understand Requirements',
        description: 'Read and understand the task description and acceptance criteria. Identify what the bug is and what the fix should be.',
        verification: 'Can explain the bug and required fix in your own words',
      });

      steps.push({
        order: order++,
        action: 'Locate Primary Source File',
        description: 'Open the PRIMARY source file that contains the bug. Do NOT open test files yet.',
        files: mainFiles.length > 0 ? mainFiles : verification.aiGuidance.filesToModify,
        verification: 'Primary source file is open and bug location is identified',
      });

      steps.push({
        order: order++,
        action: '🎯 FIX THE BUG (Critical Step)',
        description: 'Make the required code changes IN THE SOURCE FILE. This is the main implementation step. Apply the fix as described in the pseudo-diff. Do NOT create or modify test files at this step.',
        files: mainFiles.length > 0 ? mainFiles : verification.aiGuidance.filesToModify,
        verification: 'Bug is fixed. Code compiles without errors.',
      });

      steps.push({
        order: order++,
        action: 'Verify Compilation',
        description: 'Run the build command to verify the fix compiles correctly.',
        commands: ['mvn compile', '# or: ./gradlew compileJava', '# or: npm run build'],
        verification: 'Build succeeds with no errors',
      });

      steps.push({
        order: order++,
        action: 'Create/Update Tests (After Fix)',
        description: 'NOW create or update test files to cover the fix. Tests should verify both the old buggy behavior is gone and the new correct behavior works.',
        files: testFiles.length > 0 ? testFiles : verification.aiGuidance.filesToCreate,
        verification: 'Test file is created in the correct source root (e.g., src/test/java)',
      });

      steps.push({
        order: order++,
        action: 'Run Tests',
        description: 'Execute tests to verify the fix works correctly.',
        commands: ['mvn test', '# or: ./gradlew test', '# or: npm test'],
        verification: 'All tests pass, including the new ones',
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

  /**
   * Generate actionable Implementation Guide markdown
   * This is the file that tells the AI EXACTLY what to do
   */
  static generateImplementationGuide(
    taskId: string,
    taskDescription: string,
    verification: TaskVerificationResult,
    investigation?: {
      understanding: {
        layer: string;
        type: string;
        concepts: Array<{ name: string; type: string; importance: string; searchTerms: string[] }>;
        expectedBehavior?: string;
        actualBehavior?: string;
      };
      findings: Array<{ file: string; line?: number; type: string; description: string; code?: string }>;
      actions: Array<{ priority: number; type: string; description: string; files: string[]; reason: string }>;
    },
    workspace?: {
      projects: Array<{ name: string; path: string; type: string; language?: string }>;
    }
  ): string {
    const lines: string[] = [];
    
    lines.push(`# Implementation Guide: ${taskId}`);
    lines.push('');
    lines.push(`> Generated: ${new Date().toISOString()}`);
    lines.push('> This file contains actionable instructions for implementing the fix.');
    lines.push('');
    
    // Critical alerts section
    const isFrontendTask = investigation?.understanding.layer === 'frontend';
    const isBackendProject = verification.relatedFiles.some(f => 
      f.endsWith('.java') || f.endsWith('.kt') || f.endsWith('.go')
    );
    
    if (isFrontendTask && isBackendProject) {
      lines.push('## 🚨 CRITICAL: WRONG PROJECT');
      lines.push('');
      lines.push('**This task is a FRONTEND bug but you are in a BACKEND project!**');
      lines.push('');
      if (workspace) {
        const frontendProjects = workspace.projects.filter(p => 
          p.type === 'frontend' || p.name.includes('ui') || p.name.includes('web')
        );
        if (frontendProjects.length > 0) {
          lines.push('**Switch to one of these frontend projects:**');
          frontendProjects.forEach(p => {
            lines.push(`- \`${p.path}\` (${p.name})`);
          });
        }
      }
      lines.push('');
      lines.push('---');
      lines.push('');
    }
    
    // Task Understanding
    lines.push('## Task Understanding');
    lines.push('');
    lines.push(`**Type:** ${investigation?.understanding.type || verification.aiGuidance.action}`);
    lines.push(`**Layer:** ${investigation?.understanding.layer || 'unknown'}`);
    lines.push(`**Confidence:** ${verification.confidence}%`);
    lines.push('');
    
    // Expected vs Actual behavior
    if (investigation?.understanding.expectedBehavior || investigation?.understanding.actualBehavior) {
      lines.push('### Current Behavior (BUG)');
      lines.push('```');
      lines.push(investigation?.understanding.actualBehavior || 'Not detected');
      lines.push('```');
      lines.push('');
      lines.push('### Expected Behavior (FIX)');
      lines.push('```');
      lines.push(investigation?.understanding.expectedBehavior || 'Not detected');
      lines.push('```');
      lines.push('');
    }
    
    // Key concepts extracted
    if (investigation?.understanding.concepts && investigation.understanding.concepts.length > 0) {
      lines.push('### Key Concepts Extracted');
      lines.push('');
      const criticalConcepts = investigation.understanding.concepts.filter(c => c.importance === 'critical');
      const importantConcepts = investigation.understanding.concepts.filter(c => c.importance === 'important');
      
      if (criticalConcepts.length > 0) {
        lines.push('**Critical (must be addressed):**');
        criticalConcepts.forEach(c => {
          lines.push(`- \`${c.name}\` (${c.type}) → search for: ${c.searchTerms.slice(0, 3).join(', ')}`);
        });
        lines.push('');
      }
      if (importantConcepts.length > 0) {
        lines.push('**Important:**');
        importantConcepts.forEach(c => {
          lines.push(`- \`${c.name}\` (${c.type})`);
        });
        lines.push('');
      }
    }
    
    lines.push('---');
    lines.push('');
    
    // Primary file to modify
    lines.push('## 📁 File to Modify');
    lines.push('');
    
    // Determine primary file
    let primaryFile = '';
    let primaryReason = '';
    
    // If frontend task, prioritize frontend findings
    if (isFrontendTask && investigation?.findings) {
      const frontendFindings = investigation.findings.filter(f => 
        f.file.endsWith('.ts') || f.file.endsWith('.tsx') || 
        f.file.endsWith('.js') || f.file.endsWith('.vue') ||
        f.file.includes('/ui/') || f.file.includes('-ui/')
      );
      if (frontendFindings.length > 0) {
        // Prioritize util files for calculation bugs
        const utilFile = frontendFindings.find(f => 
          f.file.includes('util') || f.file.includes('helper') || f.file.includes('service')
        );
        if (utilFile) {
          primaryFile = utilFile.file;
          primaryReason = utilFile.description;
        } else {
          primaryFile = frontendFindings[0].file;
          primaryReason = frontendFindings[0].description;
        }
      }
    }
    
    // Fallback to verification files
    if (!primaryFile && verification.relatedFiles.length > 0) {
      // Filter by layer if known
      if (isFrontendTask) {
        const frontendFiles = verification.relatedFiles.filter(f => 
          f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.vue')
        );
        primaryFile = frontendFiles[0] || verification.relatedFiles[0];
      } else {
        primaryFile = verification.relatedFiles[0];
      }
      primaryReason = 'Matched from task description';
    }
    
    if (primaryFile) {
      lines.push('```');
      lines.push(primaryFile);
      lines.push('```');
      lines.push('');
      lines.push(`**Reason:** ${primaryReason}`);
    } else {
      lines.push('⚠️ **No specific file identified.** Manual search required.');
      lines.push('');
      lines.push('**Search suggestions:**');
      if (isFrontendTask) {
        lines.push('- Look for `*.util.ts`, `*.utils.ts`, `*.helper.ts` files');
        lines.push('- Search for functions containing "date", "calculate", "estimate"');
      }
    }
    lines.push('');
    
    // Function/Method to modify
    lines.push('## 🔧 Function/Method to Modify');
    lines.push('');
    
    const methodConcepts = investigation?.understanding.concepts?.filter(c => 
      c.type === 'calculation' || c.name.includes('get') || c.name.includes('calculate')
    ) || [];
    
    if (methodConcepts.length > 0) {
      lines.push('**Target functions (search for these):**');
      methodConcepts.forEach(c => {
        lines.push(`- \`${c.name}\``);
      });
    } else if (verification.codeReferences?.methods?.length > 0) {
      lines.push('**Methods referenced:**');
      verification.codeReferences.methods.forEach(m => {
        lines.push(`- \`${m}\``);
      });
    } else {
      lines.push('⚠️ **No specific method identified.**');
      lines.push('');
      lines.push('**Search for functions that:**');
      lines.push('- Calculate dates (e.g., `getDueDate`, `calculateEstimatedDate`)');
      lines.push('- Use `addDays`, `addWeeks`, `addWorkingDays`');
      lines.push('- Check status conditions before date calculation');
    }
    lines.push('');
    
    // Code findings
    if (investigation?.findings && investigation.findings.length > 0) {
      lines.push('---');
      lines.push('');
      lines.push('## 🔍 Code Findings');
      lines.push('');
      
      // Group by type
      const potentialBugs = investigation.findings.filter(f => f.type === 'potential-bug');
      const relevantCode = investigation.findings.filter(f => f.type === 'related-code' || f.type === 'transformation');
      
      if (potentialBugs.length > 0) {
        lines.push('### ⚠️ Potential Bug Locations');
        potentialBugs.slice(0, 5).forEach(f => {
          lines.push(`- \`${f.file}\`${f.line ? `:${f.line}` : ''}`);
          lines.push(`  - ${f.description}`);
          if (f.code) {
            lines.push('  ```');
            lines.push(`  ${f.code}`);
            lines.push('  ```');
          }
        });
        lines.push('');
      }
      
      if (relevantCode.length > 0) {
        lines.push('### Related Code');
        relevantCode.slice(0, 5).forEach(f => {
          lines.push(`- \`${f.file}\`${f.line ? `:${f.line}` : ''} - ${f.description}`);
        });
        lines.push('');
      }
    }
    
    // Recommended actions
    if (investigation?.actions && investigation.actions.length > 0) {
      lines.push('---');
      lines.push('');
      lines.push('## ✅ Recommended Actions');
      lines.push('');
      
      investigation.actions.forEach((action, idx) => {
        lines.push(`### ${idx + 1}. [${action.type.toUpperCase()}] ${action.description}`);
        if (action.files.length > 0) {
          lines.push('**Files:**');
          action.files.slice(0, 3).forEach(f => lines.push(`- \`${f}\``));
        }
        lines.push(`**Reason:** ${action.reason}`);
        lines.push('');
      });
    }
    
    // Step-by-step implementation
    lines.push('---');
    lines.push('');
    lines.push('## 📋 Step-by-Step Implementation');
    lines.push('');
    
    let stepNum = 1;
    
    // Step 1: Open file
    lines.push(`### Step ${stepNum++}: Open the file`);
    if (primaryFile) {
      lines.push(`Open \`${primaryFile}\``);
    } else {
      lines.push('Search for the file containing the buggy calculation.');
    }
    lines.push('');
    
    // Step 2: Locate function
    lines.push(`### Step ${stepNum++}: Locate the function`);
    if (methodConcepts.length > 0) {
      lines.push(`Search for: \`${methodConcepts.map(c => c.name).join('` or `')}\``);
    } else {
      lines.push('Look for date calculation logic, especially functions with "date", "due", "estimated" in name.');
    }
    lines.push('');
    
    // Step 3: Understand the bug
    lines.push(`### Step ${stepNum++}: Understand the current bug`);
    if (investigation?.understanding.actualBehavior) {
      lines.push(`Current behavior: ${investigation.understanding.actualBehavior}`);
    } else {
      lines.push('Read the function and understand what it currently does.');
    }
    lines.push('');
    
    // Step 4: Apply fix
    lines.push(`### Step ${stepNum++}: Apply the fix`);
    if (investigation?.understanding.expectedBehavior) {
      lines.push(`Expected behavior: ${investigation.understanding.expectedBehavior}`);
    } else {
      lines.push('Modify the code according to the task requirements.');
    }
    lines.push('');
    
    // Step 5: Add tests
    lines.push(`### Step ${stepNum++}: Add/update tests`);
    if (verification.testCoverage.testFiles.length > 0) {
      lines.push(`Test file: \`${verification.testCoverage.testFiles[0]}\``);
    } else {
      lines.push('Create tests covering:');
      lines.push('- The bug scenario (should now work correctly)');
      lines.push('- Edge cases (null dates, past dates, etc.)');
    }
    lines.push('');
    
    // Step 6: Verify
    lines.push(`### Step ${stepNum++}: Verify the fix`);
    lines.push('- Run tests');
    lines.push('- Test manually in the application');
    lines.push('- Verify the specific scenario from the bug report');
    lines.push('');
    
    // Footer
    lines.push('---');
    lines.push('');
    lines.push('_Generated by Task Automation Engine_');
    
    return lines.join('\n');
  }
}

export default new AIGuidanceGenerator();
