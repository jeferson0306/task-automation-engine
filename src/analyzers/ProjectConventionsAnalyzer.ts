import path from 'path';
import fs from 'fs-extra';
import { logger } from '../utils/logger.js';
import { ProjectSnapshot, ScannedFile } from '../core/types.js';

/**
 * Formatting conventions detected from the project
 */
export interface FormattingConventions {
  indentation: {
    type: 'spaces' | 'tabs' | 'mixed' | 'unknown';
    size?: number;
    confidence: number;
    source: string;
  };
  lineEnding: {
    type: 'lf' | 'crlf' | 'mixed' | 'unknown';
    confidence: number;
  };
  maxLineLength?: number;
  trailingComma?: boolean;
  semicolons?: boolean;
  quotes?: 'single' | 'double' | 'mixed';
}

/**
 * Naming conventions detected from the project
 */
export interface NamingConventions {
  classes: {
    pattern: string;
    examples: string[];
    confidence: number;
  };
  methods: {
    pattern: string;
    examples: string[];
    confidence: number;
  };
  variables: {
    pattern: string;
    examples: string[];
    confidence: number;
  };
  constants: {
    pattern: string;
    examples: string[];
    confidence: number;
  };
  packages?: {
    pattern: string;
    examples: string[];
  };
  files: {
    pattern: string;
    examples: string[];
  };
}

/**
 * Logging conventions detected from the project
 */
export interface LoggingConventions {
  framework: {
    name: string;
    importPattern: string;
    confidence: number;
  };
  loggerDeclaration: {
    pattern: string;
    examples: string[];
  };
  messagePatterns: {
    pattern: string;
    examples: string[];
  };
  levelsUsed: string[];
  commonContexts: string[];
}

/**
 * Error handling conventions
 */
export interface ErrorHandlingConventions {
  pattern: 'try-catch' | 'optional' | 'result' | 'either' | 'mixed';
  customExceptions: {
    baseClass?: string;
    examples: string[];
  };
  exceptionNaming: string;
  logsOnError: boolean;
  rethrowsOrWraps: 'rethrow' | 'wrap' | 'both';
}

/**
 * Code structure conventions
 */
export interface CodeStructureConventions {
  classStructure: {
    order: string[];
    examples: string[];
  };
  methodStructure: {
    averageLines: number;
    maxLines: number;
    patterns: string[];
  };
  importOrganization: {
    order: string[];
    grouping: boolean;
  };
  documentationStyle: {
    hasJavadoc: boolean;
    pattern?: string;
    examples: string[];
  };
}

/**
 * Complete project conventions
 */
export interface ProjectConventions {
  formatting: FormattingConventions;
  naming: NamingConventions;
  logging: LoggingConventions;
  errorHandling: ErrorHandlingConventions;
  codeStructure: CodeStructureConventions;
  linterRules: {
    tool?: string;
    configFile?: string;
    keyRules: string[];
  };
  similarImplementations: SimilarImplementation[];
  configFilesFound: string[];
  analysisConfidence: number;
}

/**
 * Similar implementation found in project
 */
export interface SimilarImplementation {
  file: string;
  methodName: string;
  description: string;
  code: string;
  relevanceScore: number;
}

/**
 * Project Conventions Analyzer
 * 
 * LEARNS from the project - never assumes anything.
 * Analyzes existing code to understand:
 * - How code is formatted
 * - How things are named
 * - How logging is done
 * - How errors are handled
 * - How similar features are implemented
 */
export class ProjectConventionsAnalyzer {

  /**
   * Analyze project conventions
   */
  static async analyze(
    projectPath: string,
    snapshot: ProjectSnapshot,
    taskContext?: { keywords: string[]; relatedEntities: string[] }
  ): Promise<ProjectConventions> {
    logger.info('\n📐 Analyzing project conventions...');

    // Find and read config files
    const configFiles = await this.findConfigFiles(projectPath);
    logger.info(`  Found ${configFiles.length} config files`);

    // Analyze formatting from configs and code
    const formatting = await this.analyzeFormatting(projectPath, configFiles, snapshot);
    logger.info(`  Formatting: ${formatting.indentation.type} (${formatting.indentation.confidence}% confidence)`);

    // Analyze naming conventions from code
    const naming = await this.analyzeNaming(snapshot);
    logger.info(`  Naming: classes=${naming.classes.pattern}, methods=${naming.methods.pattern}`);

    // Analyze logging patterns
    const logging = await this.analyzeLogging(snapshot);
    logger.info(`  Logging: ${logging.framework.name} (${logging.framework.confidence}% confidence)`);

    // Analyze error handling
    const errorHandling = await this.analyzeErrorHandling(snapshot);
    logger.info(`  Error handling: ${errorHandling.pattern}`);

    // Analyze code structure
    const codeStructure = await this.analyzeCodeStructure(snapshot);
    
    // Find linter rules
    const linterRules = await this.analyzeLinterRules(projectPath, configFiles);
    
    // Find similar implementations if context provided
    const similarImplementations = taskContext 
      ? await this.findSimilarImplementations(snapshot, taskContext)
      : [];
    
    if (similarImplementations.length > 0) {
      logger.info(`  Found ${similarImplementations.length} similar implementations`);
    }

    // Calculate overall confidence
    const analysisConfidence = this.calculateOverallConfidence(formatting, naming, logging);

    return {
      formatting,
      naming,
      logging,
      errorHandling,
      codeStructure,
      linterRules,
      similarImplementations,
      configFilesFound: configFiles.map(f => path.basename(f)),
      analysisConfidence,
    };
  }

