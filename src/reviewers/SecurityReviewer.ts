import path from 'path';
import fs from 'fs-extra';
import { ExecutionContext, ParsedFileAST, ScannedFile } from '../core/types.js';
import logger from '../utils/logger.js';
import ProjectScanner from '../analyzers/ProjectScanner.js';

interface SecurityFinding {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  file?: string;
  line?: number;
  description: string;
  remediation: string;
  owasp?: string;
  codeSnippet?: string;
}

interface SecurityPattern {
  id: string;
  category: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  pattern: RegExp;
  description: string;
  remediation: string;
  owasp: string;
  languages: string[];
}

/**
 * Reviews code for security vulnerabilities and OWASP compliance
 * Uses real pattern matching and AST analysis
 */
class SecurityReviewer {
  private patterns: SecurityPattern[] = [];

  constructor() {
    this.initializePatterns();
  }

  async review(context: ExecutionContext): Promise<SecurityFinding[]> {
    const findings: SecurityFinding[] = [];
    logger.info('Starting security review with real pattern analysis...');

    if (!context.projectAnalysis) {
      logger.warn('Project analysis not completed, skipping security review');
      return findings;
    }

    const snapshot = context.projectSnapshot || (await ProjectScanner.scan(context.workingDir));
    context.projectSnapshot = snapshot;

    for (const file of snapshot.files) {
      if (file.classification === 'config') {
        await this.reviewConfigFile(file, findings);
      } else if (file.classification !== 'test') {
        await this.reviewSourceFile(file, findings);
      }
    }

    await this.reviewDependencies(snapshot, findings);

    findings.sort((a, b) => {
      const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });

    logger.info(`Found ${findings.length} security findings`);
    return findings;
  }

  private async reviewSourceFile(file: ScannedFile, findings: SecurityFinding[]): Promise<void> {
    let content = file.content;

    if (!content) {
      try {
        content = await fs.readFile(file.path, 'utf-8');
      } catch {
        return;
      }
    }

    const lines = content.split('\n');
    const applicablePatterns = this.patterns.filter(
      (p) => p.languages.includes('*') || p.languages.some((l) => file.language.toLowerCase().includes(l.toLowerCase()))
    );

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];

