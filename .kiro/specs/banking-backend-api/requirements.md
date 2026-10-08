# Requirements Document

## Introduction

This feature delivers a production-ready RESTful backend API for a full-stack banking system. The scope of this phase is strictly the backend: a secure, modular, and fully tested Node.js, Express, and MongoDB service that acts as the single source of truth for all account balances and transactions. No frontend components are produced in this phase.

The backend provides customer-facing banking operations (registration, authentication, deposits, withdrawals, transfers, transaction history, profile management) and administrative operations (customer, account, and transaction oversight; system statistics; account status control). It enforces financial precision, atomicity of money movement, race-condition protection, role-based access control, and standardized responses.

Monetary integrity is a first-class concern: balances and amounts are stored in the lowest currency unit (pesewas) as integers to avoid floating-point errors, transfers execute inside MongoDB multi-document ACID transactions, and all security-sensitive identity data is derived from the authenticated token rather than from client payloads.

## Glossary

- **Backend_API**: The Node.js, Express, and Mongoose service that exposes the banking REST endpoints and owns all balance and transaction state.
- **Auth_Service**: The component responsible for user registration, credential verification, JWT issuance, and returning authenticated profile data.
- **Account_Service**: The component responsible for retrieving account details and balance for the authenticated user.
- **Transaction_Service**: The component responsible for deposits, withdrawals, transfers, and transaction history retrieval.
- **Bank_Service**: The reusable business-logic component that performs balance mutations and transaction record creation, including atomic transfer orchestration.
- **Admin_Service**: The component responsible for administrative listing, aggregation statistics, and account status control.
- **Auth_Middleware**: The component that validates a JWT and attaches the authenticated user identity to the request as `req.user`.
- **Role_Middleware**: The component that authorizes requests based on the authenticated user role.
- **Validation_Middleware**: The component that validates and sanitizes request payloads before controller logic executes.
- **Rate_Limiter**: The component that limits the number of requests to authentication endpoints within a time window.
- **Error_Handler**: The central component that converts errors into standardized error responses.
- **User**: A person with credentials and a profile stored in the User collection, having a role of CUSTOMER or ADMIN.
- **Customer**: A User whose role is CUSTOMER.
- **Admin**: A User whose role is ADMIN.
- **Account**: A banking account owned by a User, holding a balance, account number, currency, and status.
- **Transaction**: An immutable record of a balance-changing event of type CREDIT, DEBIT, or TRANSFER.
- **Pesewa**: The lowest unit of Ghanaian Cedi (GHS); monetary values are stored as integer pesewas (100 pesewas = 1 GHS).
- **Account_Status**: The operational state of an Account, one of Active, Frozen, or Disabled.
- **JWT**: A signed JSON Web Token used to authenticate requests.
- **Reference**: A unique transaction identifier string in the form TXN-XXXXXXXX.
- **Account_Number**: A unique 10-digit string identifying an Account.
- **System_Liquidity**: The sum of all Account balances across the system.

## Requirements

### Requirement 1: User Registration and Account Provisioning

**User Story:** As a prospective customer, I want to register with my personal details, so that I obtain banking credentials and a linked account.

#### Acceptance Criteria

1. WHEN a registration request is received with a valid firstName (1 to 50 characters), lastName (1 to 50 characters), email (valid email format, maximum 254 characters), phone (digits only, 10 to 15 characters), dateOfBirth (valid date corresponding to an age of at least 18 years), address (1 to 255 characters), and password (8 to 128 characters), THE Auth_Service SHALL create a User with the password stored as a bcrypt hash and the role set to CUSTOMER.
2. WHEN a User is created during registration, THE Auth_Service SHALL create exactly one linked Account for that User with a balance of 0 pesewas, a currency of GHS, a status of Active, and an Account_Number that is exactly 10 numeric digits and unique across all existing Accounts.
3. IF a registration request contains an email that already exists in the User collection, THEN THE Auth_Service SHALL return an error response with HTTP status 409, an error message indicating the email is already registered, and SHALL NOT create a User or Account.
4. IF a registration request contains one or more missing or invalid required fields, THEN THE Validation_Middleware SHALL return an error response with HTTP status 400 and an error message indicating which fields failed validation, and SHALL NOT create a User or Account.
5. WHEN registration completes successfully, THE Auth_Service SHALL return an HTTP 201 response within 2000 milliseconds whose data includes the created User and linked Account and excludes the password and password hash.
6. IF Account creation fails after the User is created during a registration request, THEN THE Auth_Service SHALL roll back the created User, return an error response with HTTP status 500, and an error message indicating registration could not be completed.

