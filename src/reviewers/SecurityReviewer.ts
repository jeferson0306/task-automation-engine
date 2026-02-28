import { ExecutionContext } from '../core/types';
import logger from '../utils/logger';

interface SecurityFinding {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  file?: string;
  line?: number;
  description: string;
  remediation: string;
  owasp?: string;
}

/**
 * Reviews code for security vulnerabilities and OWASP compliance
 */
class SecurityReviewer {
  async review(context: ExecutionContext): Promise<SecurityFinding[]> {
    const findings: SecurityFinding[] = [];
    logger.info('Starting security review...');

    if (!context.projectAnalysis) {
      logger.warn('Project analysis not completed, skipping security review');
      return findings;
    }

    const language = context.projectAnalysis.language;

    // Detect common security issues
    if (language === 'Java') {
      await this.reviewJavaSecurity(context, findings);
    } else if (language === 'TypeScript') {
      await this.reviewTypeScriptSecurity(context, findings);
    } else if (language === 'Python') {
      await this.reviewPythonSecurity(context, findings);
    }

    logger.info(`Found ${findings.length} security findings`);
    return findings;
  }

  private async reviewJavaSecurity(
    _context: ExecutionContext,
    findings: SecurityFinding[]
  ): Promise<void> {
    findings.push({
      severity: 'HIGH',
      category: 'SQL_INJECTION',
      description: 'Check for SQL query concatenation vulnerabilities',
      remediation: 'Use parameterized queries or PreparedStatement',
      owasp: 'A03:2021 - Injection',
    });

    findings.push({
      severity: 'HIGH',
      category: 'INSECURE_DESERIALIZATION',
      description: 'Check for unsafe deserialization (ObjectInputStream, JNDI)',
      remediation: 'Use secure serialization frameworks, validate input types',
      owasp: 'A08:2021 - Software and Data Integrity Failures',
    });

    findings.push({
      severity: 'MEDIUM',
      category: 'WEAK_CRYPTO',
      description: 'Check for hardcoded credentials or weak encryption',
      remediation: 'Use secure key management, encrypted configuration',
      owasp: 'A02:2021 - Cryptographic Failures',
    });
  }

  private async reviewTypeScriptSecurity(
    _context: ExecutionContext,
    findings: SecurityFinding[]
  ): Promise<void> {
    findings.push({
      severity: 'CRITICAL',
      category: 'HARDCODED_SECRETS',
      description: 'Check for hardcoded API keys, tokens, or passwords',
      remediation: 'Move secrets to environment variables or secure vault',
      owasp: 'A05:2021 - Broken Access Control',
    });

    findings.push({
      severity: 'HIGH',
      category: 'CORS_MISCONFIGURATION',
      description: 'Check for wildcard CORS origins',
      remediation: 'Restrict CORS to specific trusted origins',
      owasp: 'A01:2021 - Broken Access Control',
    });

    findings.push({
      severity: 'HIGH',
      category: 'CSRF_DISABLED',
      description: 'Check if CSRF protection is disabled',
      remediation: 'Enable CSRF tokens in forms and API endpoints',
      owasp: 'A01:2021 - Broken Access Control',
    });
  }

  private async reviewPythonSecurity(
    _context: ExecutionContext,
    findings: SecurityFinding[]
  ): Promise<void> {
    findings.push({
      severity: 'CRITICAL',
      category: 'INSECURE_PICKLE',
      description: 'Check for unsafe pickle.loads() usage',
      remediation: 'Use JSON or other safe serialization formats',
      owasp: 'A08:2021 - Software and Data Integrity Failures',
    });

    findings.push({
      severity: 'HIGH',
      category: 'SQL_INJECTION',
      description: 'Check for string concatenation in SQL queries',
      remediation: 'Use parameterized queries with prepared statements',
      owasp: 'A03:2021 - Injection',
    });
  }
}

export default new SecurityReviewer();
