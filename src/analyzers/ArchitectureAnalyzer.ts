import path from 'path';
import { execSync } from 'child_process';
import { logger } from '../utils/logger.js';
import { readFile, fileExists } from '../utils/file-utils.js';
import { ProjectAnalysis, Dependency, ExecutionContext } from '../core/types.js';

/**
 * Analyzes project architecture using xray
 */
export class ArchitectureAnalyzer {
  /**
   * Run xray analysis on project
   */
  async analyze(context: ExecutionContext): Promise<ProjectAnalysis> {
    logger.info(`Analyzing project architecture: ${context.workingDir}`);

    const projectPath = context.workingDir;

    // Detect language and build tool
    const language = this.detectLanguage(projectPath);
    const buildTool = this.detectBuildTool(projectPath);

    logger.info(`Detected language: ${language}`);
    logger.info(`Detected build tool: ${buildTool}`);

    // For now, return basic analysis
    // In Phase 2, we'll integrate actual xray skill
    const analysis: ProjectAnalysis = {
      language,
      buildTool,
      framework: this.detectFramework(projectPath, language),
      testFramework: this.detectTestFramework(projectPath, language),
      components: [],
      dependencies: [],
      architecture: 'unknown',
    };

    logger.info(`Architecture analysis complete`);
    return analysis;
  }

  /**
   * Detect programming language
   */
  private detectLanguage(projectPath: string): string {
    const hasJava = this.hasFile(projectPath, '**/*.java');
    const hasPom = this.hasFile(projectPath, 'pom.xml');
    const hasGradle = this.hasFile(projectPath, 'build.gradle') || this.hasFile(projectPath, 'build.gradle.kts');

    if (hasJava || hasPom || hasGradle) {
      return 'Java';
    }

    const hasTs = this.hasFile(projectPath, '**/*.ts');
    const hasJs = this.hasFile(projectPath, '**/*.js');
    const hasPackageJson = this.hasFile(projectPath, 'package.json');

    if (hasTs || (hasJs && hasPackageJson)) {
      return 'TypeScript';
    }

    const hasPy = this.hasFile(projectPath, '**/*.py');
    const hasRequirements = this.hasFile(projectPath, 'requirements.txt') || this.hasFile(projectPath, 'setup.py');

    if (hasPy || hasRequirements) {
      return 'Python';
    }

    const hasGoMod = this.hasFile(projectPath, 'go.mod');
    if (hasGoMod) {
      return 'Go';
    }

    return 'Unknown';
  }

  /**
   * Detect build tool
   */
  private detectBuildTool(projectPath: string): string {
    if (this.hasFile(projectPath, 'pom.xml')) return 'Maven';
    if (this.hasFile(projectPath, 'build.gradle') || this.hasFile(projectPath, 'build.gradle.kts'))
      return 'Gradle';
    if (this.hasFile(projectPath, 'package.json')) return 'npm';
    if (this.hasFile(projectPath, 'yarn.lock')) return 'Yarn';
    if (this.hasFile(projectPath, 'go.mod')) return 'Go Modules';
    if (this.hasFile(projectPath, 'requirements.txt')) return 'pip';

    return 'Unknown';
  }

  /**
   * Detect framework
   */
  private detectFramework(projectPath: string, language: string): string {
    if (language === 'Java') {
      if (this.hasFile(projectPath, 'pom.xml')) {
        const pomContent = this.readFileIfExists(path.join(projectPath, 'pom.xml'));
        if (pomContent.includes('spring-boot')) return 'Spring Boot';
        if (pomContent.includes('quarkus')) return 'Quarkus';
      }
    }

    if (language === 'TypeScript' || language === 'JavaScript') {
      if (this.hasFile(projectPath, 'package.json')) {
        const packageContent = this.readFileIfExists(path.join(projectPath, 'package.json'));
        if (packageContent.includes('react')) return 'React';
        if (packageContent.includes('express')) return 'Express';
        if (packageContent.includes('next')) return 'Next.js';
        if (packageContent.includes('vue')) return 'Vue.js';
      }
    }

    return 'Unknown';
  }

  /**
   * Detect test framework
   */
  private detectTestFramework(projectPath: string, language: string): string {
    if (language === 'Java') {
      const pomContent = this.readFileIfExists(path.join(projectPath, 'pom.xml'));
      if (pomContent.includes('junit-jupiter')) return 'JUnit 5';
      if (pomContent.includes('junit:junit')) return 'JUnit 4';
      if (pomContent.includes('testng')) return 'TestNG';
    }

    if (language === 'TypeScript' || language === 'JavaScript') {
      const packageContent = this.readFileIfExists(path.join(projectPath, 'package.json'));
      if (packageContent.includes('jest')) return 'Jest';
      if (packageContent.includes('vitest')) return 'Vitest';
      if (packageContent.includes('mocha')) return 'Mocha';
    }

    if (language === 'Python') {
      const requirementsContent = this.readFileIfExists(path.join(projectPath, 'requirements.txt'));
      if (requirementsContent.includes('pytest')) return 'pytest';
      return 'unittest';
    }

    return 'Unknown';
  }

  /**
   * Check if file exists
   */
  private hasFile(projectPath: string, pattern: string): boolean {
    try {
      const globPattern = pattern.includes('**') ? pattern : `**/${pattern}`;
      execSync(`find "${projectPath}" -path "*/node_modules" -prune -o -path "*/.git" -prune -o -type f -name "${pattern}" | head -1`, {
        stdio: 'pipe',
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read file if it exists
   */
  private readFileIfExists(filePath: string): string {
    try {
      return require('fs').readFileSync(filePath, 'utf-8');
    } catch {
      return '';
    }
  }
}

export default new ArchitectureAnalyzer();
