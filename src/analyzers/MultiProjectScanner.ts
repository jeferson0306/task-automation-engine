import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/logger.js';

/**
 * Represents a detected project within a workspace
 */
export interface DetectedProject {
  name: string;
  path: string;
  type: 'backend' | 'frontend' | 'api' | 'library' | 'infrastructure' | 'unknown';
  language: 'java' | 'kotlin' | 'typescript' | 'javascript' | 'python' | 'go' | 'unknown';
  framework?: string;
  buildTool?: string;
  hasTests: boolean;
  entryPoints: string[];  // Main files, controllers, components
  exports: string[];      // What this project exposes to others
}

/**
 * Represents a workspace with multiple projects
 */
export interface Workspace {
  rootPath: string;
  projects: DetectedProject[];
  relationships: ProjectRelationship[];
}

/**
 * Relationship between projects
 */
export interface ProjectRelationship {
  from: string;      // Project name
  to: string;        // Project name
  type: 'calls' | 'imports' | 'depends' | 'shares-types';
  evidence: string;  // File or import that proves this relationship
}

/**
 * Multi-Project Scanner
 * Scans a workspace directory to detect all projects and their relationships
 */
export class MultiProjectScanner {
  
  /**
   * Scan a workspace directory for all projects
   */
  async scanWorkspace(workspacePath: string): Promise<Workspace> {
    logger.info(`Scanning workspace: ${workspacePath}`);
    
    const projects: DetectedProject[] = [];
    const entries = await fs.readdir(workspacePath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory() && !this.isIgnoredDirectory(entry.name)) {
        const projectPath = path.join(workspacePath, entry.name);
        const project = await this.detectProject(projectPath, entry.name);
        
        if (project) {
          projects.push(project);
          logger.info(`  Found project: ${project.name} (${project.type}/${project.language})`);
        }
      }
    }
    
    // Also check if the workspace itself is a project
    const rootProject = await this.detectProject(workspacePath, path.basename(workspacePath));
    if (rootProject && projects.length === 0) {
      projects.push(rootProject);
    }
    
    // Detect relationships between projects
    const relationships = await this.detectRelationships(projects);
    
    logger.info(`Workspace scan complete: ${projects.length} projects, ${relationships.length} relationships`);
    