  /**
   * Find configuration files in the project
   */
  private static async findConfigFiles(projectPath: string): Promise<string[]> {
    const configPatterns = [
      // Build system configs (highest priority for understanding project)
      'pom.xml',                    // Maven
      'build.gradle',               // Gradle (Groovy)
      'build.gradle.kts',           // Gradle (Kotlin)
      'settings.gradle',            // Gradle settings
      'settings.gradle.kts',        // Gradle settings (Kotlin)
      'gradle.properties',          // Gradle properties
      'package.json',               // Node.js
      'Cargo.toml',                 // Rust
      'go.mod',                     // Go
      'requirements.txt',           // Python
      'pyproject.toml',             // Python (modern)
      'setup.py',                   // Python
      'composer.json',              // PHP
      'Gemfile',                    // Ruby
      
      // Application configs (Spring Boot, Quarkus, etc.)
      'application.properties',
      'application.yml',
      'application.yaml',
      'application-dev.properties',
      'application-dev.yml',
      'application-prod.properties',
      'application-prod.yml',
      'bootstrap.properties',
      'bootstrap.yml',
      
      // Editor/formatting configs
      '.editorconfig',
      '.prettierrc',
      '.prettierrc.json',
      '.prettierrc.yml',
      '.prettierrc.yaml',
      '.prettierrc.js',
      'prettier.config.js',
      
      // Java/Kotlin code style configs
      'checkstyle.xml',
      'pmd.xml',
      'spotbugs.xml',
      'detekt.yml',
      'ktlint.xml',
      '.ktlint',
      'google-java-format.xml',
      'spotless.gradle',
      
      // JavaScript/TypeScript configs
      '.eslintrc',
      '.eslintrc.json',
      '.eslintrc.js',
      '.eslintrc.yml',
      'eslint.config.js',
      'eslint.config.mjs',
      'tslint.json',
      'biome.json',
      'tsconfig.json',
      'jsconfig.json',
      
      // Testing configs
      'jest.config.js',
      'jest.config.ts',
      'vitest.config.js',
      'vitest.config.ts',
      'pytest.ini',
      '.nycrc',
      
      // CI/CD configs
      '.gitlab-ci.yml',
      'Jenkinsfile',
      'azure-pipelines.yml',
      '.travis.yml',
      'bitbucket-pipelines.yml',
      
      // Docker configs
      'Dockerfile',
      'docker-compose.yml',
      'docker-compose.yaml',
      
      // General
      '.stylelintrc',
      'sonar-project.properties',
      '.env.example',
      'Makefile',
    ];

    const found: string[] = [];
    
    // Check root directory
    for (const pattern of configPatterns) {
      const filePath = path.join(projectPath, pattern);
      if (await fs.pathExists(filePath)) {
        found.push(filePath);
      }
    }

    // Check src/main/resources for Java projects (Spring Boot, etc.)
    const resourceDirs = [
      'src/main/resources',
      'src/test/resources',
      'config',
      '.config',
      'build',
      '.github',
      '.github/workflows',
    ];

    for (const subDir of resourceDirs) {
      const dirPath = path.join(projectPath, subDir);
      if (await fs.pathExists(dirPath)) {
        try {
          const files = await fs.readdir(dirPath);
          for (const file of files) {
            const fullPath = path.join(dirPath, file);
            // Include application configs, yml files, properties files, workflow files
            if (
              file.startsWith('application') ||
              file.endsWith('.properties') ||
              file.endsWith('.yml') ||
              file.endsWith('.yaml') ||
              file.endsWith('.xml') ||
              file.includes('lint') ||
              file.includes('style') ||
              file.includes('format')
            ) {
              const stat = await fs.stat(fullPath);
              if (stat.isFile()) {
                found.push(fullPath);
              }
            }
          }
        } catch {
          // Directory not readable
        }
      }
    }

    logger.debug(`  Config files found: ${found.map(f => path.basename(f)).join(', ')}`);
    return found;
  }

