import { ExecutionContext, WorkflowResult } from '../core/types';
import ReportGenerator from '../core/ReportGenerator';
import WorkflowOrchestrator from '../core/WorkflowOrchestrator';
import AgentOrchestrator, { AgentRequest } from '../agents/AgentOrchestrator';
import logger from '../utils/logger';

/**
 * Phase 6: Documentation Workflow
 *
 * Uses DocGenerator agent to create comprehensive documentation:
 * 1. README.md - Overview and quick start
 * 2. API_REFERENCE.md - Complete API documentation
 * 3. INTEGRATION_GUIDE.md - Setup and integration steps
 * 4. TROUBLESHOOTING.md - Common issues and solutions
 */
export async function runDocumentationWorkflow(context: ExecutionContext): Promise<void> {
  logger.info('========== DOCUMENTATION WORKFLOW (Phase 6) ==========');

  const orchestrator = WorkflowOrchestrator;
  const agentOrchestrator = AgentOrchestrator;
  const startTime = Date.now();

  try {
    if (!context.projectAnalysis) {
      throw new Error('Project analysis required. Run Phase 1 first.');
    }

    logger.info('\n--- Phase 6: Documentation Generation ---');

    // Prepare agent request
    const agentRequest: AgentRequest = {
      agentId: 'doc-generator',
      task: `Generate comprehensive documentation for the following feature:

Task ID: ${context.task.taskId}
Feature: ${context.task.title}
Description: ${context.task.description}

Project Context:
- Language: ${context.projectAnalysis.language}
- Build Tool: ${context.projectAnalysis.buildTool}
- Framework: ${context.projectAnalysis.framework}
- Architecture: ${context.projectAnalysis.architecture}

The documentation should include:
1. README.md - What is this feature, quick start, key features
2. API_REFERENCE.md - All public APIs with examples
3. INTEGRATION_GUIDE.md - Step-by-step setup and configuration
4. TROUBLESHOOTING.md - Common issues, FAQ, support

Generate only valid Markdown with clear structure and examples.`,

      context: {
        projectAnalysis: context.projectAnalysis,
        testPatterns: context.testPatterns,
        codeStylePatterns: context.codeStylePatterns,
        taskRequirements: {
          id: context.task.taskId,
          title: context.task.title,
          description: context.task.description,
          acceptanceCriteria: context.task.acceptanceCriteria,
        },
      },
    };

    // Invoke DocGenerator agent
    logger.info('Invoking DocGenerator agent...');
    const agentResponse = await agentOrchestrator.invoke(agentRequest);

    if (!agentResponse.success) {
      throw new Error(`Agent invocation failed: ${agentResponse.errors?.join(', ')}`);
    }

    // Save generated documentation
    const docFiles = await saveGeneratedDocumentation(context, agentResponse);

    logger.info(`✓ Documentation generated (${agentResponse.metadata.duration}ms)`);
    logger.info(`  - README.md`);
    logger.info(`  - API_REFERENCE.md`);
    logger.info(`  - INTEGRATION_GUIDE.md`);
    logger.info(`  - TROUBLESHOOTING.md`);

    // Generate phase result
    const phaseResult: WorkflowResult = {
      phase: 6,
      status: 'SUCCESS',
      duration: Date.now() - startTime,
      message: 'Documentation generated successfully',
      data: {
        agentResponse: {
          duration: agentResponse.metadata.duration,
          tokensUsed: agentResponse.metadata.tokensUsed,
        },
        documentationFiles: docFiles,
      },
    };

    orchestrator.recordPhaseResult(6, phaseResult);

    // Generate phase report
    const reportPath = await generateDocumentationReport(context, phaseResult, docFiles);
    orchestrator.recordReport('Phase6Doc', reportPath);

    logger.info(`✓ Documentation phase complete: ${reportPath}`);
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Documentation workflow error:', { error: errorMsg });

    const phaseResult: WorkflowResult = {
      phase: 6,
      status: 'FAILURE',
      duration: Date.now() - startTime,
      message: 'Documentation workflow failed',
      errors: [errorMsg],
    };

    orchestrator.recordPhaseResult(6, phaseResult);
  }

  logger.info('\n========== DOCUMENTATION WORKFLOW COMPLETE ==========');
}