### Requirement 2: User Authentication

**User Story:** As a registered customer, I want to log in with my credentials, so that I receive a token to access protected endpoints.

#### Acceptance Criteria

1. WHEN a login request is received with an email and password that match a stored User, THE Auth_Service SHALL return an HTTP 200 response within 2000 milliseconds containing a signed JWT with an expiry of 3600 seconds and a safe user payload that excludes the password hash and any password-related fields.
2. IF a login request contains an email that does not match any User OR a password that does not match the stored hash, THEN THE Auth_Service SHALL return an error response with HTTP status 401 and a message indicating invalid credentials, without disclosing which of email or password was incorrect.
3. IF a login request contains a missing email field, a missing password field, an email not conforming to a valid email format, an email exceeding 254 characters, or a password outside the range of 8 to 128 characters, THEN THE Validation_Middleware SHALL return an error response with HTTP status 400 and a message indicating which field failed validation, and SHALL NOT invoke the Auth_Service.
4. WHEN 5 consecutive failed login attempts occur for the same email within 300 seconds, THE Auth_Service SHALL reject further login attempts for that email with HTTP status 429 for a lockout period of 900 seconds, and SHALL preserve the stored User record unchanged.

### Requirement 3: Authenticated Identity Resolution

**User Story:** As a security stakeholder, I want the system to derive user identity from the token, so that clients cannot impersonate other users.

#### Acceptance Criteria

1. WHEN a request to a protected endpoint includes a valid JWT in the Authorization header, THE Auth_Middleware SHALL attach the user identity resolved from the token's subject claim to the request as `req.user` and SHALL pass control to the protected endpoint handler.
2. IF a request to a protected endpoint omits the Authorization token, THEN THE Auth_Middleware SHALL reject the request before the protected endpoint handler executes and SHALL return an error response with HTTP status 401 and a message indicating a missing token.
3. IF a request to a protected endpoint includes an expired JWT, THEN THE Auth_Middleware SHALL reject the request before the protected endpoint handler executes and SHALL return an error response with HTTP status 401 and a message indicating an expired token.
4. IF a request to a protected endpoint includes a malformed or invalid JWT, THEN THE Auth_Middleware SHALL reject the request before the protected endpoint handler executes and SHALL return an error response with HTTP status 401 and a message indicating an invalid token.
5. WHEN any balance-changing or data-access operation resolves the acting user, THE Backend_API SHALL use the identity from `req.user`.
6. WHEN any balance-changing or data-access operation resolves the acting user, THE Backend_API SHALL ignore any userId, balance, or account identity supplied in the client payload.

### Requirement 4: Authenticated Profile and Account Overview

**User Story:** As a customer, I want to view my profile and account overview, so that I can confirm my identity and balance.

#### Acceptance Criteria

1. WHEN a request bearing a valid authentication credential is received at the profile overview endpoint, THE Auth_Service SHALL return an HTTP 200 response containing the authenticated User profile with the password field omitted and the associated Account overview.
2. IF a request is received at the profile overview endpoint without a valid authentication credential, THEN THE Auth_Service SHALL return an HTTP 401 response, SHALL exclude any User profile or Account data from the response body, and SHALL include an error indication that authentication is required.
3. WHEN a request bearing a valid authentication credential is received at the account details endpoint, THE Account_Service SHALL return an HTTP 200 response containing the Account_Number, balance, currency, accountType, and Account_Status for the authenticated User.
4. IF a request is received at the account details endpoint for which the authenticated User owns no associated Account, THEN THE Account_Service SHALL return an HTTP 404 response with an error indication that no account exists for the User and SHALL exclude any Account data from the response body.

### Requirement 5: Deposit Funds

**User Story:** As a customer, I want to deposit funds into my account, so that my balance increases and the event is recorded.

#### Acceptance Criteria

