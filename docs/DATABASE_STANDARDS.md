Database Standards
1. Purpose

This document establishes database design, implementation, management, and maintenance standards.

The objective is to ensure that database operations are:

Reliable.
Secure.
Consistent.
Efficient.
Maintainable.
Scalable.
Recoverable.

These standards apply to all database structures, queries, transactions, and data operations.

2. Database Design Principles
2.1 Database Normalization
Apply appropriate normalization to reduce unnecessary duplication.
Maintain logical relationships between entities.
Avoid storing the same information in multiple places without justification.
Use denormalization only when there is a documented performance or business justification.
2.2 Data Integrity
Use appropriate data types.
Define primary keys.
Define foreign keys where applicable.
Apply unique constraints when required.
Apply NOT NULL constraints to mandatory fields.
Use CHECK constraints where supported and appropriate.
Validate data before saving.
2.3 Referential Integrity
Maintain valid relationships between related records.
Avoid orphaned records.
Define appropriate deletion and update behavior.
Use cascading operations only when they match business requirements.
2.4 Naming Conventions

Use consistent and descriptive names for:

Tables.
Columns.
Primary keys.
Foreign keys.
Indexes.
Constraints.
Views.
Stored procedures.

Follow the existing project's naming convention.

3. Database Structure
Design tables around clearly defined entities.
Avoid excessively large tables containing unrelated information.
Use appropriate relationship types.
Define many-to-many relationships through junction tables where appropriate.
Use appropriate data types and field lengths.
Avoid unnecessary nullable fields.
Document complex relationships.
4. Database Transactions

Follow ACID principles where supported:

Atomicity: A transaction should complete fully or be rolled back.
Consistency: Transactions must preserve database rules.
Isolation: Concurrent transactions must not produce invalid results.
Durability: Committed changes must persist.

Use transactions for operations that require multiple related database changes to succeed together.

5. Database Queries and Performance
Avoid unnecessary database queries.
Retrieve only the required columns.
Use appropriate indexes.
Avoid N+1 query problems.
Use pagination for large result sets.
Review expensive queries.
Use parameterized queries.
Avoid retrieving entire tables unnecessarily.
Use query optimization based on actual performance evidence.
6. Database Migrations
Use version-controlled database migrations.
Never make undocumented production schema changes.
Review migrations before applying them.
Keep migrations consistent across environments.
Consider backward compatibility.
Prepare rollback procedures where feasible.
Back up important data before risky schema changes.
7. Data Validation
Validate data at the application boundary.
Enforce important business constraints at the appropriate layers.
Use database constraints as an additional integrity safeguard.
Never rely exclusively on frontend validation.
Validate foreign key relationships and referenced records.
8. Security
Use parameterized queries or safe ORM operations.
Avoid dynamically constructing SQL from untrusted input.
Apply least-privilege database permissions.
Protect database credentials.
Avoid exposing sensitive database errors to users.
Encrypt sensitive data when required.
Avoid storing passwords in plaintext.
9. Backup and Recovery
Establish a backup strategy.
Verify that backups can actually be restored.
Define appropriate recovery objectives.
Protect backups against unauthorized access.
Document recovery procedures.
Consider point-in-time recovery where supported and required.
10. Audit and Data Management

Where required by the system:

Record important data changes.
Track who performed important operations.
Record timestamps consistently.
Maintain appropriate audit history.
Apply retention policies.
Protect audit records against unauthorized modification.
11. AI-Assisted Development Instructions

When using Codex:

Inspect the existing database schema before modifying it.
Follow existing database naming conventions.
Never assume existing columns or tables without verification.
Use migrations for schema changes.
Preserve existing data.
Avoid destructive database operations without explicit approval.
Review foreign key relationships and dependencies.
Use transactions for multi-step operations where required.
Add appropriate indexes based on query requirements.
Explain potentially risky database changes.
12. Database Quality Checklist
Tables have clearly defined responsibilities.
Primary and foreign keys are appropriate.
Relationships are correctly defined.
Data types are appropriate.
Constraints protect data integrity.
Queries are parameterized.
Indexes are justified.
Migrations are version-controlled.
Transactions are used where required.
Backup and recovery procedures exist.
13. Guiding Principle

The database is a critical part of the system.

Prioritize data integrity, consistency, security, and recoverability before optimizing for performance.