  /**
   * Analyze formatting conventions
   */
  private static async analyzeFormatting(
    projectPath: string,
    configFiles: string[],
    snapshot: ProjectSnapshot
  ): Promise<FormattingConventions> {
    const result: FormattingConventions = {
      indentation: { type: 'unknown', confidence: 0, source: 'none' },
      lineEnding: { type: 'unknown', confidence: 0 },
    };

    // 1. Check .editorconfig first (highest priority)
    const editorConfig = configFiles.find(f => f.endsWith('.editorconfig'));
    if (editorConfig) {
      try {
        const content = await fs.readFile(editorConfig, 'utf-8');
        
        // Parse indent_style
        const indentStyleMatch = content.match(/indent_style\s*=\s*(space|tab)/i);
        if (indentStyleMatch) {
          result.indentation.type = indentStyleMatch[1].toLowerCase() === 'space' ? 'spaces' : 'tabs';
          result.indentation.source = '.editorconfig';
          result.indentation.confidence = 95;
        }
        
        // Parse indent_size
        const indentSizeMatch = content.match(/indent_size\s*=\s*(\d+)/);
        if (indentSizeMatch) {
          result.indentation.size = parseInt(indentSizeMatch[1]);
        }
        
        // Parse end_of_line
        const eolMatch = content.match(/end_of_line\s*=\s*(lf|crlf)/i);
        if (eolMatch) {
          result.lineEnding.type = eolMatch[1].toLowerCase() as 'lf' | 'crlf';
          result.lineEnding.confidence = 95;
        }
        
        // Parse max_line_length
        const maxLineMatch = content.match(/max_line_length\s*=\s*(\d+)/);
        if (maxLineMatch) {
          result.maxLineLength = parseInt(maxLineMatch[1]);
        }
      } catch {
        // Could not read file
      }
    }

    // 2. Check prettier config
    const prettierConfig = configFiles.find(f => f.includes('prettier'));
    if (prettierConfig && result.indentation.confidence < 90) {
      try {
        const content = await fs.readFile(prettierConfig, 'utf-8');
        const config = JSON.parse(content);
        
        if (config.useTabs !== undefined) {
          result.indentation.type = config.useTabs ? 'tabs' : 'spaces';
          result.indentation.source = 'prettierrc';
          result.indentation.confidence = 90;
        }
        if (config.tabWidth) {
          result.indentation.size = config.tabWidth;
        }
        if (config.semi !== undefined) {
          result.semicolons = config.semi;
        }
        if (config.singleQuote !== undefined) {
          result.quotes = config.singleQuote ? 'single' : 'double';
        }
        if (config.trailingComma) {
          result.trailingComma = config.trailingComma !== 'none';
        }
      } catch {
        // Could not parse config
      }
    }

    // 3. If still unknown, analyze actual code files
    if (result.indentation.confidence < 80) {
      const analysis = this.analyzeIndentationFromCode(snapshot);
      if (analysis.confidence > result.indentation.confidence) {
        result.indentation = analysis;
      }
    }

    return result;
  }

  /**
   * Analyze indentation from actual code
   */
  private static analyzeIndentationFromCode(snapshot: ProjectSnapshot): FormattingConventions['indentation'] {
    let spaceCounts: Record<number, number> = {};
    let tabCount = 0;
    let spaceCount = 0;
    let totalLines = 0;

    for (const file of snapshot.files.slice(0, 50)) { // Sample first 50 files
      if (!file.content) continue;
      
      const lines = file.content.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        
        const leadingWhitespace = line.match(/^(\s+)/);
        if (leadingWhitespace) {
          const ws = leadingWhitespace[1];
          totalLines++;
          
          if (ws.includes('\t')) {
            tabCount++;
          } else {
            spaceCount++;
            const len = ws.length;
            spaceCounts[len] = (spaceCounts[len] || 0) + 1;
          }
        }
      }
    }

    if (totalLines === 0) {
      return { type: 'unknown', confidence: 0, source: 'none' };
    }

    const tabRatio = tabCount / totalLines;
    const spaceRatio = spaceCount / totalLines;

    let type: 'spaces' | 'tabs' | 'mixed' = 'mixed';
    let confidence = 50;

    if (tabRatio > 0.8) {
      type = 'tabs';
      confidence = Math.round(tabRatio * 100);
    } else if (spaceRatio > 0.8) {
      type = 'spaces';
      confidence = Math.round(spaceRatio * 100);
    }

    // Find most common space indentation size
    let size: number | undefined;
    if (type === 'spaces') {
      const sizes = Object.entries(spaceCounts)
        .map(([s, c]) => ({ size: parseInt(s), count: c }))
        .sort((a, b) => b.count - a.count);
      
      // Find GCD of common sizes to get base indent
      if (sizes.length > 0) {
        const commonSizes = sizes.slice(0, 5).map(s => s.size);
        size = this.findGCD(commonSizes);
        if (size > 8) size = 4; // Sanity check
      }
    }

