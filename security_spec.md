# Security Specification — StreamGrid DE Firestore Rules

## 1. Data Invariants
1. **Zero-Trust Owner Isolation**: Every document under `/users/{userId}` and its subcollections (`channels`, `playlists`, `ipProfiles`, `chatMessages`, `streamSources`) is strictly owned by `userId == request.auth.uid`, validated against `resource.data.ownerId == userId` on `get`, and requires a verified email (`request.auth.token.email_verified == true`). Cross-user access, user enumeration (`list /users`), and anonymous writes are denied.
2. **Master Gate Integrity**: Subcollection `create` and `update` operations (`channels`, `playlists`, `ipProfiles`, `chatMessages`, `streamSources`) evaluate `exists(/databases/$(database)/documents/users/$(userId))` after static schema validation so orphaned sub-records cannot be created and static attacks fail before incurring DB read costs.
3. **Path & Array ID Hardening**: All document IDs (`userId`, `channelId`, `playlistId`, `profileId`, `messageId`, `sourceId`, `targetPlaylistId`) and boundary elements (`[0]` and `[size - 1]`) of bounded `channelIds` arrays (`<= 200` for playlists, `<= 50` for AI suggestions) must satisfy `isValidId(id)` (`^[a-zA-Z0-9_-]+$`, `1..128` chars).
4. **Temporal Integrity & Immutability**: All `createdAt` fields must equal `request.time` on creation and remain immutable on update; `updatedAt` must equal `request.time` on both create and update. `uid` and `ownerId` are immutable after creation.
5. **Anti-Update-Gap & No Shadow Keys**: `create` enforces exact `hasAll` + `hasOnly`; `update` enforces `affectedKeys().hasOnly(...)` combined with the full `isValid*` schema check.
6. **Strict Value, URL & M3U-Injection Validation**:
   - Providers allowlist: `['sky', 'netflix', 'amazon', 'disney', 'public_de', 'private_de', 'at_ch', 'custom']`.
   - IPv4 addresses (`ip`, `baseIp`, `defaultIp`) enforce strict `0..255` octet boundaries (`^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$`).
   - Ports (`port`, `startPort`) must be integers in `1..65535`; `intervalMinutes` in `1..1440`; sync counters in `0..100000`.
   - `upstreamUrl` (when non-empty), `sources[].uri`, and external `streamSources.url` must match `^https?://[^\\s\\r\\n]+$` (blocking `javascript:`, `file://`, `data:`, spaces, and `\r`/`\n` M3U header injection).
   - Built-in feed URLs in `streamSources.url` must match `^/api/feeds/[a-zA-Z0-9_-]+(\\.[a-zA-Z0-9]+)?$` and reject `..` path traversal.
   - Channel `path` must be empty (for UDP/RTP) or start with `/` without whitespace or newlines (`^/[^\\s\\r\\n]*$`).
   - M3U-exported string fields (`channel.name`, `channel.category`, `channel.language`, `channel.tvgId`, `playlist.name`, `streamSource.name`, `streamSource.targetPlaylistName`) disallow `\r`/`\n` line breaks.
   - All strings and arrays enforce strict `.size()` bounds.

## 2. The "Dirty Dozen" Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated read**: `get /users/u1/channels/ch1` with `auth == null`.
2. **User enumeration**: `list /users` even when authenticated.
3. **Cross-user read/list**: `list /users/u2/channels` or `get /users/u2/streamSources/src1` authenticated as `u1`.
4. **Unverified email write**: `create /users/u1/channels/ch1` with `email_verified: false`.
5. **Identity spoofing**: `create /users/u1/channels/ch1` or `streamSources/s1` with `ownerId: "u2"` while authenticated as `u1`.
6. **Shadow/ghost field injection**: `create /users/u1/channels/ch1` with extra key `isAdmin: true`.
7. **Oversized or invalid document ID**: `create /users/u1/channels/${"a".repeat(200)}` or `../evil`.
8. **Invalid IPv4 octet or out-of-range port**: `ip: "999.999.999.999"` or `port: 70000`.
9. **Malicious URI scheme / M3U newline injection**: `upstreamUrl: "javascript:alert(1)"`, `upstreamUrl: "https://evil.test/x\n#EXTINF:-1,Fake"`, or `streamSources.url: "/api/feeds/../secret"`.
10. **Array tail poisoning**: `create /users/u1/playlists/pl1` with `channelIds: ["valid-id", "../evil"]`.
11. **Client-forged timestamp or immutable mutation**: `create /users/u1/playlists/pl1` with `createdAt != request.time` or `update` modifying `ownerId` / `createdAt`.
12. **Chat history tampering**: `update /users/u1/chatMessages/m1` attempting to rewrite historical messages.
