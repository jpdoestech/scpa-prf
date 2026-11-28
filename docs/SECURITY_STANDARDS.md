Security Standards
1. Purpose

This document defines the security requirements for developing, operating, and maintaining the system.

Security must be considered throughout the software development lifecycle.

The objective is to protect:

User accounts.
Personal information.
Business data.
Application resources.
Database records.
External integrations.
System infrastructure.
2. Secure by Design
Consider security during system design.
Apply security controls before deployment.
Avoid unnecessary exposure of sensitive information.
Use secure defaults.
Minimize the system's attack surface.
Review security implications when adding new functionality.
3. Authentication
Use secure authentication mechanisms.
Never store passwords in plaintext.
Use established password hashing algorithms such as Argon2id or bcrypt.
Enforce appropriate password policies.
Protect authentication endpoints against brute-force attempts.
Implement secure session management.
Use multi-factor authentication when required.
Provide secure account recovery procedures.
4. Authorization and Access Control
Enforce authorization on the server side.
Apply the principle of least privilege.
Verify permissions for protected operations.
Do not rely exclusively on frontend access restrictions.
Prevent users from accessing unauthorized records.
Use role-based or attribute-based access control when appropriate.
Deny access by default when authorization cannot be established.
5. Input Validation
Validate all untrusted input.
Validate data types, lengths, formats, and allowed values.
Use allowlists where appropriate.
Validate file uploads.
Prevent injection vulnerabilities.
Never trust client-side validation alone.
6. Common Application Security Risks

Protect against common vulnerabilities, including:

SQL Injection
Use parameterized queries.
Use safe ORM operations.
Never concatenate untrusted input into SQL statements.
Cross-Site Scripting (XSS)
Escape untrusted output appropriately.
Avoid unsafe HTML rendering.
Apply suitable Content Security Policy controls where appropriate.
Cross-Site Request Forgery (CSRF)
Use appropriate CSRF protection for cookie-authenticated state-changing requests.
Validate request origins where appropriate.
Configure cookies securely.
Broken Access Control
Verify permissions for every protected operation.
Prevent unauthorized record access.
Do not rely on hidden UI elements for security.
Server-Side Request Forgery (SSRF)
Validate external URLs.
Restrict access to internal network resources.
Apply appropriate outbound network controls.
Insecure File Uploads
Validate file types and sizes.
Do not trust filenames or client-provided MIME types.
Store uploaded files safely.
Prevent uploaded content from being executed as application code.
7. Data Protection
Collect only necessary personal information.
Protect sensitive information.
Encrypt data in transit using TLS.
Encrypt sensitive stored information where appropriate.
Avoid exposing confidential information in logs.
Apply appropriate data retention and deletion policies.
8. Secrets Management
Never hardcode passwords, API keys, tokens, or private keys.
Use environment variables or an appropriate secrets manager.
Never commit production secrets to version control.
Rotate compromised credentials.
Restrict access to secrets.
Keep example environment files free of real credentials.
9. API Security
Authenticate protected endpoints.
Enforce authorization.
Validate request payloads.
Apply rate limiting where appropriate.
Use secure communication.
Avoid exposing stack traces.
Return consistent error responses.
Validate external API responses before using them.
10. Logging and Monitoring
Record important security events.
Monitor repeated authentication failures.
Record relevant access and permission changes.
Avoid logging passwords, tokens, and sensitive personal information.
Protect log files from unauthorized access.
Establish appropriate alerting for suspicious activities.
11. Dependencies and Infrastructure
Use trusted dependencies.
Monitor dependency vulnerabilities.
Apply security updates.
Remove unused packages.
Secure deployment configurations.
Disable unnecessary services and endpoints.
Restrict infrastructure access.
12. Security Testing
Test authentication and authorization.
Test access restrictions.
Validate input handling.
Review dependency vulnerabilities.
Test error handling.
Review sensitive data exposure.
Perform security assessments appropriate to the system's risk.
13. AI-Assisted Development Instructions

When using Codex:

Never introduce hardcoded secrets.
Never weaken authentication or authorization to simplify implementation.
Follow existing security mechanisms.
Validate all untrusted input.
Use safe database access methods.
Avoid exposing sensitive information.
Protect all sensitive endpoints.
Review security implications before introducing dependencies.
Do not disable security controls without explicit approval.
Report potential vulnerabilities discovered during development.
14. Security Quality Checklist
Authentication is properly implemented.
Authorization is enforced server-side.
Inputs are validated.
Database queries are protected against injection.
Sensitive data is protected.
Secrets are not committed to source control.
APIs have appropriate access controls.
Errors do not expose sensitive details.
Dependencies are reviewed.
Security events are logged appropriately.
15. Guiding Principle

Security is not a feature that should be added at the end of development.

Every module, endpoint, database operation, and integration must be designed with appropriate security controls.