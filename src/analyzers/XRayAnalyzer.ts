import { logger } from '../utils/logger.js';
import {
  ExecutionContext,
  ProjectSnapshot,
  XRayReport,
  SpecialistXRay,
  XRayFinding,
  XRaySynthesis,
  ConflictResolution,
  RoadmapItem,
  RiskItem,
} from '../core/types.js';
import ProjectScanner from './ProjectScanner.js';

/**
 * X-Ray specialists for different analysis domains
 */
interface Specialist {
  id: string;
  name: string;
  focus: string;
  triggers: RegExp[];
  analyze: (snapshot: ProjectSnapshot, taskContext?: string) => Promise<XRayFinding[]>;
}

/**
 * X-Ray Mode Analyzer - Based on jay-crew patterns
 * Each specialist performs structured analysis in their domain
 */
export class XRayAnalyzer {
  private specialists: Specialist[] = [];

  constructor() {
    this.initializeSpecialists();
  }

  /**
   * Run full X-Ray analysis on project
   */
  async analyze(context: ExecutionContext, taskContext?: string): Promise<XRayReport> {
    logger.info('Starting X-Ray analysis...');

    const snapshot = context.projectSnapshot || (await ProjectScanner.scan(context.workingDir));
    context.projectSnapshot = snapshot;

    const selectedSpecialists = this.selectSpecialists(snapshot, taskContext);
    logger.info(`Selected specialists: ${selectedSpecialists.map((s) => s.name).join(', ')}`);

    const specialistReports: SpecialistXRay[] = [];

    for (const specialist of selectedSpecialists) {
      logger.info(`Running ${specialist.name} X-Ray...`);
      const findings = await specialist.analyze(snapshot, taskContext);

      const riskLevel = this.calculateRiskLevel(findings);

      specialistReports.push({
        specialistId: specialist.id,
        specialistName: specialist.name,
        focus: specialist.focus,
        findings,
        recommendations: this.generateRecommendations(findings),
        riskLevel,
      });
    }

    const synthesis = this.synthesize(specialistReports, snapshot);

    const report: XRayReport = {
      timestamp: new Date().toISOString(),
      projectPath: context.workingDir,
      taskContext,
      stackSummary: snapshot.detectedStack,
      specialists: specialistReports,
      synthesis,
    };

    context.xrayReport = report;
    logger.info(`X-Ray analysis complete: ${specialistReports.length} specialist reports`);

    return report;
  }

  /**
   * Select relevant specialists based on project and task
   */
  private selectSpecialists(snapshot: ProjectSnapshot, taskContext?: string): Specialist[] {
    const selected: Set<string> = new Set();
    const task = taskContext?.toLowerCase() || '';

    for (const specialist of this.specialists) {
      for (const trigger of specialist.triggers) {
        if (trigger.test(task)) {
          selected.add(specialist.id);
          break;
        }
      }
    }

    for (const lang of snapshot.detectedStack.languages) {
      if (lang.name.includes('Java') || lang.name.includes('Kotlin')) {
        selected.add('backend-dev');
      }
      if (lang.name.includes('TypeScript') || lang.name.includes('JavaScript')) {
        if (snapshot.detectedStack.frameworks.some((f) => ['React', 'Vue', 'Angular'].includes(f.name))) {
          selected.add('frontend-dev');
        } else {
          selected.add('backend-dev');
        }
      }
      if (lang.name.includes('Python')) {
        selected.add('backend-dev');
      }
    }

    if (snapshot.detectedStack.databases.length > 0) {
      selected.add('data-engineer');
    }

    if (snapshot.detectedStack.containerization.length > 0 || snapshot.detectedStack.cicd.length > 0) {
      selected.add('devops');
    }

    selected.add('security');
    selected.add('qa');

    return this.specialists.filter((s) => selected.has(s.id));
  }

