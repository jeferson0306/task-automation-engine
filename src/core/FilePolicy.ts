import path from 'path';
import { logger } from '../utils/logger.js';

/**
 * File modification policy
 * Defines what can and cannot be modified in a project
 */
export interface FileModificationPolicy {
  canModify: boolean;
  reason: string;
  category: FileCategory;
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  requiresReview: boolean;
}

export type FileCategory = 
  | 'source_code'        // Main application code - CAN modify
  | 'test_code'          // Test files - CAN modify/create
  | 'config_dev'         // Dev configs - CAN modify with care
  | 'config_prod'        // Prod configs - SHOULD NOT modify
  | 'migration'          // DB migrations - NEVER modify existing
  | 'lock_file'          // Lock files - NEVER modify directly
  | 'generated'          // Generated code - NEVER modify
  | 'build_artifact'     // Build outputs - NEVER modify
  | 'documentation'      // Docs - CAN modify
  | 'ci_cd'              // CI/CD configs - SHOULD NOT modify
  | 'infrastructure'     // Infra configs - SHOULD NOT modify
  | 'dependency_def'     // package.json, pom.xml - CAN modify with care
  | 'git_internal'       // .git folder - NEVER touch
  | 'ide_config'         // IDE settings - SHOULD NOT modify
  | 'unknown';

/**
 * File Policy Manager
 * Determines what files can be safely modified
 */
export class FilePolicy {
  
  // Patterns for files that should NEVER be modified
  private static readonly NEVER_MODIFY_PATTERNS: RegExp[] = [
    // Database migrations (Flyway, Liquibase, etc)
    /db\/migration\//i,
    /migrations?\//i,
    /flyway\//i,
    /liquibase\//i,
    /\.sql$/i,  // Be extra careful with SQL files
    
    // Lock files
    /package-lock\.json$/i,
    /yarn\.lock$/i,
    /pnpm-lock\.yaml$/i,
    /Gemfile\.lock$/i,
    /poetry\.lock$/i,
    /Cargo\.lock$/i,
    /composer\.lock$/i,
    
    // Generated code
    /\.generated\./i,
    /generated\//i,
    /\.g\.dart$/i,
    /\.freezed\.dart$/i,
    /__generated__\//i,
    /node_modules\//i,
    /\.class$/i,
    /\.jar$/i,
    /\.war$/i,
    
    // Build artifacts
    /\/build\//i,
    /\/dist\//i,
    /\/target\//i,
    /\/out\//i,
    /\.min\.js$/i,
    /\.min\.css$/i,
    /\.bundle\./i,
    
    // Git internals
    /\.git\//i,
    /\.gitmodules$/i,
    
    // Binary files
    /\.(png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|pdf|zip|tar|gz)$/i,
  ];

  // Patterns for files that SHOULD NOT be modified (high risk)
  private static readonly HIGH_RISK_PATTERNS: RegExp[] = [
    // Production configs
    /application-prod\./i,
    /\.prod\./i,
    /production\./i,
    /\.env\.prod/i,
    /\.env\.production/i,
    
    // CI/CD
    /\.github\/workflows\//i,
    /\.gitlab-ci/i,
    /Jenkinsfile/i,
    /\.circleci\//i,
    /azure-pipelines/i,
    /bitbucket-pipelines/i,
    
    // Infrastructure
    /terraform\//i,
    /\.tf$/i,
    /cloudformation\//i,
    /kubernetes\//i,
    /k8s\//i,
    /helm\//i,
    /docker-compose\.prod/i,
    
    // Security
    /\.env$/i,  // Environment files with secrets
    /credentials/i,
    /secrets?\//i,
    /\.pem$/i,
    /\.key$/i,
  ];

  // Patterns for files that need careful review
  private static readonly MEDIUM_RISK_PATTERNS: RegExp[] = [
    // Dependency definitions
    /package\.json$/i,
    /pom\.xml$/i,
    /build\.gradle/i,
    /requirements\.txt$/i,
    /Gemfile$/i,
    /Cargo\.toml$/i,
    /go\.mod$/i,
    
    // Dev configs
    /application\.properties$/i,
    /application\.ya?ml$/i,
    /\.env\.dev/i,
    /\.env\.local/i,
    /tsconfig\.json$/i,
    /webpack\.config/i,
    
    // Docker (non-prod)
    /Dockerfile$/i,
    /docker-compose\.ya?ml$/i,
    
    // IDE configs
    /\.vscode\//i,
    /\.idea\//i,
    /\.editorconfig$/i,
  ];

