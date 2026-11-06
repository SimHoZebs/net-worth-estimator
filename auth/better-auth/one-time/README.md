# One-time identity and policy cutover

This procedure replaces the identity service without changing financial IDs.
Runtime and normal setup contain no conversion logic. Retain these tools until
every supported target verifies this upgrade through `deploy/MIGRATIONS.md`.

## Prepare

1. Stop API writes and synchronization.
2. Stop the old identity service.
3. Back up application storage, identity storage, policies, and private configuration.
4. Export subjects, usernames, display names, disabled state, and bcrypt hashes from Casdoor.
5. Record effective read, project, and write decisions for every subject.
6. Review the exact issuer and original guest subject.

Use trusted operator access. Never derive subjects from names or emails. Resolve
policies before shutdown or from a verified snapshot. Include deny precedence and
disabled assignments. The existing model restricts these actions to each subject's
own resource. If the deployed model differs, review its semantics before import.

Create a private reviewed manifest:

```json
{
  "issuer": "https://existing-identity.example.com",
  "guestSubject": "original-guest-uuid",
  "users": [
    {
      "subject": "original-owner-uuid",
      "username": "owner",
      "displayName": "Owner",
      "bcryptHash": "$2a$12$...existing-full-hash...",
      "disabled": false,
      "permissions": ["user:read", "user:project", "user:write"]
    },
    {
      "subject": "original-guest-uuid",
      "username": "guest",
      "displayName": "Guest",
      "disabled": true,
      "permissions": ["user:read", "user:project"]
    }
  ]
}
```

The guest cannot sign in interactively. Its anonymous permissions stay active.
Every enabled private user needs a bcrypt hash. Unsupported formats need an
explicit offline password reset before import. New passwords also use bcrypt,
so the runtime needs no legacy-password branch.

## Import into fresh targets

Keep `AUTH_PUBLIC_URL` byte-identical to the original issuer. Select fresh identity
storage and distinct new client/auth secrets. For PostgreSQL, create an isolated
schema and select it through the URI's `search_path`. Do not reuse old tables.
Keep the original database intact for rollback.

```bash
bun run auth/better-auth/one-time/import-casdoor.ts /private/reviewed.json /private/bootstrap.json
go -C backend run ./scripts/one-time/casdoor-authz --manifest /private/reviewed.json --app-db /private/application.db --db /private/authorization.db
```

The policy importer verifies coverage of every financial owner and the exact
issuer. It writes explicit grants, including empty grants. First-login defaults
cannot widen imported access. Importers refuse an existing destination. Never
start a server against a failed import.

With services stopped, expire old application credentials after backups exist:

```sql
BEGIN IMMEDIATE;
DELETE FROM sessions;
DELETE FROM identity_grants;
DELETE FROM identity_logout_marks;
DELETE FROM identity_logout_tokens;
COMMIT;
```

Keep all users, financial rows, friendships, sharing records, and social groups.
Passkeys and old provider sessions are not imported. Users enroll fresh passkeys
after password sign-in on the canonical hostname.

## Verify and release

- Configure the new provider, policy database, issuer, client, and original guest subject.
- Verify OIDC login, refresh, logout, password change, and device sign-in.
- Verify guest reads, guest write denial, private writes, and cross-user denial.
- Verify immediate policy revocation and restart persistence.
- Compare resource IDs and financial/social row counts with the backup.
- Verify disabled-user rejection and provider-outage responses.
- Verify persistence on the actual PostgreSQL or SQLite deployment target.
- Enroll and test physical passkeys separately.

Northflank release stays gated by `AUTH_CUTOVER_READY` until the operator prepares
the imported schema, service configuration, and policy database. Enable that
repository variable only after target verification.

## Rollback

Stop writers. Restore the original identity service, application backup, and
private configuration as one unit. Preserve the issuer. Verify owner and guest
isolation before writes resume.