  /**
   * Initialize all specialist analyzers
   */
  private initializeSpecialists(): void {
    this.specialists = [
      {
        id: 'backend-dev',
        name: 'Backend Developer',
        focus: 'APIs, Services, Data Access',
        triggers: [/api/i, /backend/i, /service/i, /endpoint/i, /rest/i, /graphql/i],
        analyze: this.analyzeBackend.bind(this),
      },
      {
        id: 'frontend-dev',
        name: 'Frontend Developer',
        focus: 'UI Components, State Management, UX',
        triggers: [/ui/i, /frontend/i, /component/i, /react/i, /vue/i, /angular/i, /css/i, /style/i],
        analyze: this.analyzeFrontend.bind(this),
      },
      {
        id: 'data-engineer',
        name: 'Data Engineer',
        focus: 'Database Design, Queries, Migrations',
        triggers: [/database/i, /db/i, /sql/i, /migration/i, /schema/i, /query/i],
        analyze: this.analyzeData.bind(this),
      },
      {
        id: 'devops',
        name: 'DevOps Engineer',
        focus: 'CI/CD, Containers, Infrastructure',
        triggers: [/deploy/i, /docker/i, /k8s/i, /kubernetes/i, /ci/i, /cd/i, /pipeline/i, /infra/i],
        analyze: this.analyzeDevOps.bind(this),
      },
      {
        id: 'security',
        name: 'Security Engineer',
        focus: 'Vulnerabilities, OWASP, Compliance',
        triggers: [/security/i, /auth/i, /login/i, /jwt/i, /oauth/i, /encrypt/i, /secret/i],
        analyze: this.analyzeSecurity.bind(this),
      },
      {
        id: 'qa',
        name: 'QA Engineer',
        focus: 'Test Coverage, Quality, Reliability',
        triggers: [/test/i, /qa/i, /quality/i, /coverage/i, /bug/i, /fix/i],
        analyze: this.analyzeQA.bind(this),
      },
      {
        id: 'performance',
        name: 'Performance Engineer',
        focus: 'Optimization, Caching, Scalability',
        triggers: [/performance/i, /speed/i, /slow/i, /cache/i, /optimize/i, /scale/i],
        analyze: this.analyzePerformance.bind(this),
      },
      {
        id: 'architect',
        name: 'Software Architect',
        focus: 'Architecture, Patterns, Design Decisions',
        triggers: [/architect/i, /design/i, /pattern/i, /refactor/i, /structure/i, /modular/i],
        analyze: this.analyzeArchitecture.bind(this),
      },
    ];
  }

  private async analyzeBackend(snapshot: ProjectSnapshot): Promise<XRayFinding[]> {
    const findings: XRayFinding[] = [];

    const controllers = snapshot.files.filter((f) => f.classification === 'controller');
    const services = snapshot.files.filter((f) => f.classification === 'service');
    const repositories = snapshot.files.filter((f) => f.classification === 'repository');

    if (controllers.length === 0 && services.length > 0) {
      findings.push({
        category: 'architecture',
        severity: 'warning',
        title: 'Missing Controller Layer',
        description: 'Services found but no controllers. Consider adding API layer.',
        suggestion: 'Create controller classes to expose service functionality via REST endpoints.',
      });
    }

    for (const service of services) {
      if (service.skeletalContent) {
        for (const cls of service.skeletalContent.classes) {
          if (cls.methods.length > 15) {
            findings.push({
              category: 'complexity',
              severity: 'warning',
              title: 'Large Service Class',
              description: `${cls.name} has ${cls.methods.length} methods. Consider splitting.`,
              file: service.relativePath,
              suggestion: 'Split into smaller, focused services following Single Responsibility Principle.',
            });
          }

          const publicMethods = cls.methods.filter((m) => m.visibility === 'public');
          if (publicMethods.length > 10) {
            findings.push({
              category: 'api-surface',
              severity: 'info',
              title: 'Wide API Surface',
              description: `${cls.name} exposes ${publicMethods.length} public methods.`,
              file: service.relativePath,
              suggestion: 'Consider if all methods need to be public. Use interfaces for contracts.',
            });
          }
        }
      }
    }

    if (repositories.length === 0 && snapshot.detectedStack.databases.length > 0) {
      findings.push({
        category: 'architecture',
        severity: 'warning',
        title: 'Missing Repository Pattern',
        description: 'Database detected but no repository classes found.',
        suggestion: 'Implement repository pattern to abstract data access.',
      });
    }

    return findings;
  }