1. WHEN an authenticated deposit request is received with an integer amount from 1 to 999,999,999,999 pesewas, THE Transaction_Service SHALL increase the authenticated User Account balance by the amount using an atomic increment operation.
2. WHEN a deposit increases the balance, THE Transaction_Service SHALL create a Transaction of type CREDIT recording amount, balanceBefore, balanceAfter, a Reference unique across all Transactions, and a status of COMPLETED.
3. IF a deposit request contains an amount less than or equal to 0, a non-integer value, or an amount greater than 999,999,999,999 pesewas, THEN THE Validation_Middleware SHALL return an error response with HTTP status 400 indicating the amount is invalid, and SHALL leave the User Account balance unchanged.
4. IF the authenticated User Account has an Account_Status of Frozen or Disabled, THEN THE Transaction_Service SHALL reject the deposit with an error response with HTTP status 403 indicating the account state does not permit deposits, and SHALL leave the User Account balance unchanged and record no Transaction.
5. WHEN the atomic increment operation in criterion 1 fails to persist, THE Transaction_Service SHALL return an error response with HTTP status 500 indicating the deposit could not be completed, SHALL leave the User Account balance unchanged, and SHALL record no Transaction with a status of COMPLETED.

### Requirement 6: Withdraw Funds

**User Story:** As a customer, I want to withdraw funds from my account, so that my balance decreases and the event is recorded.

#### Acceptance Criteria

1. WHEN an authenticated withdrawal request is received with an amount greater than 0 AND the authenticated User Account balance is greater than or equal to the amount, THE Transaction_Service SHALL decrease the balance by the amount using an atomic conditional operation that prevents the balance from becoming negative and SHALL complete the operation within 2000 milliseconds.
2. WHEN a withdrawal decreases the balance, THE Transaction_Service SHALL create a Transaction of type DEBIT recording amount, balanceBefore, balanceAfter, a Reference that is unique across all Transactions, a status of COMPLETED, and a creation timestamp.
3. IF a withdrawal request contains an amount that exceeds the authenticated User Account balance, THEN THE Transaction_Service SHALL reject the withdrawal, leave the balance unchanged, create no Transaction, and return an error response with HTTP status 400 and a message indicating insufficient funds.
4. IF a withdrawal request contains an amount that is less than or equal to 0, a non-integer value, or greater than 999,999,999,999 pesewas, THEN THE Validation_Middleware SHALL reject the withdrawal, leave the balance unchanged, and return an error response with HTTP status 400 and a message indicating the amount is invalid.
5. IF the authenticated User Account has an Account_Status of Frozen or Disabled, THEN THE Transaction_Service SHALL reject the withdrawal, leave the balance unchanged, create no Transaction, and return an error response with HTTP status 403 and a message indicating the account cannot transact.
6. IF two or more withdrawal requests for the same User Account are processed concurrently, THEN THE Transaction_Service SHALL apply each atomic conditional operation independently such that the resulting balance never becomes negative.

### Requirement 7: Transfer Funds Between Accounts

**User Story:** As a customer, I want to transfer funds to another account by account number, so that money moves atomically between accounts with a complete audit trail.

#### Acceptance Criteria