  // Patterns for test files (safe to modify/create)
  private static readonly TEST_PATTERNS: RegExp[] = [
    /test\//i,
    /tests?\//i,
    /spec\//i,
    /__tests__\//i,
    /\.test\./i,
    /\.spec\./i,
    /Test\.java$/i,
    /Tests\.java$/i,
    /_test\.go$/i,
    /_test\.py$/i,
    /test_.*\.py$/i,
  ];

  // Patterns for documentation (safe to modify)
  private static readonly DOC_PATTERNS: RegExp[] = [
    /README/i,
    /CHANGELOG/i,
    /CONTRIBUTING/i,
    /LICENSE/i,
    /docs?\//i,
    /documentation\//i,
    /\.md$/i,
    /\.rst$/i,
    /\.adoc$/i,
  ];

  /**
   * Evaluate if a file can be modified
   */
  static evaluate(filePath: string): FileModificationPolicy {
    const normalizedPath = filePath.replace(/\\/g, '/');
    
    // Check NEVER modify patterns first
    for (const pattern of this.NEVER_MODIFY_PATTERNS) {
      if (pattern.test(normalizedPath)) {
        return {
          canModify: false,
          reason: this.getReasonForPattern(pattern, normalizedPath),
          category: this.getCategoryForPattern(pattern),
          riskLevel: 'critical',
          requiresReview: false,
        };
      }
    }
    
    // Check HIGH risk patterns
    for (const pattern of this.HIGH_RISK_PATTERNS) {
      if (pattern.test(normalizedPath)) {
        return {
          canModify: false,
          reason: `High-risk file: ${this.getReasonForPattern(pattern, normalizedPath)}`,
          category: this.getCategoryForPattern(pattern),
          riskLevel: 'high',
          requiresReview: true,
        };
      }
    }
    
    // Check if it's a test file (safe)
    for (const pattern of this.TEST_PATTERNS) {
      if (pattern.test(normalizedPath)) {
        return {
          canModify: true,
          reason: 'Test file - safe to modify or create',
          category: 'test_code',
          riskLevel: 'low',
          requiresReview: false,
        };
      }
    }
    
    // Check if it's documentation (safe)
    for (const pattern of this.DOC_PATTERNS) {
      if (pattern.test(normalizedPath)) {
        return {
          canModify: true,
          reason: 'Documentation file - safe to modify',
          category: 'documentation',
          riskLevel: 'low',
          requiresReview: false,
        };
      }
    }
    
    // Check MEDIUM risk patterns
    for (const pattern of this.MEDIUM_RISK_PATTERNS) {
      if (pattern.test(normalizedPath)) {
        return {
          canModify: true,
          reason: `Configuration file - modify with care: ${this.getReasonForPattern(pattern, normalizedPath)}`,
          category: this.getCategoryForPattern(pattern),
          riskLevel: 'medium',
          requiresReview: true,
        };
      }
    }
    
    // Check if it's source code (by extension)
    if (this.isSourceCodeFile(normalizedPath)) {
      return {
        canModify: true,
        reason: 'Source code file - can be modified',
        category: 'source_code',
        riskLevel: 'low',
        requiresReview: false,
      };
    }
    
    // Unknown file type - be cautious
    return {
      canModify: false,
      reason: 'Unknown file type - requires manual review',
      category: 'unknown',
      riskLevel: 'medium',
      requiresReview: true,
    };
  }

  /**
   * Filter a list of files to only those that can be modified
   */
  static filterModifiable(files: string[]): { 
    modifiable: string[]; 
    excluded: Array<{ file: string; reason: string }>;
  } {
    const modifiable: string[] = [];
    const excluded: Array<{ file: string; reason: string }> = [];
    
    for (const file of files) {
      const policy = this.evaluate(file);
      if (policy.canModify) {
        modifiable.push(file);
      } else {
        excluded.push({ file, reason: policy.reason });
      }
    }
    
    return { modifiable, excluded };
  }