  private async analyzeFrontend(snapshot: ProjectSnapshot): Promise<XRayFinding[]> {
    const findings: XRayFinding[] = [];

    const hasReact = snapshot.detectedStack.frameworks.some((f) => f.name === 'React');
    const hasVue = snapshot.detectedStack.frameworks.some((f) => f.name === 'Vue.js');

    const componentFiles = snapshot.files.filter(
      (f) => f.language.includes('React') || f.relativePath.includes('component')
    );

    if (componentFiles.length > 50 && !snapshot.files.some((f) => f.relativePath.includes('shared'))) {
      findings.push({
        category: 'organization',
        severity: 'info',
        title: 'Consider Shared Components',
        description: `${componentFiles.length} components found. Consider organizing into shared/feature folders.`,
        suggestion: 'Create a shared components directory for reusable UI elements.',
      });
    }

    const hasStateManagement = snapshot.dependencies.some(
      (d) => ['redux', 'zustand', 'mobx', 'recoil', 'pinia', 'vuex'].includes(d.name)
    );

    if (componentFiles.length > 20 && !hasStateManagement) {
      findings.push({
        category: 'state-management',
        severity: 'info',
        title: 'No State Management Library',
        description: 'Large component count without centralized state management.',
        suggestion: 'Consider adding Redux, Zustand, or similar for complex state.',
      });
    }

    return findings;
  }

  private async analyzeData(snapshot: ProjectSnapshot): Promise<XRayFinding[]> {
    const findings: XRayFinding[] = [];

    const migrations = snapshot.files.filter((f) => f.classification === 'migration');
    const schemas = snapshot.files.filter((f) => f.classification === 'schema');

    if (snapshot.detectedStack.databases.length > 0 && migrations.length === 0) {
      findings.push({
        category: 'migrations',
        severity: 'warning',
        title: 'No Database Migrations',
        description: 'Database detected but no migration files found.',
        suggestion: 'Implement database migrations for version-controlled schema changes.',
      });
    }

    if (schemas.length === 0 && snapshot.detectedStack.databases.length > 0) {
      findings.push({
        category: 'schema',
        severity: 'info',
        title: 'No Schema Definition',
        description: 'Consider adding explicit schema definition (Prisma, SQL, etc.).',
        suggestion: 'Define database schema explicitly for documentation and type safety.',
      });
    }

    const entities = snapshot.files.filter((f) => f.classification === 'entity');
    for (const entity of entities) {
      if (entity.skeletalContent) {
        for (const cls of entity.skeletalContent.classes) {
          const hasIdField = cls.fields.some((f) => f.name.toLowerCase() === 'id');
          if (!hasIdField) {
            findings.push({
              category: 'entity-design',
              severity: 'warning',
              title: 'Entity Missing ID',
              description: `${cls.name} may be missing an ID field.`,
              file: entity.relativePath,
              suggestion: 'Ensure all entities have a proper identifier.',
            });
          }
        }
      }
    }

    return findings;
  }

  private async analyzeDevOps(snapshot: ProjectSnapshot): Promise<XRayFinding[]> {
    const findings: XRayFinding[] = [];

    if (snapshot.detectedStack.containerization.length === 0) {
      findings.push({
        category: 'containerization',
        severity: 'info',
        title: 'No Containerization',
        description: 'Project is not containerized.',
        suggestion: 'Add Dockerfile for consistent deployment environments.',
      });
    }

    if (snapshot.detectedStack.cicd.length === 0) {
      findings.push({
        category: 'ci-cd',
        severity: 'warning',
        title: 'No CI/CD Pipeline',
        description: 'No continuous integration/deployment configuration found.',
        suggestion: 'Add GitHub Actions, GitLab CI, or similar for automated builds and deployments.',
      });
    }

    const hasEnvExample = snapshot.configFiles.some((f) => f.path.includes('.env.example'));
    if (!hasEnvExample) {
      findings.push({
        category: 'configuration',
        severity: 'info',
        title: 'Missing .env.example',
        description: 'No environment variable template found.',
        suggestion: 'Create .env.example to document required environment variables.',
      });
    }

    return findings;
  }