1. WHEN an authenticated transfer request is received with an integer amount from 1 to 999,999,999,999 pesewas and a recipientAccountNumber that is a 10-digit Account_Number matching an existing Account AND the sender Account balance is greater than or equal to the amount, THE Bank_Service SHALL debit the sender Account by the amount within a single MongoDB session transaction.
2. WHEN the sender Account is debited within the transfer session transaction, THE Bank_Service SHALL credit the recipient Account by the same amount within the same session transaction.
3. WHEN a transfer debit and credit both complete within the session transaction, THE Bank_Service SHALL commit the session transaction and return an HTTP 200 response within 5 seconds of receiving the request.
4. WHEN a transfer commits successfully, THE Bank_Service SHALL create one Transaction of type TRANSFER with a DEBIT effect for the sender and one Transaction of type TRANSFER with a CREDIT effect for the recipient, each recording amount, balanceBefore, balanceAfter, a unique Reference, a status of COMPLETED, and a relatedAccount link to the counterparty Account.
5. IF any step of a transfer fails after the session transaction begins, THEN THE Bank_Service SHALL abort the session transaction so that neither the sender Account balance nor the recipient Account balance changes.
6. IF a transfer request contains an amount less than or equal to 0, a non-integer amount, or an amount greater than 999,999,999,999 pesewas, THEN THE Validation_Middleware SHALL reject the request with an error response with HTTP status 400 before any balance is changed.
7. IF a transfer request passes amount validation and contains a recipientAccountNumber equal to the sender Account_Number, THEN THE Bank_Service SHALL return an error response with HTTP status 400 and a message indicating that self-transfer is not permitted.
8. IF a transfer request passes amount and self-transfer validation and contains a recipientAccountNumber that does not match any Account, THEN THE Bank_Service SHALL return an error response with HTTP status 404.
9. IF a transfer request resolves an existing recipient Account and the sender Account OR the recipient Account has an Account_Status of Frozen or Disabled, THEN THE Bank_Service SHALL reject the transfer with an error response with HTTP status 403 and SHALL leave both Account balances unchanged.
10. IF a transfer request resolves an active sender and recipient Account and the amount exceeds the sender Account balance, THEN THE Bank_Service SHALL return an error response with HTTP status 400 and a message indicating insufficient funds and SHALL leave both Account balances unchanged.

### Requirement 8: Transaction History Retrieval

**User Story:** As a customer, I want to view and filter my transaction history, so that I can review my account activity.

#### Acceptance Criteria

1. WHEN an authenticated request is received at the transaction history endpoint, THE Transaction_Service SHALL return an HTTP 200 response containing only Transactions owned by the authenticated User, ordered by creation timestamp in descending order.
2. WHEN a transaction history request is received without page or limit parameters, THE Transaction_Service SHALL return the first page using a default page number of 1 and a default page size of 20 results.
3. WHEN a transaction history request includes page and limit parameters within the valid range (page greater than or equal to 1, limit between 1 and 100 inclusive), THE Transaction_Service SHALL return the corresponding page of results and SHALL include total count, current page number, and page size in the response data.
4. IF a transaction history request includes a page less than 1, a non-integer page or limit, or a limit outside the range 1 to 100 inclusive, THEN THE Transaction_Service SHALL return an error response with HTTP status 400 and SHALL NOT return any Transactions.
5. WHEN a transaction history request includes a type filter matching a defined Transaction type, THE Transaction_Service SHALL return only Transactions whose type equals the requested type.
6. WHEN a transaction history request includes startDate and endDate filters that form a valid range (startDate less than or equal to endDate), THE Transaction_Service SHALL return only Transactions whose creation timestamp falls within the inclusive range from startDate to endDate.
7. IF a transaction history request includes a startDate or endDate that is not a valid date, or a startDate greater than endDate, THEN THE Transaction_Service SHALL return an error response with HTTP status 400 and SHALL NOT return any Transactions.
8. WHEN a transaction history request includes a search term between 1 and 255 characters, THE Transaction_Service SHALL return only Transactions whose description or Reference contains the search term as a case-insensitive substring.
9. WHEN a transaction history request matches no Transactions owned by the authenticated User, THE Transaction_Service SHALL return an HTTP 200 response containing an empty result set with a total count of 0.
10. WHEN an authenticated request is received for a specific Transaction by identifier that is owned by the authenticated User, THE Transaction_Service SHALL return an HTTP 200 response containing that Transaction.
11. IF an authenticated request references a Transaction identifier that is not owned by the authenticated User, THEN THE Transaction_Service SHALL return an error response with HTTP status 404.

### Requirement 9: Profile Management

**User Story:** As a customer, I want to view and update my safe profile information, so that my contact details stay current without exposing financial fields to modification.

#### Acceptance Criteria