    return {
      rootPath: workspacePath,
      projects,
      relationships,
    };
  }
  
  /**
   * Detect a single project from a directory
   */
  private async detectProject(projectPath: string, name: string): Promise<DetectedProject | null> {
    const indicators = await this.readProjectIndicators(projectPath);
    
    if (!indicators.isProject) {
      return null;
    }
    
    const project: DetectedProject = {
      name,
      path: projectPath,
      type: this.inferProjectType(indicators, name),
      language: indicators.language,
      framework: indicators.framework,
      buildTool: indicators.buildTool,
      hasTests: indicators.hasTests,
      entryPoints: await this.findEntryPoints(projectPath, indicators),
      exports: await this.findExports(projectPath, indicators),
    };
    
    return project;
  }
  
  /**
   * Read indicators from a project directory
   */
  private async readProjectIndicators(projectPath: string): Promise<ProjectIndicators> {
    const indicators: ProjectIndicators = {
      isProject: false,
      language: 'unknown',
      hasTests: false,
    };
    
    try {
      const files = await fs.readdir(projectPath);
      
      // Check for build files and infer language/framework
      for (const file of files) {
        const fileLower = file.toLowerCase();
        
        // Java/Kotlin (Maven)
        if (fileLower === 'pom.xml') {
          indicators.isProject = true;
          indicators.buildTool = 'maven';
          indicators.language = await this.detectJvmLanguage(projectPath);
          indicators.framework = await this.detectJvmFramework(projectPath);
        }
        
        // Java/Kotlin (Gradle)
        if (fileLower === 'build.gradle' || fileLower === 'build.gradle.kts') {
          indicators.isProject = true;
          indicators.buildTool = 'gradle';
          indicators.language = fileLower.endsWith('.kts') ? 'kotlin' : await this.detectJvmLanguage(projectPath);
          indicators.framework = await this.detectJvmFramework(projectPath);
        }
        
        // Node.js/TypeScript
        if (fileLower === 'package.json') {
          indicators.isProject = true;
          indicators.buildTool = 'npm';
          const hasTs = files.some(f => f === 'tsconfig.json');
          indicators.language = hasTs ? 'typescript' : 'javascript';
          indicators.framework = await this.detectNodeFramework(projectPath);
        }
        
        // Python
        if (fileLower === 'setup.py' || fileLower === 'pyproject.toml' || fileLower === 'requirements.txt') {
          indicators.isProject = true;
          indicators.buildTool = 'pip';
          indicators.language = 'python';
          indicators.framework = await this.detectPythonFramework(projectPath);
        }
        
        // Go
        if (fileLower === 'go.mod') {
          indicators.isProject = true;
          indicators.buildTool = 'go';
          indicators.language = 'go';
        }
      }
      
      // Check for tests
      indicators.hasTests = await this.hasTestDirectory(projectPath);
      
    } catch (error) {
      // Directory not readable
    }
    
    return indicators;
  }
  
  /**
   * Infer project type based on structure and naming
   */
  private inferProjectType(indicators: ProjectIndicators, name: string): DetectedProject['type'] {
    const nameLower = name.toLowerCase();
    
    // Infer from framework
    if (indicators.framework) {
      const fw = indicators.framework.toLowerCase();
      if (['angular', 'react', 'vue', 'svelte', 'next'].some(f => fw.includes(f))) {
        return 'frontend';
      }
      if (['express', 'fastify', 'nest', 'spring', 'quarkus', 'django', 'flask', 'fastapi'].some(f => fw.includes(f))) {
        return 'backend';
      }
    }
    
    // Infer from name patterns
    if (['ui', 'frontend', 'web', 'app', 'client'].some(p => nameLower.includes(p))) {
      return 'frontend';
    }
    if (['api', 'gateway', 'rest', 'graphql'].some(p => nameLower.includes(p))) {
      return 'api';
    }
    if (['service', 'backend', 'server', 'core'].some(p => nameLower.includes(p))) {
      return 'backend';
    }
    if (['lib', 'common', 'shared', 'utils'].some(p => nameLower.includes(p))) {
      return 'library';
    }
    if (['infra', 'deploy', 'terraform', 'k8s', 'docker'].some(p => nameLower.includes(p))) {
      return 'infrastructure';
    }
    
    // Default based on language
    if (indicators.language === 'typescript' || indicators.language === 'javascript') {
      // Check for typical frontend indicators
      return 'unknown';  // Could be either
    }
    
    return 'backend';  // Default for Java, Python, Go
  }
  
  /**
   * Detect JVM language (Java vs Kotlin)
   */
  private async detectJvmLanguage(projectPath: string): Promise<'java' | 'kotlin'> {
    const srcMain = path.join(projectPath, 'src', 'main');
    try {
      const dirs = await fs.readdir(srcMain);
      if (dirs.includes('kotlin')) return 'kotlin';
      return 'java';
    } catch {
      return 'java';
    }
  }
  
  /**
   * Detect JVM framework
   */
  private async detectJvmFramework(projectPath: string): Promise<string | undefined> {
    const pomPath = path.join(projectPath, 'pom.xml');
    const gradlePath = path.join(projectPath, 'build.gradle');
    
    try {
      let content = '';
      try {
        content = await fs.readFile(pomPath, 'utf-8');
      } catch {
        content = await fs.readFile(gradlePath, 'utf-8');
      }
      
      if (content.includes('quarkus')) return 'quarkus';
      if (content.includes('spring-boot')) return 'spring-boot';
      if (content.includes('spring')) return 'spring';
      if (content.includes('micronaut')) return 'micronaut';
      if (content.includes('jakarta')) return 'jakarta-ee';
    } catch {
      // File not readable
    }
    
    return undefined;
  }
  
  /**
   * Detect Node.js framework
   */
  private async detectNodeFramework(projectPath: string): Promise<string | undefined> {
    const packagePath = path.join(projectPath, 'package.json');
    
    try {
      const content = await fs.readFile(packagePath, 'utf-8');
      const pkg = JSON.parse(content);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      
      if (deps['@angular/core']) return 'angular';
      if (deps['react']) return 'react';
      if (deps['vue']) return 'vue';
      if (deps['svelte']) return 'svelte';
      if (deps['next']) return 'next.js';
      if (deps['express']) return 'express';
      if (deps['fastify']) return 'fastify';
      if (deps['@nestjs/core']) return 'nestjs';
    } catch {
      // File not readable
    }
    
    return undefined;
  }
  
  /**
   * Detect Python framework
   */
  private async detectPythonFramework(projectPath: string): Promise<string | undefined> {
    const requirementsPath = path.join(projectPath, 'requirements.txt');
    
    try {
      const content = await fs.readFile(requirementsPath, 'utf-8');
      
      if (content.includes('django')) return 'django';
      if (content.includes('flask')) return 'flask';
      if (content.includes('fastapi')) return 'fastapi';
    } catch {
      // File not readable
    }
    
    return undefined;
  }
  
  /**
   * Check if project has test directory
   */
  private async hasTestDirectory(projectPath: string): Promise<boolean> {
    const testDirs = [
      'test', 'tests', '__tests__',
      'src/test', 'src/tests',
      'src/test/java', 'src/test/kotlin',
    ];
    
    for (const dir of testDirs) {
      try {
        await fs.access(path.join(projectPath, dir));
        return true;
      } catch {
        // Directory doesn't exist
      }
    }
    
    return false;
  }
  
  /**
   * Find entry points (controllers, main files, components)
   */
  private async findEntryPoints(projectPath: string, indicators: ProjectIndicators): Promise<string[]> {
    const entryPoints: string[] = [];
    
    // Common entry point patterns
    const patterns = [
      { dir: 'src/main/java', patterns: ['**/controller/**', '**/resource/**', '**/web/**'] },
      { dir: 'src/main/kotlin', patterns: ['**/controller/**', '**/resource/**', '**/web/**'] },
      { dir: 'src', patterns: ['**/controller*', '**/api/**', '**/*.controller.*', '**/*.component.*'] },
      { dir: 'app', patterns: ['**/*.controller.*', '**/routes/**'] },
    ];
    
    for (const { dir } of patterns) {
      const fullDir = path.join(projectPath, dir);
      try {
        await fs.access(fullDir);
        entryPoints.push(dir);
      } catch {
        // Directory doesn't exist
      }
    }
    
    return entryPoints;
  }
  
  /**
   * Find what this project exports to others
   */
  private async findExports(projectPath: string, indicators: ProjectIndicators): Promise<string[]> {
    const exports: string[] = [];
    
    // Check for shared types, DTOs, contracts
    const sharedDirs = [
      'src/main/java/**/dto/**',
      'src/main/java/**/model/**',
      'src/main/java/**/contract/**',
      'src/shared/**',
      'src/types/**',
      'lib/**',
    ];
    
    for (const pattern of sharedDirs) {
      const dir = pattern.split('/').slice(0, -1).join('/');
      const fullDir = path.join(projectPath, dir);
      try {
        await fs.access(fullDir);
        exports.push(dir);
      } catch {
        // Directory doesn't exist
      }
    }
    
    return exports;
  }
  
  /**
   * Detect relationships between projects
   */
  private async detectRelationships(projects: DetectedProject[]): Promise<ProjectRelationship[]> {
    const relationships: ProjectRelationship[] = [];
    
    // Build a map of project names for quick lookup
    const projectNames = new Set(projects.map(p => p.name.toLowerCase()));
    
    for (const project of projects) {
      // Check for references to other projects in this project
      const refs = await this.findProjectReferences(project, projectNames);
      relationships.push(...refs);
    }
    
    return relationships;
  }
  
  /**
   * Find references from one project to others
   */
  private async findProjectReferences(
    project: DetectedProject, 
    projectNames: Set<string>
  ): Promise<ProjectRelationship[]> {
    const relationships: ProjectRelationship[] = [];
    
    // Check build files for dependencies
    if (project.buildTool === 'maven') {
      const pomPath = path.join(project.path, 'pom.xml');
      try {
        const content = await fs.readFile(pomPath, 'utf-8');
        for (const name of projectNames) {
          if (name !== project.name.toLowerCase() && content.toLowerCase().includes(name)) {
            relationships.push({
              from: project.name,
              to: name,
              type: 'depends',
              evidence: 'pom.xml',
            });
          }
        }
      } catch {
        // File not readable
      }
    }
    
    if (project.buildTool === 'npm') {
      const packagePath = path.join(project.path, 'package.json');
      try {
        const content = await fs.readFile(packagePath, 'utf-8');
        for (const name of projectNames) {
          if (name !== project.name.toLowerCase() && content.toLowerCase().includes(name)) {
            relationships.push({
              from: project.name,
              to: name,
              type: 'depends',
              evidence: 'package.json',
            });
          }
        }
      } catch {
        // File not readable
      }
    }
    
    return relationships;
  }
  
  /**
   * Check if directory should be ignored
   */
  private isIgnoredDirectory(name: string): boolean {
    const ignored = [
      'node_modules', '.git', '.idea', '.vscode', 
      'target', 'build', 'dist', 'out',
      '__pycache__', '.pytest_cache', 'venv',
      '.gradle', '.mvn',
    ];
    return ignored.includes(name) || name.startsWith('.');
  }
}

/**
 * Internal type for project detection
 */
interface ProjectIndicators {
  isProject: boolean;
  language: DetectedProject['language'];
  framework?: string;
  buildTool?: string;
  hasTests: boolean;
}

export default new MultiProjectScanner();