  private async analyzeSecurity(snapshot: ProjectSnapshot): Promise<XRayFinding[]> {
    const findings: XRayFinding[] = [];

    for (const config of snapshot.configFiles) {
      const content = config.content.toLowerCase();

      if (content.includes('password') && !content.includes('${') && !content.includes('env.')) {
        findings.push({
          category: 'hardcoded-secrets',
          severity: 'critical',
          title: 'Potential Hardcoded Password',
          description: 'Configuration may contain hardcoded password.',
          file: config.path,
          suggestion: 'Use environment variables or secret management for credentials.',
        });
      }

      if (/[a-z0-9]{32,}/i.test(config.content) && !config.path.includes('lock')) {
        findings.push({
          category: 'hardcoded-secrets',
          severity: 'warning',
          title: 'Potential API Key',
          description: 'Configuration may contain hardcoded API key.',
          file: config.path,
          suggestion: 'Move API keys to environment variables.',
        });
      }
    }

    const hasSecurityDep = snapshot.dependencies.some((d) =>
      ['spring-security', 'helmet', 'cors', 'bcrypt', 'jsonwebtoken'].includes(d.name)
    );

    if (!hasSecurityDep && snapshot.detectedStack.frameworks.some((f) => f.type === 'api')) {
      findings.push({
        category: 'security-framework',
        severity: 'warning',
        title: 'No Security Dependencies',
        description: 'API framework detected without security libraries.',
        suggestion: 'Add authentication/authorization libraries (JWT, OAuth, etc.).',
      });
    }

    return findings;
  }

  private async analyzeQA(snapshot: ProjectSnapshot): Promise<XRayFinding[]> {
    const findings: XRayFinding[] = [];

    const testFiles = snapshot.files.filter((f) => f.classification === 'test');
    const sourceFiles = snapshot.files.filter(
      (f) => f.classification !== 'test' && f.classification !== 'config' && f.language !== 'config'
    );

    const testRatio = testFiles.length / Math.max(sourceFiles.length, 1);

    if (testRatio < 0.3) {
      findings.push({
        category: 'test-coverage',
        severity: 'warning',
        title: 'Low Test File Ratio',
        description: `Test ratio: ${(testRatio * 100).toFixed(1)}% (${testFiles.length} test files / ${sourceFiles.length} source files)`,
        suggestion: 'Add more unit and integration tests to improve coverage.',
      });
    }

    const testFrameworks = snapshot.detectedStack.frameworks.filter((f) => f.type === 'test');
    if (testFrameworks.length === 0) {
      findings.push({
        category: 'test-framework',
        severity: 'warning',
        title: 'No Test Framework Detected',
        description: 'Could not detect a test framework in dependencies.',
        suggestion: 'Add JUnit, Jest, pytest, or similar testing framework.',
      });
    }

    const services = snapshot.files.filter((f) => f.classification === 'service');
    for (const service of services) {
      const serviceName = service.relativePath.replace(/\.(java|ts|js|py|go)$/, '');
      const hasTest = testFiles.some((t) => t.relativePath.toLowerCase().includes(serviceName.toLowerCase()));

      if (!hasTest) {
        findings.push({
          category: 'missing-tests',
          severity: 'info',
          title: 'Service Without Tests',
          description: `${service.relativePath} has no corresponding test file.`,
          file: service.relativePath,
          suggestion: `Create test file for ${service.relativePath}`,
        });
      }
    }

    return findings;
  }

