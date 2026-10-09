# Remembered gateway connection

Run `npm start` as before. On the connection form, check **Remember this gateway on this computer**, then connect using your token or physical pairing. An existing connection is not saved retroactively: reconnect once with this checkbox selected.

Only after the gateway accepts the credential is it saved. Restarting the server tries the saved gateway once, without pairing or sending device commands. If it is offline or rejects the token, the page shows an error and offers **Reconnect saved gateway**. There is no continuous reconnect loop yet.

- **Disconnect for now** clears the active session but keeps the saved credential. Restarting the server reconnects it.
- **Disconnect & forget credentials** clears the session and replaces the saved record with an encrypted empty record. It does not revoke the gateway account or erase copies in backups.
- Connecting without the checkbox creates a temporary session and, after successful authentication, forgets a previous saved connection.

## Storage and security boundary

Both the address and token are encrypted together with AES-256-GCM in `data/credentials/gateway.json`. A separate randomly generated 256-bit key is stored at `data/credentials/key`. Each write uses a fresh nonce and an atomic file replacement. On Linux, the directory is owner-only (0700) and files are owner read/write (0600). Wrong ownership, loose permissions, symbolic links, malformed ciphertext, or a missing key fail closed. No credentials are stored in SQLite, browser storage, mapping exports, or Git.

`WISER_CREDENTIAL_DIR` selects an alternative directory; its parent must already exist. This setting is independent of `WISER_DB_PATH`. Use a private local filesystem and only one app process per credential directory. Do not place these files in a shared or world-writable parent directory. Custom directory locations must also be excluded from Git and public backups.

The key is on the same computer: **this is not protection against your own account, root, malware running as you, or theft of both files**. Encryption protects a separately copied ciphertext file, and SQLite-only backups do not contain credentials. Use full-disk encryption and a dedicated service user for stronger host protection. The ownership/permission enforcement is POSIX-specific; Windows ACL hardening is not provided by this implementation.

The app remains localhost-only and unauthenticated for browser access. Local software can control an active gateway session; encryption at rest does not change that. Gateway HTTP also remains unencrypted on the trusted LAN.

## Recovery

If startup cannot unlock the store, do not generate a new key over existing ciphertext. Restore the matching key and record together with their original ownership and restrictive permissions. If they cannot be recovered, keep the old directory separately and select a fresh private `WISER_CREDENTIAL_DIR`, then connect again with a valid token. Never paste keys, tokens, or decrypted records into logs or issue reports.

Forgetting uses an encrypted empty record, not a secure disk wipe. Filesystem snapshots, backups, failed-write temporary files, or previously running processes may retain a copy. Revoke the gateway account separately if the credential may have been compromised.