1. WHEN an authenticated request is received at the user profile endpoint, THE Account_Service SHALL return an HTTP 200 response within 2 seconds containing the authenticated User profile excluding the password field.
2. IF a request to the user profile endpoint lacks a valid authentication token, THEN THE Account_Service SHALL reject the request with an HTTP 401 response, SHALL return an error indicating authentication is required, and SHALL NOT return any User profile data.
3. WHEN an authenticated update request is received with a phone field of 7 to 20 characters and/or an address field of 1 to 255 characters, THE Account_Service SHALL update only the phone and address fields of the authenticated User and SHALL return an HTTP 200 response within 2 seconds.
4. IF an authenticated update request includes balance, Account_Number, role, or email fields, THEN THE Account_Service SHALL ignore those fields and SHALL leave the stored balance, Account_Number, role, and email unchanged.
5. IF an authenticated update request contains a phone value outside 7 to 20 characters, a phone value containing characters other than digits and the characters plus, hyphen, space, or parentheses, or an address value outside 1 to 255 characters, THEN THE Validation_Middleware SHALL reject the request with an HTTP 400 response, SHALL return an error indicating which field is invalid, and SHALL leave all stored User fields unchanged.

### Requirement 10: Administrative Oversight

**User Story:** As an admin, I want to list customers, accounts, and transactions, so that I can monitor the banking system.

#### Acceptance Criteria

1. IF a request to an admin endpoint is made by a User whose role is not ADMIN, THEN THE Role_Middleware SHALL reject the request with an HTTP 403 response and an error indicating insufficient privileges, and SHALL NOT return any Customer, Account, or Transaction data.
2. WHEN an authenticated Admin requests the customers list, THE Admin_Service SHALL return an HTTP 200 response containing a page of Customers ordered by a deterministic key, with page size defaulting to 20 and constrained to a range of 1 to 100 records per page.
3. WHEN an authenticated Admin requests the customers list with a search parameter, THE Admin_Service SHALL return an HTTP 200 response containing only Customers matching the search parameter, where the search parameter is limited to a maximum of 256 characters.
4. IF an authenticated Admin requests any admin list with a pagination parameter outside its allowed range or in a non-numeric format, THEN THE Admin_Service SHALL reject the request with an HTTP 400 response and an error indicating the invalid pagination parameter.
5. WHEN an authenticated Admin requests the accounts list, THE Admin_Service SHALL return an HTTP 200 response containing a page of Accounts and each Account's current balance, ordered by a deterministic key, with page size defaulting to 20 and constrained to a range of 1 to 100 records per page.
6. WHEN an authenticated Admin requests the system transactions list, THE Admin_Service SHALL return an HTTP 200 response containing a page of system-wide Transactions ordered by a deterministic key, with page size defaulting to 20 and constrained to a range of 1 to 100 records per page.

### Requirement 11: Administrative Statistics

**User Story:** As an admin, I want aggregate system statistics, so that I can assess the health and liquidity of the bank.

#### Acceptance Criteria

1. WHEN an authenticated user with the Admin role requests statistics, THE Admin_Service SHALL compute Total Customers, Total Accounts, System_Liquidity, Total Deposits, Total Withdrawals, and Total Transfers using a MongoDB aggregation pipeline over the stored collections, where System_Liquidity equals the sum of all account balances, and each total count is an integer greater than or equal to 0.
2. WHEN statistics are computed, THE Admin_Service SHALL return an HTTP 200 response within 3 seconds whose data reflects the state of the User, Account, and Transaction collections as of the time the request was received.
3. IF an authenticated user without the Admin role requests statistics, THEN THE Admin_Service SHALL reject the request, return an error response indicating insufficient privileges, and return no statistics data.
4. IF the aggregation pipeline fails to complete, THEN THE Admin_Service SHALL return an error response indicating the statistics could not be computed and SHALL NOT return partial statistics data.
5. WHEN a requested collection contains no records, THE Admin_Service SHALL return a value of 0 for each affected total rather than omitting the field or returning null.

### Requirement 12: Administrative Account Status Control

**User Story:** As an admin, I want to freeze or unfreeze customer accounts, so that I can control which accounts may transact.

#### Acceptance Criteria