  private async analyzePerformance(snapshot: ProjectSnapshot): Promise<XRayFinding[]> {
    const findings: XRayFinding[] = [];

    const hasCaching = snapshot.dependencies.some((d) =>
      ['redis', 'memcached', 'node-cache', 'caffeine', 'ehcache'].includes(d.name.toLowerCase())
    );

    if (!hasCaching && snapshot.detectedStack.databases.length > 0) {
      findings.push({
        category: 'caching',
        severity: 'info',
        title: 'No Caching Layer',
        description: 'Database detected without caching library.',
        suggestion: 'Consider adding Redis or similar for caching frequently accessed data.',
      });
    }

    for (const file of snapshot.files) {
      if (file.skeletalContent) {
        for (const cls of file.skeletalContent.classes) {
          for (const method of cls.methods) {
            if (method.name.toLowerCase().includes('getall') && !method.parameters.some((p) => p.name.includes('page'))) {
              findings.push({
                category: 'pagination',
                severity: 'warning',
                title: 'Potential Missing Pagination',
                description: `${cls.name}.${method.name}() may return unbounded results.`,
                file: file.relativePath,
                suggestion: 'Add pagination parameters to prevent loading entire tables.',
              });
            }
          }
        }
      }
    }

    return findings;
  }

  private async analyzeArchitecture(snapshot: ProjectSnapshot): Promise<XRayFinding[]> {
    const findings: XRayFinding[] = [];

    const hasLayers =
      snapshot.files.some((f) => f.classification === 'controller') &&
      snapshot.files.some((f) => f.classification === 'service') &&
      snapshot.files.some((f) => f.classification === 'repository');

    if (!hasLayers && snapshot.files.length > 20) {
      findings.push({
        category: 'layering',
        severity: 'info',
        title: 'Missing Layered Architecture',
        description: 'Project may benefit from clear controller/service/repository layers.',
        suggestion: 'Organize code into presentation, business, and data access layers.',
      });
    }

    if (snapshot.services.length > 1) {
      findings.push({
        category: 'monorepo',
        severity: 'info',
        title: 'Monorepo Structure Detected',
        description: `${snapshot.services.length} services detected in monorepo.`,
        suggestion: 'Ensure clear boundaries and shared code organization.',
      });
    }

    const dtos = snapshot.files.filter((f) => f.classification === 'dto');
    const entities = snapshot.files.filter((f) => f.classification === 'entity');

    if (entities.length > 0 && dtos.length === 0) {
      findings.push({
        category: 'dto-pattern',
        severity: 'info',
        title: 'Missing DTO Layer',
        description: 'Entities found but no DTOs. Consider separating API contracts from domain.',
        suggestion: 'Create DTOs to decouple API responses from internal entities.',
      });
    }

    return findings;
  }

  private calculateRiskLevel(findings: XRayFinding[]): 'low' | 'medium' | 'high' | 'critical' {
    const criticalCount = findings.filter((f) => f.severity === 'critical').length;
    const errorCount = findings.filter((f) => f.severity === 'error').length;
    const warningCount = findings.filter((f) => f.severity === 'warning').length;

    if (criticalCount > 0) return 'critical';
    if (errorCount > 2) return 'high';
    if (errorCount > 0 || warningCount > 5) return 'medium';
    return 'low';
  }

  private generateRecommendations(findings: XRayFinding[]): string[] {
    const recommendations: string[] = [];

    const criticalFindings = findings.filter((f) => f.severity === 'critical' || f.severity === 'error');
    for (const finding of criticalFindings) {
      if (finding.suggestion) {
        recommendations.push(`[${finding.severity.toUpperCase()}] ${finding.suggestion}`);
      }
    }

    return recommendations.slice(0, 5);
  }

  /**
   * Synthesize findings from all specialists into unified report
   */
  private synthesize(reports: SpecialistXRay[], snapshot: ProjectSnapshot): XRaySynthesis {
    const allFindings = reports.flatMap((r) => r.findings);

    const executiveSummary = this.generateExecutiveSummary(reports, snapshot);
    const conflictsResolved = this.resolveConflicts(reports);
    const implementationRoadmap = this.generateRoadmap(allFindings);
    const risks = this.assessRisks(allFindings);
    const immediateActions = this.identifyImmediateActions(allFindings);

    return {
      executiveSummary,
      conflictsResolved,
      implementationRoadmap,
      risks,
      immediateActions,
    };
  }

