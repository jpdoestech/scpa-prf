S.O.L.I.D Principles for System Development
1. Purpose

This document defines the S.O.L.I.D software design principles that must guide the development, implementation, and maintenance of this system.

The goal is to ensure that the system remains:

Maintainable
Scalable
Flexible
Reusable
Testable
Easy to understand
Easy to extend

These principles should be considered whenever creating new modules, modifying existing code, designing system architecture, or integrating external services.

2. The Five S.O.L.I.D Principles
S – Single Responsibility Principle (SRP)

Definition: A class, module, or component should have only one responsibility and one primary reason to change.

Development Guidelines:

Keep each class and module focused on a specific responsibility.
Avoid putting unrelated business logic into a single class or service.
Separate database operations, business logic, validation, and presentation logic when appropriate.
Avoid creating large components that handle multiple unrelated tasks.

Example:

In an Inventory Management System:

ProductService handles product-related operations.
InventoryService handles stock management.
SalesService handles sales transactions.
ReportService handles report generation.

A ProductService should not be responsible for processing sales transactions or generating reports.

O – Open/Closed Principle (OCP)

Definition: Software components should be open for extension but closed for modification.

Development Guidelines:

Design components so new functionality can be added without unnecessarily modifying existing working code.
Use interfaces, abstractions, and composition where appropriate.
Avoid excessive conditional statements when handling different implementations.
Preserve existing functionality when introducing new features.

Example:

A payment system should support multiple payment methods.

Instead of rewriting the existing payment logic whenever a new payment method is introduced, implement a common payment abstraction.

Possible implementations:

GCashPayment
MayaPayment
CreditCardPayment
BankTransferPayment

A new payment method should be introduced without requiring major changes to existing payment implementations.

L – Liskov Substitution Principle (LSP)

Definition: Objects of a subclass should be usable wherever objects of their parent type are expected without breaking the expected behavior of the application.

Development Guidelines:

Ensure implementations honor the behavior promised by their parent types or interfaces.
Do not introduce unexpected exceptions or restrictions in subclasses.
Maintain consistent input, output, and behavioral expectations.
Prefer composition over inheritance when inheritance does not represent a valid relationship.

Example:

If a system defines a PaymentProcessor interface, every implementation must follow its expected payment-processing contract.

A GCashPaymentProcessor and MayaPaymentProcessor should both behave consistently according to that contract.

Neither implementation should silently ignore required payment operations or violate the expected result format.

I – Interface Segregation Principle (ISP)

Definition: Clients should not be forced to depend on interfaces or methods they do not use.

Development Guidelines:

Create small, focused interfaces.
Avoid large interfaces containing unrelated methods.
Separate responsibilities into appropriate contracts.
Ensure classes implement only the functionality relevant to their responsibilities.

Example:

Instead of creating one large EmployeeManagement interface containing employee records, payroll, attendance, and reporting operations, separate the contracts:

EmployeeRepository
PayrollProcessor
AttendanceManager
EmployeeReportGenerator

This allows each component to depend only on the operations it actually needs.

D – Dependency Inversion Principle (DIP)

Definition: High-level modules should not depend directly on low-level modules. Both should depend on abstractions.

Development Guidelines:

Depend on interfaces or abstractions rather than concrete implementations.
Avoid tightly coupling business logic to specific database providers, payment gateways, or external APIs.
Use dependency injection where appropriate.
Keep infrastructure details separate from core business logic.

Example:

An OrderService should depend on a PaymentProcessor abstraction rather than directly depending on a specific GCash or Maya implementation.

This makes it easier to replace payment providers without rewriting the order-processing business logic.

3. Applying S.O.L.I.D During System Development

The following practices should be followed throughout the development lifecycle.

3.1 Requirements Analysis
Identify the responsibilities of each system module.
Avoid combining unrelated business processes.
Identify dependencies between modules.
Determine which functionalities may need future extensions.
3.2 System Architecture and Design
Separate presentation, business logic, and data access responsibilities where appropriate.
Define clear module boundaries.
Use interfaces and abstractions for important dependencies.
Avoid unnecessary coupling between modules.
3.3 Implementation
Follow the five S.O.L.I.D principles when writing code.
Keep functions, classes, and services focused.
Avoid duplicated business logic.
Use dependency injection where appropriate.
Follow existing project architecture and conventions.
3.4 Testing
Write unit tests for individual business components.
Test implementations against their expected contracts.
Verify that extending one module does not break unrelated functionality.
Use integration tests for important module interactions.
3.5 Maintenance and Enhancement
Review existing responsibilities before adding new functionality.
Avoid modifying unrelated modules.
Refactor code when responsibilities become too broad.
Preserve backward compatibility where required.
Ensure new implementations follow established interfaces and contracts.
4. General Coding Standards for Codex

When generating or modifying code, follow these rules:

Follow the S.O.L.I.D principles whenever applicable.
Respect the existing system architecture and technology stack.
Do not place all business logic inside controllers, routes, or UI components.
Avoid unnecessarily large classes, services, and functions.
Use meaningful names for classes, methods, variables, and modules.
Separate business logic from infrastructure and presentation concerns.
Use dependency injection and abstractions where appropriate.
Avoid unnecessary inheritance and excessive abstraction.
Do not introduce design patterns without a practical reason.
Write testable and maintainable code.
Avoid changing unrelated files when implementing a feature.
Do not overengineer simple functionality merely to satisfy a design principle.
5. Instructions for AI-Assisted Development

When using Codex to develop this system:

Read this document before implementing significant features or modifying system architecture.
Follow the S.O.L.I.D principles when designing new modules and components.
Review existing code before introducing new abstractions or services.
Identify potential violations of S.O.L.I.D in the code being modified.
Prefer small, focused, and maintainable implementations.
Explain significant architectural decisions.
Report any unavoidable trade-offs or deviations from these principles.
Do not refactor unrelated code without a clear reason.

If a proposed implementation violates a S.O.L.I.D principle, evaluate whether the violation is justified by the system's requirements and complexity.

6. Important Reminder

S.O.L.I.D principles are software design guidelines, not rigid rules that must be applied mechanically.

The objective is not to create more classes, interfaces, or layers.

The objective is to create a system that is:

Well-organized
Easy to understand
Easy to test
Easy to maintain
Easy to extend

Every architectural decision should improve the overall quality of the system without introducing unnecessary complexity.