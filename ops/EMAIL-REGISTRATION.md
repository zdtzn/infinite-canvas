# Email Registration

Registration requires an initialized site, SQLite, `ALLOW_NEW_USERS=1`, available
capacity under `MAX_REGISTERED_USERS` (default 20), and these server environment
variables:

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-address@gmail.com
SMTP_PASSWORD=your-google-app-password
SMTP_FROM=your-address@gmail.com
```

Set these privately on the server/container, never in frontend config or Git.
For Gmail, enable two-step verification and create an app password. Port 587
requires STARTTLS; port 465 uses TLS. Certificate verification remains enabled.
Restart the application after changing its environment. Ensure the container
configuration forwards these variables; an environment file alone is not enough.

The login page exposes email registration only when the server is configured.
Users request a six-digit code, then submit email, code, username and password.
Registration creates a normal account and a session, never an administrator.
The existing nickname is the username; existing account IDs and data stay intact.
Existing password accounts use username and password. Passwordless legacy
accounts are no longer accepted; they must be recreated through email
registration. The old login endpoint cannot create accounts anymore.

Codes expire after ten minutes, permit at most five verification attempts, and
are stored as keyed hashes in SQLite. Sending is limited to one per address per
minute, six per address per day, twenty per IP per day and two hundred globally
per day. Send failures also consume the budget. Email binding and code consumption
are committed together with account creation. Disabled/banned accounts stay blocked.

Verify before enabling public registration: send to a real test mailbox, complete
registration, log out, log in by username/password, and confirm the account is not
an admin. SMTP delivery needs a reachable SMTP service; mock tests do not prove
deliverability. Password recovery and legacy-account email binding are not part
of this registration change.