  private generateExecutiveSummary(reports: SpecialistXRay[], snapshot: ProjectSnapshot): string {
    const totalFindings = reports.reduce((sum, r) => sum + r.findings.length, 0);
    const criticalCount = reports.reduce(
      (sum, r) => sum + r.findings.filter((f) => f.severity === 'critical').length,
      0
    );

    const languages = snapshot.detectedStack.languages.map((l) => l.name).join(', ');
    const frameworks = snapshot.detectedStack.frameworks.map((f) => f.name).join(', ');

    let summary = `Project Analysis: ${languages} project`;
    if (frameworks) summary += ` using ${frameworks}`;
    summary += `. Found ${totalFindings} findings across ${reports.length} specialist reviews.`;

    if (criticalCount > 0) {
      summary += ` **${criticalCount} critical issues require immediate attention.**`;
    }

    return summary;
  }

  private resolveConflicts(reports: SpecialistXRay[]): ConflictResolution[] {
    const resolutions: ConflictResolution[] = [];

    const securityReport = reports.find((r) => r.specialistId === 'security');
    const perfReport = reports.find((r) => r.specialistId === 'performance');

    if (securityReport && perfReport) {
      const securityWantsCaching = securityReport.findings.some((f) => f.category === 'session');
      const perfWantsCaching = perfReport.findings.some((f) => f.category === 'caching');

      if (securityWantsCaching && perfWantsCaching) {
        resolutions.push({
          specialists: ['security', 'performance'],
          conflict: 'Caching strategy for sensitive data',
          resolution: 'Use encrypted cache with short TTL for sensitive data, aggressive caching for public data',
          rationale: 'Balances performance gains with security requirements',
        });
      }
    }

    return resolutions;
  }

  private generateRoadmap(findings: XRayFinding[]): RoadmapItem[] {
    const roadmap: RoadmapItem[] = [];
    let order = 1;

    const critical = findings.filter((f) => f.severity === 'critical');
    for (const finding of critical) {
      roadmap.push({
        order: order++,
        task: finding.suggestion || finding.title,
        owner: 'security',
        dependencies: [],
        effort: 'medium',
      });
    }

    const errors = findings.filter((f) => f.severity === 'error');
    for (const finding of errors) {
      roadmap.push({
        order: order++,
        task: finding.suggestion || finding.title,
        owner: 'backend-dev',
        dependencies: roadmap.length > 0 ? [roadmap[0].task] : [],
        effort: 'small',
      });
    }

    return roadmap.slice(0, 10);
  }

  private assessRisks(findings: XRayFinding[]): RiskItem[] {
    const risks: RiskItem[] = [];

    const securityFindings = findings.filter((f) => f.category.includes('security') || f.category.includes('secret'));
    if (securityFindings.length > 0) {
      risks.push({
        risk: 'Security vulnerabilities may expose sensitive data',
        probability: securityFindings.some((f) => f.severity === 'critical') ? 'high' : 'medium',
        impact: 'critical',
        mitigation: 'Address all security findings before deployment',
      });
    }

    const testFindings = findings.filter((f) => f.category.includes('test'));
    if (testFindings.length > 3) {
      risks.push({
        risk: 'Low test coverage increases regression risk',
        probability: 'medium',
        impact: 'medium',
        mitigation: 'Increase test coverage to at least 70%',
      });
    }

    return risks;
  }

  private identifyImmediateActions(findings: XRayFinding[]): string[] {
    const actions: string[] = [];

    const critical = findings.filter((f) => f.severity === 'critical');
    for (const finding of critical.slice(0, 3)) {
      actions.push(`🚨 ${finding.title}: ${finding.suggestion || finding.description}`);
    }

    const errors = findings.filter((f) => f.severity === 'error');
    for (const finding of errors.slice(0, 2)) {
      actions.push(`⚠️ ${finding.title}: ${finding.suggestion || finding.description}`);
    }

    if (actions.length === 0) {
      actions.push('✅ No critical issues found. Review warnings for improvements.');
    }

    return actions;
  }
}

export default new XRayAnalyzer();