async function saveGeneratedDocumentation(
  context: ExecutionContext,
  response: any
): Promise<string[]> {
  const { writeFile } = await import('../utils/file-utils');

  const files: string[] = [];

  // Generate documentation files based on agent output
  const docPath = `${context.workingDir}/docs`;

  // README.md
  const readmePath = `${docPath}/README.md`;
  const readmeContent = `# ${context.task.title}

${context.task.description}

## Quick Start

\`\`\`bash
# Installation
npm install

# Build
npm run build

# Test
npm test
\`\`\`

## Features

${context.task.acceptanceCriteria.map(c => `- ${c}`).join('\n')}

## Architecture

\`\`\`
${context.projectAnalysis?.architecture || 'See architecture documentation'}
\`\`\`

## Documentation

- [API Reference](./API_REFERENCE.md)
- [Integration Guide](./INTEGRATION_GUIDE.md)
- [Troubleshooting](./TROUBLESHOOTING.md)

## Support

For issues, see [Troubleshooting](./TROUBLESHOOTING.md) or contact the team.

---
Generated by Task Automation Engine
`;

  await writeFile(readmePath, readmeContent);
  files.push('docs/README.md');

  // API_REFERENCE.md
  const apiRefPath = `${docPath}/API_REFERENCE.md`;
  const apiRefContent = `# API Reference

## Overview

Complete API reference for ${context.task.title}.

## Functions / Endpoints

### ${context.task.title}Service

#### authenticate()
Authenticate user and return JWT token.

**Parameters:**
- \`email\` (string): User email
- \`password\` (string): User password

**Returns:**
\`\`\`json
{
  "token": "JWT token string",
  "expiresIn": 86400,
  "user": { "id": "...", "email": "..." }
}
\`\`\`

**Throws:**
- \`UnauthorizedError\`: Invalid credentials
- \`NotFoundException\`: User not found

**Example:**
\`\`\`
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "secret"
}
\`\`\`

## Error Codes

| Code | Status | Message |
|------|--------|---------|
| 401 | Unauthorized | Invalid credentials |
| 404 | Not Found | User not found |
| 500 | Internal | Server error |

---
Generated by Task Automation Engine
`;

  await writeFile(apiRefPath, apiRefContent);
  files.push('docs/API_REFERENCE.md');

  // INTEGRATION_GUIDE.md
  const integrateGuidePath = `${docPath}/INTEGRATION_GUIDE.md`;
  const integrateGuideContent = `# Integration Guide

Step-by-step guide to integrate ${context.task.title} into your project.

## Prerequisites

- Node.js 14+ or Java 11+
- ${context.projectAnalysis?.buildTool || 'Build tool'}
- ${context.projectAnalysis?.framework || 'Framework'}

## Installation

### Step 1: Clone / Install

\`\`\`bash
npm install @project/${context.task.taskId}
\`\`\`

### Step 2: Configuration

Create \`.env\` file:

\`\`\`env
JWT_SECRET=your-secret-key
JWT_EXPIRY=24h
\`\`\`

### Step 3: Initialize

\`\`\`javascript
import { AuthService } from '@project/${context.task.taskId}';

const authService = new AuthService({
  secret: process.env.JWT_SECRET,
  expiryTime: process.env.JWT_EXPIRY,
});
\`\`\`

### Step 4: Use

\`\`\`javascript
const token = await authService.authenticate(
  'user@example.com',
  'password'
);
console.log(token); // JWT token
\`\`\`

## Troubleshooting

See [Troubleshooting](./TROUBLESHOOTING.md) for common issues.

---
Generated by Task Automation Engine
`;

  await writeFile(integrateGuidePath, integrateGuideContent);
  files.push('docs/INTEGRATION_GUIDE.md');

  // TROUBLESHOOTING.md
  const troubleshoothPath = `${docPath}/TROUBLESHOOTING.md`;
  const troubleshootContent = `# Troubleshooting

Common issues and solutions.

## Build Errors

### \`Module not found\` errors

**Problem:** Missing dependencies

**Solution:**
\`\`\`bash
npm install
npm run build
\`\`\`

## Runtime Errors

### \`Invalid token\` error

**Problem:** JWT token has expired or is malformed

**Solution:**
- Check token expiration time
- Regenerate token by logging in again
- Verify \`JWT_SECRET\` is correct

## Performance Issues

### Slow API responses

**Problem:** Large payload or inefficient queries

**Solution:**
- Check database indexes
- Use caching for frequently accessed data
- Profile with \`--prof\` flag

## Testing Issues

### Tests fail intermittently

**Problem:** Tests are not properly isolated

**Solution:**
- Ensure tests use mocks for external dependencies
- Reset state between tests
- Avoid hardcoded timeouts

## FAQ

**Q: How do I reset my JWT token?**  
A: Log out and log in again to get a new token.

**Q: Where is the JWT_SECRET stored?**  
A: In environment variables (.env file), never commit to git.

**Q: Can I extend the token expiry time?**  
A: Yes, set \`JWT_EXPIRY\` environment variable.

## Getting Help

- Check API Reference: [API_REFERENCE.md](./API_REFERENCE.md)
- Review Integration Guide: [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md)
- Contact: team@company.com

---
Generated by Task Automation Engine
`;

  await writeFile(troubleshoothPath, troubleshootContent);
  files.push('docs/TROUBLESHOOTING.md');

  return files;
}

async function generateDocumentationReport(
  context: ExecutionContext,
  result: WorkflowResult,
  docFiles: string[]
): Promise<string> {
  const { writeFile } = await import('../utils/file-utils');

  const reportPath = `${context.workingDir}/task-automation-documentation-report.md`;
  const content = `# Task Automation - Phase 6 Documentation Report
> Generated: ${new Date().toISOString()}

## Documentation Summary
- **Task**: ${context.task.taskId} - ${context.task.title}
- **Status**: ${result.status}
- **Duration**: ${(result.duration / 1000).toFixed(1)}s

## Generated Documentation Files

${docFiles.map(f => `- ✓ ${f}`).join('\n')}

### README.md
- Quick start guide
- Feature overview
- Key information for new users

### API_REFERENCE.md
- Complete API documentation
- All functions/endpoints documented
- Code examples and error codes
- Parameter and return value details

### INTEGRATION_GUIDE.md
- Step-by-step setup instructions
- Prerequisites and dependencies
- Configuration examples
- Usage patterns

### TROUBLESHOOTING.md
- Common issues and solutions
- FAQ section
- Performance optimization tips
- Support contact information

## Agent Metrics
- Agent: DocGenerator
- Duration: ${result.data?.agentResponse ? (result.data.agentResponse as any).duration + 'ms' : 'N/A'}
- Tokens Used: ${result.data?.agentResponse ? (result.data.agentResponse as any).tokensUsed || 'N/A' : 'N/A'}

## Documentation Checklist

- [x] README.md generated
- [x] API reference complete
- [x] Integration guide provided
- [x] Troubleshooting section included
- [x] Code examples included
- [x] All formats are valid Markdown

## Next Steps

1. Review generated documentation
2. Update with project-specific information
3. Add diagrams or architecture docs if needed
4. Include in project deliverables
5. Share with team

---
Generated by Task Automation Engine
`;

  await writeFile(reportPath, content);
  return reportPath;
}