1. WHEN an authenticated Admin submits an account status update with a target Account identifier and a status of Active, Frozen, or Disabled, THE Admin_Service SHALL set the Account_Status of the target Account to the submitted status and SHALL return an HTTP 200 response reflecting the updated status.
2. IF an authenticated user without the Admin role submits an account status update, THEN THE Role_Middleware SHALL reject the request with an HTTP 403 response indicating insufficient privileges and SHALL leave the target Account unchanged.
3. IF an account status update references an Account identifier that does not exist, THEN THE Admin_Service SHALL return an error response with HTTP status 404 and SHALL make no change.
4. IF an account status update omits the status field or contains a status value that is not Active, Frozen, or Disabled, THEN THE Validation_Middleware SHALL return an error response with HTTP status 400 and SHALL leave the target Account unchanged.
5. WHILE an Account has a status of Frozen or Disabled, THE Transaction_Service and Bank_Service SHALL reject any deposit, withdrawal, or transfer that would debit or credit that Account.

### Requirement 13: Standardized Responses and Central Error Handling

**User Story:** As a frontend developer, I want consistent response shapes and clear error codes, so that I can reliably consume the API.

#### Acceptance Criteria

1. WHEN any request completes successfully, THE Backend_API SHALL return a response body containing a success field set to true, a message field, and a data field.
2. IF any request fails, THEN THE Error_Handler SHALL return a response body containing a success field set to false and a message field, with no data field, and an HTTP status code drawn from the set {400, 401, 403, 404, 409, 429, 500} appropriate to the failure.
3. THE Error_Handler SHALL exclude password hashes, JWT values, and JWT signing secrets from all response bodies and log output.
4. WHEN an unhandled error reaches the Error_Handler, THE Error_Handler SHALL return an error response with HTTP status 500 and SHALL NOT include a stack trace in the response body.

### Requirement 14: Security Controls

**User Story:** As a security stakeholder, I want layered security controls, so that the API resists common attacks and protects customer data.

#### Acceptance Criteria

1. WHEN the Backend_API returns any HTTP response, THE Backend_API SHALL include Helmet security headers.
2. WHEN the Backend_API receives a cross-origin request, THE Backend_API SHALL apply a configured CORS policy that permits only origins on the configured allowlist.
3. WHEN the number of requests to an authentication endpoint from a single client exceeds 5 requests within a 15-minute window, THE Rate_Limiter SHALL return an error response with HTTP status 429.
4. WHEN the Backend_API receives a request with a body on any endpoint that accepts a request body, THE Validation_Middleware SHALL validate and sanitize the payload before controller logic executes.
5. IF a request payload fails validation, THEN THE Validation_Middleware SHALL return an error response with HTTP status 400 and SHALL NOT execute controller logic.
6. WHEN a Customer requests account, transaction, or profile data, THE Backend_API SHALL return only data owned by that Customer.
7. IF a Customer requests account, transaction, or profile data owned by another User, THEN THE Backend_API SHALL return an error response with HTTP status 403 or 404 and SHALL NOT return the other User's data.
8. THE User model SHALL store passwords only as bcrypt hashes.
9. THE User model SHALL exclude the password field from query results by default.

### Requirement 15: Monetary Precision and Integrity

**User Story:** As a banking stakeholder, I want exact monetary arithmetic, so that balances never drift due to floating-point errors.

#### Acceptance Criteria

1. THE Backend_API SHALL store all Account balances and Transaction amounts as integer pesewas within the inclusive range 0 to 9,999,999,999,999 pesewas for balances and 1 to 999,999,999,999 pesewas for Transaction amounts.
2. WHEN a balance-changing operation updates an Account balance, THE Bank_Service SHALL apply the change using an atomic increment operation so that concurrent operations cannot overwrite each other.
3. THE Bank_Service SHALL compute balanceAfter for every deposit, withdrawal, and transfer operation such that balanceAfter equals balanceBefore plus the signed integer amount of the operation.
4. WHEN a withdrawal or a transfer debit is attempted, THE Bank_Service SHALL use a conditional atomic update that applies the debit only while the stored balance is greater than or equal to the amount, so that double-spending is prevented.
5. IF a deposit, withdrawal, or transfer amount is not a positive integer or falls outside the inclusive range 1 to 999,999,999,999 pesewas, THEN THE Bank_Service SHALL reject the operation, leave all affected Account balances unchanged, and return an error indicating an invalid amount.
6. IF a withdrawal or transfer debit is attempted while the stored balance is less than the amount, THEN THE Bank_Service SHALL reject the operation, leave all affected Account balances unchanged, and return an error indicating insufficient funds.
