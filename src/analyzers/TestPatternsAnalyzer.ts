import path from 'path';
import { logger } from '../utils/logger.js';
import { readFile, fileExists } from '../utils/file-utils.js';
import { TestPatterns, ExecutionContext } from '../core/types.js';

/**
 * Analyzes test patterns and conventions in the project
 */
export class TestPatternsAnalyzer {
  /**
   * Extract test patterns from project
   */
  async analyze(context: ExecutionContext): Promise<TestPatterns> {
    logger.info(`Analyzing test patterns: ${context.workingDir}`);

    if (!context.projectAnalysis) {
      throw new Error('Project analysis must be completed first');
    }

    const language = context.projectAnalysis.language;
    const buildTool = context.projectAnalysis.buildTool;

    const patterns: TestPatterns = {
      framework: this.detectTestFramework(language),
      frameworkVersion: await this.detectTestFrameworkVersion(context.workingDir, language, buildTool),
      mockingLibrary: this.detectMockingLibrary(language),
      assertionLibrary: this.detectAssertionLibrary(language),
      namingConvention: this.detectNamingConvention(context.workingDir, language),
      coverageBaseline: 0,
    };

    logger.info(`Test patterns extracted:`, patterns);
    return patterns;
  }

  /**
   * Detect test framework
   */
  private detectTestFramework(language: string): string {
    const frameworkMap: Record<string, string> = {
      Java: 'JUnit',
      TypeScript: 'Jest',
      JavaScript: 'Jest',
      Python: 'pytest',
      Go: 'testing',
    };
    return frameworkMap[language] || 'Unknown';
  }

  /**
   * Detect test framework version
   */
  private async detectTestFrameworkVersion(
    projectPath: string,
    language: string,
    buildTool: string
  ): Promise<string> {
    if (buildTool === 'Maven') {
      const pomPath = path.join(projectPath, 'pom.xml');
      if (await fileExists(pomPath)) {
        const pomContent = await readFile(pomPath);

        // Extract JUnit version
        const junitMatch = pomContent.match(/<junit-jupiter\.version>([^<]+)<\/junit-jupiter\.version>/);
        if (junitMatch) return `JUnit 5.${junitMatch[1]}`;

        const junitLegacyMatch = pomContent.match(/<version>([^<]+)<\/version>\s*<\/junit>/);
        if (junitLegacyMatch) return `JUnit 4.${junitLegacyMatch[1]}`;
      }
    }

    if (buildTool === 'npm' || buildTool === 'Yarn') {
      const packagePath = path.join(projectPath, 'package.json');
      if (await fileExists(packagePath)) {
        const packageContent = await readFile(packagePath);
        const packageJson = JSON.parse(packageContent);

        const devDeps = packageJson.devDependencies || {};
        const jestVersion = devDeps.jest || devDeps['jest-cli'];
        if (jestVersion) return `Jest ${jestVersion.replace(/^[\^~]/, '')}`;
      }
    }

    return 'Unknown';
  }

  /**
   * Detect mocking library
   */
  private detectMockingLibrary(language: string): string {
    const mockLibraryMap: Record<string, string> = {
      Java: 'Mockito',
      TypeScript: 'jest.mock',
      JavaScript: 'jest.mock',
      Python: 'unittest.mock',
      Go: 'testify/mock',
    };
    return mockLibraryMap[language] || 'Unknown';
  }

  /**
   * Detect assertion library
   */
  private detectAssertionLibrary(language: string): string {
    const assertionMap: Record<string, string> = {
      Java: 'AssertJ',
      TypeScript: 'jest assertions',
      JavaScript: 'jest assertions',
      Python: 'assert',
      Go: 'testify/assert',
    };
    return assertionMap[language] || 'Unknown';
  }

  /**
   * Detect test naming convention
   */
  private detectNamingConvention(projectPath: string, language: string): string {
    // Common patterns based on language
    const conventionMap: Record<string, string[]> = {
      Java: ['*Test.java', '*Tests.java', '*IT.java'],
      TypeScript: ['*.test.ts', '*.spec.ts'],
      JavaScript: ['*.test.js', '*.spec.js'],
      Python: ['test_*.py', '*_test.py'],
      Go: ['*_test.go'],
    };

    const conventions = conventionMap[language] || [];
    return conventions.length > 0 ? conventions[0] : 'Unknown';
  }
}

export default new TestPatternsAnalyzer();