  /**
   * Check if file is source code
   */
  private static isSourceCodeFile(filePath: string): boolean {
    const sourceExtensions = [
      '.java', '.kt', '.scala', '.groovy',  // JVM
      '.ts', '.tsx', '.js', '.jsx', '.mjs', // JavaScript/TypeScript
      '.py', '.pyw',                         // Python
      '.go',                                 // Go
      '.rs',                                 // Rust
      '.c', '.cpp', '.h', '.hpp', '.cc',    // C/C++
      '.cs',                                 // C#
      '.rb',                                 // Ruby
      '.php',                                // PHP
      '.swift',                              // Swift
      '.m', '.mm',                           // Objective-C
      '.dart',                               // Dart
      '.ex', '.exs',                         // Elixir
      '.clj', '.cljs',                       // Clojure
      '.hs',                                 // Haskell
      '.vue', '.svelte',                     // Frontend frameworks
    ];
    
    const ext = path.extname(filePath).toLowerCase();
    return sourceExtensions.includes(ext);
  }

  /**
   * Get human-readable reason for pattern match
   */
  private static getReasonForPattern(pattern: RegExp, filePath: string): string {
    const patternStr = pattern.source.toLowerCase();
    
    if (patternStr.includes('migration') || patternStr.includes('flyway') || patternStr.includes('liquibase')) {
      return 'Database migrations are immutable - create new migration instead';
    }
    if (patternStr.includes('lock')) {
      return 'Lock files are auto-generated - modify dependency definition instead';
    }
    if (patternStr.includes('generated') || patternStr.includes('node_modules')) {
      return 'Generated/vendor code - modify source instead';
    }
    if (patternStr.includes('build') || patternStr.includes('dist') || patternStr.includes('target')) {
      return 'Build artifact - modify source code instead';
    }
    if (patternStr.includes('prod')) {
      return 'Production configuration - requires manual approval';
    }
    if (patternStr.includes('workflow') || patternStr.includes('ci') || patternStr.includes('jenkins')) {
      return 'CI/CD configuration - requires DevOps review';
    }
    if (patternStr.includes('terraform') || patternStr.includes('k8s') || patternStr.includes('kubernetes')) {
      return 'Infrastructure code - requires infrastructure team review';
    }
    if (patternStr.includes('env') || patternStr.includes('secret') || patternStr.includes('credential')) {
      return 'Contains sensitive data - requires security review';
    }
    if (patternStr.includes('.git')) {
      return 'Git internals - never modify directly';
    }
    
    return 'File matches restricted pattern';
  }

  /**
   * Get category for pattern
   */
  private static getCategoryForPattern(pattern: RegExp): FileCategory {
    const patternStr = pattern.source.toLowerCase();
    
    if (patternStr.includes('migration') || patternStr.includes('flyway') || patternStr.includes('liquibase') || patternStr.includes('.sql')) {
      return 'migration';
    }
    if (patternStr.includes('lock')) {
      return 'lock_file';
    }
    if (patternStr.includes('generated') || patternStr.includes('node_modules')) {
      return 'generated';
    }
    if (patternStr.includes('build') || patternStr.includes('dist') || patternStr.includes('target')) {
      return 'build_artifact';
    }
    if (patternStr.includes('prod')) {
      return 'config_prod';
    }
    if (patternStr.includes('workflow') || patternStr.includes('ci') || patternStr.includes('jenkins')) {
      return 'ci_cd';
    }
    if (patternStr.includes('terraform') || patternStr.includes('k8s') || patternStr.includes('kubernetes')) {
      return 'infrastructure';
    }
    if (patternStr.includes('.git')) {
      return 'git_internal';
    }
    if (patternStr.includes('.vscode') || patternStr.includes('.idea')) {
      return 'ide_config';
    }
    
    return 'unknown';
  }

  /**
   * Log policy evaluation for debugging
   */
  static logEvaluation(filePath: string): void {
    const policy = this.evaluate(filePath);
    const status = policy.canModify ? '✓' : '✗';
    const risk = policy.riskLevel.toUpperCase();
    logger.info(`[${status}] ${filePath}`);
    logger.info(`    Category: ${policy.category}, Risk: ${risk}`);
    logger.info(`    Reason: ${policy.reason}`);
  }
}

export default FilePolicy;