    return { type, size, confidence, source: 'code analysis' };
  }

  /**
   * Find GCD of numbers (for detecting indent size)
   */
  private static findGCD(numbers: number[]): number {
    const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
    return numbers.reduce((acc, n) => gcd(acc, n), numbers[0]);
  }

  /**
   * Analyze naming conventions from code
   */
  private static async analyzeNaming(snapshot: ProjectSnapshot): Promise<NamingConventions> {
    const classes: string[] = [];
    const methods: string[] = [];
    const variables: string[] = [];
    const constants: string[] = [];
    const packages: string[] = [];

    for (const file of snapshot.files) {
      if (!file.content) continue;

      // Extract class names (Java/Kotlin/TypeScript patterns)
      const classMatches = file.content.match(/(?:class|interface|enum|object)\s+([A-Z][a-zA-Z0-9]*)/g);
      if (classMatches) {
        classes.push(...classMatches.map(m => m.split(/\s+/)[1]));
      }

      // Extract method names
      const methodPatterns = [
        /(?:public|private|protected|internal)?\s*(?:static)?\s*(?:fun|void|[A-Z]\w*)\s+([a-z][a-zA-Z0-9]*)\s*\(/g, // Java/Kotlin
        /(?:async\s+)?([a-z][a-zA-Z0-9]*)\s*\([^)]*\)\s*[:{]/g, // TypeScript/JavaScript
        /def\s+([a-z_][a-z0-9_]*)\s*\(/g, // Python
      ];
      
      for (const pattern of methodPatterns) {
        let match;
        while ((match = pattern.exec(file.content)) !== null) {
          if (match[1] && !['if', 'for', 'while', 'switch', 'catch'].includes(match[1])) {
            methods.push(match[1]);
          }
        }
      }

      // Extract constants (SCREAMING_CASE)
      const constantMatches = file.content.match(/(?:const|final|val)\s+([A-Z][A-Z0-9_]+)\s*[=:]/g);
      if (constantMatches) {
        constants.push(...constantMatches.map(m => {
          const parts = m.split(/\s+/);
          return parts[1] || '';
        }).filter(Boolean));
      }

      // Extract package names
      const packageMatch = file.content.match(/^package\s+([a-z][a-z0-9.]*)/m);
      if (packageMatch) {
        packages.push(packageMatch[1]);
      }
    }

    return {
      classes: {
        pattern: this.detectPattern(classes),
        examples: [...new Set(classes)].slice(0, 5),
        confidence: classes.length > 5 ? 90 : 60,
      },
      methods: {
        pattern: this.detectPattern(methods),
        examples: [...new Set(methods)].slice(0, 5),
        confidence: methods.length > 10 ? 90 : 60,
      },
      variables: {
        pattern: this.detectPattern(variables),
        examples: [...new Set(variables)].slice(0, 5),
        confidence: variables.length > 5 ? 80 : 40,
      },
      constants: {
        pattern: this.detectPattern(constants),
        examples: [...new Set(constants)].slice(0, 5),
        confidence: constants.length > 3 ? 90 : 50,
      },
      packages: packages.length > 0 ? {
        pattern: this.detectPackagePattern(packages),
        examples: [...new Set(packages)].slice(0, 3),
      } : undefined,
      files: {
        pattern: this.detectFileNamingPattern(snapshot.files),
        examples: snapshot.files.slice(0, 5).map(f => path.basename(f.path)),
      },
    };
  }

  /**
   * Detect naming pattern from examples
   */
  private static detectPattern(names: string[]): string {
    if (names.length === 0) return 'unknown';

    let camelCase = 0;
    let pascalCase = 0;
    let snakeCase = 0;
    let screamingCase = 0;

    for (const name of names) {
      if (/^[a-z][a-zA-Z0-9]*$/.test(name) && /[A-Z]/.test(name)) {
        camelCase++;
      } else if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
        pascalCase++;
      } else if (/^[a-z][a-z0-9_]*$/.test(name)) {
        snakeCase++;
      } else if (/^[A-Z][A-Z0-9_]*$/.test(name)) {
        screamingCase++;
      }
    }

    const total = names.length;
    if (pascalCase / total > 0.7) return 'PascalCase';
    if (camelCase / total > 0.7) return 'camelCase';
    if (snakeCase / total > 0.7) return 'snake_case';
    if (screamingCase / total > 0.7) return 'SCREAMING_SNAKE_CASE';
    
    return 'mixed';
  }

  /**
   * Detect package naming pattern
   */
  private static detectPackagePattern(packages: string[]): string {
    if (packages.length === 0) return 'unknown';
    
    // Find common prefix
    const sorted = packages.sort();
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    
    let commonPrefix = '';
    for (let i = 0; i < Math.min(first.length, last.length); i++) {
      if (first[i] === last[i]) {
        commonPrefix += first[i];
      } else {
        break;
      }
    }
    
    // Trim to last dot
    const lastDot = commonPrefix.lastIndexOf('.');
    if (lastDot > 0) {
      commonPrefix = commonPrefix.substring(0, lastDot);
    }
    
    return commonPrefix || packages[0].split('.').slice(0, 3).join('.');
  }

  /**
   * Detect file naming pattern
   */
  private static detectFileNamingPattern(files: ScannedFile[]): string {
    const sourceFiles = files.filter(f => 
      /\.(java|kt|ts|tsx|js|jsx|py|go|rs)$/.test(f.path)
    );
    
    if (sourceFiles.length === 0) return 'unknown';
    
    let pascalCase = 0;
    let kebabCase = 0;
    let snakeCase = 0;
    
    for (const file of sourceFiles) {
      const name = path.basename(file.path).replace(/\.[^.]+$/, '');
      
      if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) pascalCase++;
      else if (/^[a-z][a-z0-9-]*$/.test(name)) kebabCase++;
      else if (/^[a-z][a-z0-9_]*$/.test(name)) snakeCase++;
    }
    
    const total = sourceFiles.length;
    if (pascalCase / total > 0.7) return 'PascalCase';
    if (kebabCase / total > 0.7) return 'kebab-case';
    if (snakeCase / total > 0.7) return 'snake_case';
    
    return 'mixed';
  }

  /**
   * Analyze logging conventions
   */
  private static async analyzeLogging(snapshot: ProjectSnapshot): Promise<LoggingConventions> {
    const result: LoggingConventions = {
      framework: { name: 'unknown', importPattern: '', confidence: 0 },
      loggerDeclaration: { pattern: '', examples: [] },
      messagePatterns: { pattern: '', examples: [] },
      levelsUsed: [],
      commonContexts: [],
    };

    // Logging framework detection patterns
    const frameworkPatterns: Array<{ name: string; imports: RegExp[]; declaration: RegExp }> = [
      {
        name: 'SLF4J',
        imports: [/import\s+org\.slf4j\.Logger/i, /import\s+org\.slf4j\.LoggerFactory/i],
        declaration: /Logger\s+\w+\s*=\s*LoggerFactory\.getLogger/,
      },
      {
        name: 'Log4j2',
        imports: [/import\s+org\.apache\.logging\.log4j\.Logger/i],
        declaration: /Logger\s+\w+\s*=\s*LogManager\.getLogger/,
      },
      {
        name: 'java.util.logging',
        imports: [/import\s+java\.util\.logging\.Logger/i],
        declaration: /Logger\s+\w+\s*=\s*Logger\.getLogger/,
      },
      {
        name: 'Kotlin Logging',
        imports: [/import\s+mu\.KotlinLogging/i, /import\s+io\.github\.microutils\.logging/i],
        declaration: /val\s+\w+\s*=\s*KotlinLogging\.logger/,
      },
      {
        name: 'Winston',
        imports: [/import.*winston/i, /require\(['"]winston['"]\)/i],
        declaration: /createLogger\(|winston\.createLogger/,
      },
      {
        name: 'Pino',
        imports: [/import.*pino/i, /require\(['"]pino['"]\)/i],
        declaration: /pino\(/,
      },
      {
        name: 'Console',
        imports: [],
        declaration: /console\.(log|info|warn|error|debug)/,
      },
    ];

    const frameworkCounts: Record<string, number> = {};
    const loggerDeclarations: string[] = [];
    const logMessages: string[] = [];
    const levelsFound: Set<string> = new Set();

    for (const file of snapshot.files) {
      if (!file.content) continue;

      // Check for framework imports/usage
      for (const fw of frameworkPatterns) {
        for (const importPattern of fw.imports) {
          if (importPattern.test(file.content)) {
            frameworkCounts[fw.name] = (frameworkCounts[fw.name] || 0) + 1;
          }
        }
        
        if (fw.declaration.test(file.content)) {
          frameworkCounts[fw.name] = (frameworkCounts[fw.name] || 0) + 2;
          
          // Extract declaration example
          const declMatch = file.content.match(fw.declaration);
          if (declMatch) {
            loggerDeclarations.push(declMatch[0]);
          }
        }
      }

      // Extract log message patterns
      const logPatterns = [
        /(?:logger|log|console)\.(debug|info|warn|error|trace)\s*\(\s*["'`]([^"'`]+)["'`]/gi,
        /(?:logger|log)\.(debug|info|warn|error|trace)\s*\{[^}]*["'`]([^"'`]+)["'`]/gi,
      ];

      for (const pattern of logPatterns) {
        let match;
        while ((match = pattern.exec(file.content)) !== null) {
          levelsFound.add(match[1].toLowerCase());
          if (match[2] && logMessages.length < 20) {
            logMessages.push(match[2]);
          }
        }
      }
    }

    // Determine most used framework
    const sortedFrameworks = Object.entries(frameworkCounts)
      .sort(([, a], [, b]) => b - a);
    
    if (sortedFrameworks.length > 0) {
      const [name, count] = sortedFrameworks[0];
      const fw = frameworkPatterns.find(f => f.name === name);
      result.framework = {
        name,
        importPattern: fw?.imports[0]?.source || '',
        confidence: Math.min(count * 10, 95),
      };
    }

    result.loggerDeclaration.examples = [...new Set(loggerDeclarations)].slice(0, 3);
    result.messagePatterns.examples = [...new Set(logMessages)].slice(0, 5);
    result.messagePatterns.pattern = this.detectLogMessagePattern(logMessages);
    result.levelsUsed = Array.from(levelsFound);

    return result;
  }

  /**
   * Detect log message pattern
   */
  private static detectLogMessagePattern(messages: string[]): string {
    if (messages.length === 0) return 'unknown';

    // Check for placeholder patterns
    let slf4jStyle = 0; // {}
    let printfStyle = 0; // %s
    let templateStyle = 0; // ${var}
    let concatenation = 0; // +

    for (const msg of messages) {
      if (msg.includes('{}')) slf4jStyle++;
      if (/%[sd]/.test(msg)) printfStyle++;
      if (/\$\{/.test(msg)) templateStyle++;
      if (/\s*\+\s*/.test(msg)) concatenation++;
    }

    const total = messages.length;
    if (slf4jStyle / total > 0.5) return 'SLF4J style: logger.info("Message {}", value)';
    if (printfStyle / total > 0.5) return 'Printf style: logger.info("Message %s", value)';
    if (templateStyle / total > 0.5) return 'Template style: logger.info(`Message ${value}`)';
    
    return 'String concatenation or simple messages';
  }

  /**
   * Analyze error handling conventions
   */
  private static async analyzeErrorHandling(snapshot: ProjectSnapshot): Promise<ErrorHandlingConventions> {
    const result: ErrorHandlingConventions = {
      pattern: 'try-catch',
      customExceptions: { examples: [] },
      exceptionNaming: '',
      logsOnError: false,
      rethrowsOrWraps: 'rethrow',
    };

    let tryCatchCount = 0;
    let optionalCount = 0;
    let resultCount = 0;
    const customExceptions: string[] = [];
    let logsInCatch = 0;
    let wrapsException = 0;
    let rethrowsException = 0;

    for (const file of snapshot.files) {
      if (!file.content) continue;

      // Count try-catch blocks
      const tryMatches = file.content.match(/\btry\s*\{/g);
      if (tryMatches) tryCatchCount += tryMatches.length;

      // Count Optional usage
      const optionalMatches = file.content.match(/Optional[.<]/g);
      if (optionalMatches) optionalCount += optionalMatches.length;

      // Count Result/Either usage
      const resultMatches = file.content.match(/\b(Result|Either)[.<]/g);
      if (resultMatches) resultCount += resultMatches.length;

      // Find custom exception classes
      const exceptionClasses = file.content.match(/class\s+(\w+Exception)\s+(?:extends|:)/g);
      if (exceptionClasses) {
        customExceptions.push(...exceptionClasses.map(m => m.split(/\s+/)[1]));
      }

      // Check if logs in catch blocks
      const catchBlocks = file.content.match(/catch\s*\([^)]+\)\s*\{[^}]+\}/gs);
      if (catchBlocks) {
        for (const block of catchBlocks) {
          if (/logger\.(error|warn)|log\.(error|warn)|console\.(error|warn)/.test(block)) {
            logsInCatch++;
          }
          if (/throw\s+new\s+\w+.*\(.*,\s*\w+\)/.test(block)) {
            wrapsException++;
          }
          if (/throw\s+\w+/.test(block) && !/throw\s+new/.test(block)) {
            rethrowsException++;
          }
        }
      }
    }

    // Determine primary pattern
    const total = tryCatchCount + optionalCount + resultCount;
    if (total > 0) {
      if (optionalCount / total > 0.5) result.pattern = 'optional';
      else if (resultCount / total > 0.5) result.pattern = 'result';
      else result.pattern = 'try-catch';
    }

    // Custom exceptions
    result.customExceptions.examples = [...new Set(customExceptions)].slice(0, 5);
    if (customExceptions.length > 0) {
      // Try to find base class
      const baseCandidates = customExceptions.filter(e => 
        e.includes('Base') || e.includes('Abstract') || e === 'BusinessException'
      );
      result.customExceptions.baseClass = baseCandidates[0];
      result.exceptionNaming = this.detectPattern(customExceptions);
    }

    result.logsOnError = logsInCatch > tryCatchCount * 0.5;
    result.rethrowsOrWraps = wrapsException > rethrowsException ? 'wrap' : 
                            rethrowsException > wrapsException ? 'rethrow' : 'both';

    return result;
  }

  /**
   * Analyze code structure conventions
   */
  private static async analyzeCodeStructure(snapshot: ProjectSnapshot): Promise<CodeStructureConventions> {
    const methodLengths: number[] = [];
    const classOrders: string[][] = [];
    const importOrders: string[][] = [];
    const javadocs: string[] = [];

    for (const file of snapshot.files) {
      if (!file.content) continue;

      // Analyze method lengths
      const methods = file.content.match(/(?:public|private|protected|fun|def|function)\s+\w+[^{]*\{[^}]*\}/gs);
      if (methods) {
        for (const method of methods) {
          methodLengths.push(method.split('\n').length);
        }
      }

      // Extract Javadoc patterns
      const javadocMatches = file.content.match(/\/\*\*[\s\S]*?\*\//g);
      if (javadocMatches && javadocs.length < 5) {
        javadocs.push(...javadocMatches.slice(0, 2));
      }

      // Analyze import grouping
      const imports = file.content.match(/^import\s+.+$/gm);
      if (imports && imports.length > 3) {
        importOrders.push(imports);
      }
    }

    // Calculate method stats
    const avgMethodLength = methodLengths.length > 0 
      ? Math.round(methodLengths.reduce((a, b) => a + b, 0) / methodLengths.length)
      : 20;
    const maxMethodLength = methodLengths.length > 0
      ? Math.max(...methodLengths)
      : 100;

    // Detect import organization
    let hasGrouping = false;
    if (importOrders.length > 0) {
      for (const imports of importOrders) {
        const hasBlankLine = imports.some((imp, i) => 
          i > 0 && imp.split('.')[0] !== imports[i-1].split('.')[0]
        );
        if (hasBlankLine) hasGrouping = true;
      }
    }

    return {
      classStructure: {
        order: ['fields', 'constructors', 'public methods', 'private methods'],
        examples: [],
      },
      methodStructure: {
        averageLines: avgMethodLength,
        maxLines: maxMethodLength,
        patterns: [],
      },
      importOrganization: {
        order: this.detectImportOrder(importOrders),
        grouping: hasGrouping,
      },
      documentationStyle: {
        hasJavadoc: javadocs.length > 0,
        pattern: javadocs.length > 0 ? 'Javadoc-style' : undefined,
        examples: javadocs.slice(0, 2),
      },
    };
  }

  /**
   * Detect import order from examples
   */
  private static detectImportOrder(importOrders: string[][]): string[] {
    if (importOrders.length === 0) return [];

    // Find most common first import prefix
    const firstPrefixes: Record<string, number> = {};
    for (const imports of importOrders) {
      if (imports.length > 0) {
        const prefix = imports[0].split('.').slice(0, 2).join('.');
        firstPrefixes[prefix] = (firstPrefixes[prefix] || 0) + 1;
      }
    }

    const sorted = Object.entries(firstPrefixes)
      .sort(([, a], [, b]) => b - a)
      .map(([prefix]) => prefix);

    return sorted.slice(0, 3);
  }

  /**
   * Analyze linter rules
   */
  private static async analyzeLinterRules(
    projectPath: string,
    configFiles: string[]
  ): Promise<ProjectConventions['linterRules']> {
    const result: ProjectConventions['linterRules'] = {
      keyRules: [],
    };

    // Check for checkstyle (Java)
    const checkstyle = configFiles.find(f => f.includes('checkstyle'));
    if (checkstyle) {
      result.tool = 'Checkstyle';
      result.configFile = path.basename(checkstyle);
      try {
        const content = await fs.readFile(checkstyle, 'utf-8');
        // Extract module names
        const modules = content.match(/<module\s+name="([^"]+)"/g);
        if (modules) {
          result.keyRules = modules
            .map(m => m.match(/name="([^"]+)"/)?.[1] || '')
            .filter(Boolean)
            .slice(0, 10);
        }
      } catch {
        // Could not read
      }
      return result;
    }

    // Check for detekt (Kotlin)
    const detekt = configFiles.find(f => f.includes('detekt'));
    if (detekt) {
      result.tool = 'Detekt';
      result.configFile = path.basename(detekt);
      return result;
    }

    // Check for ESLint
    const eslint = configFiles.find(f => f.includes('eslint'));
    if (eslint) {
      result.tool = 'ESLint';
      result.configFile = path.basename(eslint);
      try {
        const content = await fs.readFile(eslint, 'utf-8');
        const config = JSON.parse(content);
        if (config.rules) {
          result.keyRules = Object.keys(config.rules).slice(0, 10);
        }
      } catch {
        // Could not parse
      }
      return result;
    }

    return result;
  }

  /**
   * Find similar implementations in the codebase
   */
  private static async findSimilarImplementations(
    snapshot: ProjectSnapshot,
    context: { keywords: string[]; relatedEntities: string[] }
  ): Promise<SimilarImplementation[]> {
    const similar: SimilarImplementation[] = [];
    const keywords = [...context.keywords, ...context.relatedEntities]
      .map(k => k.toLowerCase());

    for (const file of snapshot.files) {
      if (!file.content) continue;
      if (file.classification === 'test') continue;

      const content = file.content.toLowerCase();
      
      // Score relevance
      let score = 0;
      for (const keyword of keywords) {
        if (content.includes(keyword)) {
          score += 10;
        }
      }

      if (score < 20) continue;

      // Extract methods from file
      const methodPatterns = [
        /(?:public|private|protected)?\s*(?:static)?\s*(?:fun|void|[A-Z]\w*<[^>]*>|[A-Z]\w*)\s+([a-z]\w*)\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{[^}]+\}/gs,
      ];

      for (const pattern of methodPatterns) {
        let match;
        while ((match = pattern.exec(file.content)) !== null) {
          const methodCode = match[0];
          const methodName = match[1];
          
          // Check if method is relevant
          const methodLower = methodCode.toLowerCase();
          let methodScore = 0;
          for (const keyword of keywords) {
            if (methodLower.includes(keyword)) methodScore += 15;
          }

          if (methodScore > 20 && similar.length < 5) {
            similar.push({
              file: file.path,
              methodName,
              description: `Similar implementation found`,
              code: methodCode.substring(0, 500),
              relevanceScore: methodScore,
            });
          }
        }
      }
    }

    return similar.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, 3);
  }

  /**
   * Calculate overall confidence
   */
  private static calculateOverallConfidence(
    formatting: FormattingConventions,
    naming: NamingConventions,
    logging: LoggingConventions
  ): number {
    const confidences = [
      formatting.indentation.confidence,
      naming.classes.confidence,
      naming.methods.confidence,
      logging.framework.confidence,
    ];

    return Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length);
  }

  /**
   * Generate markdown report of conventions
   */
  static generateReport(conventions: ProjectConventions): string {
    let report = `# Project Conventions Analysis\n\n`;
    report += `> Analysis Confidence: ${conventions.analysisConfidence}%\n\n`;
    report += `> Config Files Found: ${conventions.configFilesFound.join(', ') || 'none'}\n\n`;

    report += `## Formatting\n\n`;
    report += `| Setting | Value | Source |\n|---------|-------|--------|\n`;
    report += `| Indentation | ${conventions.formatting.indentation.type}${conventions.formatting.indentation.size ? ` (${conventions.formatting.indentation.size})` : ''} | ${conventions.formatting.indentation.source} |\n`;
    report += `| Line Ending | ${conventions.formatting.lineEnding.type} | - |\n`;
    if (conventions.formatting.maxLineLength) {
      report += `| Max Line Length | ${conventions.formatting.maxLineLength} | - |\n`;
    }
    report += '\n';

    report += `## Naming Conventions\n\n`;
    report += `| Element | Pattern | Examples |\n|---------|---------|----------|\n`;
    report += `| Classes | ${conventions.naming.classes.pattern} | ${conventions.naming.classes.examples.slice(0, 3).join(', ')} |\n`;
    report += `| Methods | ${conventions.naming.methods.pattern} | ${conventions.naming.methods.examples.slice(0, 3).join(', ')} |\n`;
    report += `| Constants | ${conventions.naming.constants.pattern} | ${conventions.naming.constants.examples.slice(0, 3).join(', ')} |\n`;
    report += `| Files | ${conventions.naming.files.pattern} | - |\n`;
    if (conventions.naming.packages) {
      report += `| Packages | ${conventions.naming.packages.pattern} | - |\n`;
    }
    report += '\n';

    report += `## Logging\n\n`;
    report += `- **Framework**: ${conventions.logging.framework.name} (${conventions.logging.framework.confidence}% confidence)\n`;
    report += `- **Levels Used**: ${conventions.logging.levelsUsed.join(', ') || 'unknown'}\n`;
    report += `- **Message Pattern**: ${conventions.logging.messagePatterns.pattern}\n`;
    if (conventions.logging.loggerDeclaration.examples.length > 0) {
      report += `- **Declaration Example**: \`${conventions.logging.loggerDeclaration.examples[0]}\`\n`;
    }
    report += '\n';

    report += `## Error Handling\n\n`;
    report += `- **Primary Pattern**: ${conventions.errorHandling.pattern}\n`;
    report += `- **Logs on Error**: ${conventions.errorHandling.logsOnError ? 'Yes' : 'No'}\n`;
    report += `- **Exception Strategy**: ${conventions.errorHandling.rethrowsOrWraps}\n`;
    if (conventions.errorHandling.customExceptions.examples.length > 0) {
      report += `- **Custom Exceptions**: ${conventions.errorHandling.customExceptions.examples.join(', ')}\n`;
    }
    report += '\n';

    report += `## Code Structure\n\n`;
    report += `- **Avg Method Length**: ${conventions.codeStructure.methodStructure.averageLines} lines\n`;
    report += `- **Import Grouping**: ${conventions.codeStructure.importOrganization.grouping ? 'Yes' : 'No'}\n`;
    report += `- **Documentation**: ${conventions.codeStructure.documentationStyle.hasJavadoc ? 'Javadoc present' : 'Minimal'}\n`;
    report += '\n';

    if (conventions.linterRules.tool) {
      report += `## Linter\n\n`;
      report += `- **Tool**: ${conventions.linterRules.tool}\n`;
      report += `- **Config**: ${conventions.linterRules.configFile}\n`;
      if (conventions.linterRules.keyRules.length > 0) {
        report += `- **Key Rules**: ${conventions.linterRules.keyRules.slice(0, 5).join(', ')}\n`;
      }
      report += '\n';
    }

    if (conventions.similarImplementations.length > 0) {
      report += `## Similar Implementations\n\n`;
      for (const impl of conventions.similarImplementations) {
        report += `### ${impl.methodName} (${path.basename(impl.file)})\n\n`;
        report += `\`\`\`\n${impl.code}\n\`\`\`\n\n`;
      }
    }

    return report;
  }
}

export default ProjectConventionsAnalyzer;
