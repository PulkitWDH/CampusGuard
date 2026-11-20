# CampusGuard CCTV Security Specification (`security_spec.md`)

## 1. Data Invariants
1. **Owner-Only Profile & PII Isolation**: A `UserProfile` document at `/users/{userId}` can only be read, created, or updated by the verified Google-authenticated user whose `request.auth.uid == userId`.
2. **Master Gate Containment**: A `MonitoredZone` (`/users/{userId}/zones/{zoneId}`) or `SafetyIncident` (`/users/{userId}/incidents/{incidentId}`) cannot be created or modified unless the parent `/users/{userId}` document exists and belongs to `request.auth.uid`.
3. **Immutable Ownership & Temporal Integrity**: `uid`, `ownerUid`, `id`, and `createdAt` are immutable after creation; `createdAt == request.time` on create and `updatedAt == request.time` on update.
4. **No Shadow Fields or Oversized Strings**: Every key is allowlisted via `hasAll` + `hasOnly` and `affectedKeys().hasOnly(...)`; every string enforces `.size()` bounds.

## 2. Dirty Dozen Adversarial Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated Write**: Writing `/users/userA` with `request.auth == null`.
2. **Unverified Email Spoof**: Writing `/users/userA` with `email_verified: false`.
3. **Cross-Tenant Read**: User B (`uid: userB`) calling `get` on `/users/userA`.
4. **Cross-Tenant List Scraping**: User B calling `list` on `/users/userA/incidents`.
5. **Identity Spoofing on Create**: User B creating `/users/userB/zones/z1` with `ownerUid: "userA"`.
6. **Shadow Field Injection**: Creating `/users/userA` with an extra key `"isAdmin": true`.
7. **ID Poisoning**: Creating `/users/userA/zones/bad..id$123` violating `^[a-zA-Z0-9_\-]+$`.
8. **Orphaned Subcollection Write**: Creating `/users/userA/zones/z1` before `/users/userA` exists.
9. **Client Timestamp Tampering**: Creating `/users/userA/incidents/i1` with `createdAt` in the past instead of `request.time`.
10. **Immutable Field Mutation**: Updating `ownerUid` or `createdAt` on an existing `SafetyIncident`.
11. **Value Type / Size Poisoning**: Updating `headline` on a `SafetyIncident` to a 5,000-character string.
12. **Blanket Catch-All Probe**: Reading or writing `/admin/config` or `/unprotected/doc`.