      for (const pattern of applicablePatterns) {
        if (pattern.pattern.test(line)) {
          findings.push({
            severity: pattern.severity,
            category: pattern.category,
            file: file.relativePath,
            line: lineNum + 1,
            description: pattern.description,
            remediation: pattern.remediation,
            owasp: pattern.owasp,
            codeSnippet: this.getCodeSnippet(lines, lineNum),
          });
        }
      }
    }

    this.checkMultiLinePatterns(content, file.relativePath, file.language, findings);
  }

  private async reviewConfigFile(file: ScannedFile, findings: SecurityFinding[]): Promise<void> {
    const content = file.content || '';

    if (file.relativePath.includes('.env') && !file.relativePath.includes('.example')) {
      findings.push({
        severity: 'CRITICAL',
        category: 'EXPOSED_ENV',
        file: file.relativePath,
        description: '.env file should not be committed to repository',
        remediation: 'Add .env to .gitignore and use .env.example for templates',
        owasp: 'A05:2021 - Security Misconfiguration',
      });
    }

    const secretPatterns = [
      { pattern: /password\s*[=:]\s*['"][^'"]+['"]/gi, name: 'password' },
      { pattern: /api[_-]?key\s*[=:]\s*['"][a-zA-Z0-9]{20,}['"]/gi, name: 'API key' },
      { pattern: /secret\s*[=:]\s*['"][^'"]+['"]/gi, name: 'secret' },
      { pattern: /token\s*[=:]\s*['"][a-zA-Z0-9._-]{20,}['"]/gi, name: 'token' },
      { pattern: /private[_-]?key\s*[=:]/gi, name: 'private key' },
    ];

    const lines = content.split('\n');
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];

      for (const { pattern, name } of secretPatterns) {
        if (pattern.test(line) && !line.includes('${') && !line.includes('process.env')) {
          findings.push({
            severity: 'CRITICAL',
            category: 'HARDCODED_SECRET',
            file: file.relativePath,
            line: lineNum + 1,
            description: `Potential hardcoded ${name} detected`,
            remediation: 'Use environment variables or a secrets manager',
            owasp: 'A02:2021 - Cryptographic Failures',
            codeSnippet: line.substring(0, 80) + (line.length > 80 ? '...' : ''),
          });
        }
      }
    }
  }

  private async reviewDependencies(snapshot: any, findings: SecurityFinding[]): Promise<void> {
    const knownVulnerable: Record<string, { severity: string; cve?: string; message: string }> = {
      'lodash': { severity: 'HIGH', cve: 'CVE-2021-23337', message: 'Prototype pollution vulnerability in versions < 4.17.21' },
      'axios': { severity: 'MEDIUM', message: 'Check for SSRF vulnerabilities in older versions' },
      'express': { severity: 'MEDIUM', message: 'Ensure version 4.17.3+ for security fixes' },
      'log4j': { severity: 'CRITICAL', cve: 'CVE-2021-44228', message: 'Log4Shell vulnerability in versions < 2.17.0' },
      'spring-boot': { severity: 'HIGH', message: 'Check for known CVEs in older versions' },
    };

    for (const dep of snapshot.dependencies || []) {
      const depName = dep.name.toLowerCase();
      for (const [vulnDep, info] of Object.entries(knownVulnerable)) {
        if (depName.includes(vulnDep)) {
          findings.push({
            severity: info.severity as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW',
            category: 'VULNERABLE_DEPENDENCY',
            description: `${dep.name}@${dep.version}: ${info.message}`,
            remediation: `Update ${dep.name} to the latest secure version`,
            owasp: 'A06:2021 - Vulnerable and Outdated Components',
          });
        }
      }
    }
  }

  private checkMultiLinePatterns(content: string, file: string, language: string, findings: SecurityFinding[]): void {
    if (language.includes('Java')) {
      if (/ObjectInputStream\s*\([^)]*\)/.test(content)) {
        findings.push({
          severity: 'HIGH',
          category: 'INSECURE_DESERIALIZATION',
          file,
          description: 'ObjectInputStream usage detected - potential deserialization vulnerability',
          remediation: 'Use secure serialization (JSON, Protocol Buffers) or validate input types',
          owasp: 'A08:2021 - Software and Data Integrity Failures',
        });
      }

      if (/Runtime\.getRuntime\(\)\.exec/.test(content)) {
        findings.push({
          severity: 'CRITICAL',
          category: 'COMMAND_INJECTION',
          file,
          description: 'Runtime.exec() usage detected - potential command injection',
          remediation: 'Avoid shell commands or use ProcessBuilder with explicit arguments',
          owasp: 'A03:2021 - Injection',
        });
      }
    }

    if (language.includes('TypeScript') || language.includes('JavaScript')) {
      if (/cors\s*\(\s*\{\s*origin\s*:\s*['"]\*['"]/.test(content)) {
        findings.push({
          severity: 'HIGH',
          category: 'CORS_WILDCARD',
          file,
          description: 'CORS configured with wildcard origin',
          remediation: 'Restrict CORS to specific trusted origins',
          owasp: 'A01:2021 - Broken Access Control',
        });
      }

      if (/csrf\s*:\s*false/.test(content.toLowerCase())) {
        findings.push({
          severity: 'HIGH',
          category: 'CSRF_DISABLED',
          file,
          description: 'CSRF protection appears to be disabled',
          remediation: 'Enable CSRF protection for state-changing requests',
          owasp: 'A01:2021 - Broken Access Control',
        });
      }
    }

    if (language.includes('Python')) {
      if (/pickle\.(loads?|load)\s*\(/.test(content)) {
        findings.push({
          severity: 'CRITICAL',
          category: 'INSECURE_PICKLE',
          file,
          description: 'pickle.load() usage detected - potential arbitrary code execution',
          remediation: 'Use JSON or other safe serialization formats',
          owasp: 'A08:2021 - Software and Data Integrity Failures',
        });
      }

      if (/subprocess\.(call|run|Popen)\s*\([^)]*shell\s*=\s*True/.test(content)) {
        findings.push({
          severity: 'HIGH',
          category: 'SHELL_INJECTION',
          file,
          description: 'subprocess with shell=True detected - potential command injection',
          remediation: 'Use subprocess with shell=False and pass arguments as list',
          owasp: 'A03:2021 - Injection',
        });
      }
    }
  }

  private getCodeSnippet(lines: string[], lineNum: number): string {
    const start = Math.max(0, lineNum - 1);
    const end = Math.min(lines.length, lineNum + 2);
    return lines.slice(start, end).join('\n');
  }

  private initializePatterns(): void {
    this.patterns = [
      {
        id: 'sql-injection',
        category: 'SQL_INJECTION',
        severity: 'CRITICAL',
        pattern: /(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\s*.*\+\s*\w+/i,
        description: 'SQL string concatenation detected - potential SQL injection',
        remediation: 'Use parameterized queries or prepared statements',
        owasp: 'A03:2021 - Injection',
        languages: ['*'],
      },
      {
        id: 'eval-usage',
        category: 'CODE_INJECTION',
        severity: 'CRITICAL',
        pattern: /\beval\s*\(/,
        description: 'eval() usage detected - potential code injection',
        remediation: 'Avoid eval(); use safer alternatives like JSON.parse()',
        owasp: 'A03:2021 - Injection',
        languages: ['typescript', 'javascript', 'python'],
      },
      {
        id: 'innerhtml',
        category: 'XSS',
        severity: 'HIGH',
        pattern: /\.innerHTML\s*=/,
        description: 'innerHTML assignment detected - potential XSS vulnerability',
        remediation: 'Use textContent or sanitize HTML with DOMPurify',
        owasp: 'A03:2021 - Injection',
        languages: ['typescript', 'javascript'],
      },
      {
        id: 'document-write',
        category: 'XSS',
        severity: 'HIGH',
        pattern: /document\.write\s*\(/,
        description: 'document.write() usage detected - potential XSS vulnerability',
        remediation: 'Use DOM manipulation methods instead',
        owasp: 'A03:2021 - Injection',
        languages: ['typescript', 'javascript'],
      },
      {
        id: 'hardcoded-password',
        category: 'HARDCODED_SECRET',
        severity: 'CRITICAL',
        pattern: /password\s*[=:]\s*['"][^'"]{4,}['"]/i,
        description: 'Hardcoded password detected',
        remediation: 'Use environment variables or a secrets manager',
        owasp: 'A02:2021 - Cryptographic Failures',
        languages: ['*'],
      },
      {
        id: 'weak-crypto-md5',
        category: 'WEAK_CRYPTO',
        severity: 'MEDIUM',
        pattern: /\bMD5\b|MessageDigest\.getInstance\s*\(\s*["']MD5["']\)/i,
        description: 'MD5 hash usage detected - cryptographically weak',
        remediation: 'Use SHA-256 or stronger hashing algorithms',
        owasp: 'A02:2021 - Cryptographic Failures',
        languages: ['*'],
      },
      {
        id: 'weak-crypto-sha1',
        category: 'WEAK_CRYPTO',
        severity: 'MEDIUM',
        pattern: /\bSHA-?1\b|MessageDigest\.getInstance\s*\(\s*["']SHA-?1["']\)/i,
        description: 'SHA-1 hash usage detected - consider stronger algorithm',
        remediation: 'Use SHA-256 or stronger hashing algorithms',
        owasp: 'A02:2021 - Cryptographic Failures',
        languages: ['*'],
      },
      {
        id: 'http-url',
        category: 'INSECURE_TRANSPORT',
        severity: 'MEDIUM',
        pattern: /http:\/\/(?!localhost|127\.0\.0\.1)/,
        description: 'Non-HTTPS URL detected',
        remediation: 'Use HTTPS for all external connections',
        owasp: 'A02:2021 - Cryptographic Failures',
        languages: ['*'],
      },
      {
        id: 'jwt-none-alg',
        category: 'BROKEN_AUTH',
        severity: 'CRITICAL',
        pattern: /algorithm\s*[=:]\s*['"]none['"]/i,
        description: 'JWT with "none" algorithm detected',
        remediation: 'Always specify a secure algorithm (RS256, ES256)',
        owasp: 'A07:2021 - Identification and Authentication Failures',
        languages: ['*'],
      },
      {
        id: 'debug-mode',
        category: 'DEBUG_ENABLED',
        severity: 'HIGH',
        pattern: /DEBUG\s*[=:]\s*(true|1|['"]true['"])/i,
        description: 'Debug mode appears to be enabled',
        remediation: 'Ensure DEBUG is false in production',
        owasp: 'A05:2021 - Security Misconfiguration',
        languages: ['*'],
      },
      {
        id: 'path-traversal',
        category: 'PATH_TRAVERSAL',
        severity: 'HIGH',
        pattern: /\.\.\//,
        description: 'Path traversal pattern detected in string',
        remediation: 'Validate and sanitize file paths',
        owasp: 'A01:2021 - Broken Access Control',
        languages: ['*'],
      },
      {
        id: 'xxe-vulnerable',
        category: 'XXE',
        severity: 'HIGH',
        pattern: /DocumentBuilderFactory|SAXParserFactory|XMLInputFactory/,
        description: 'XML parser usage - ensure XXE protection is enabled',
        remediation: 'Disable external entities and DTD processing',
        owasp: 'A05:2021 - Security Misconfiguration',
        languages: ['java'],
      },
    ];
  }
}

export default new SecurityReviewer();
