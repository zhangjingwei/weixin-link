# Personal multi-entry release acceptance

Automated tests verify simulated behavior. Do not mark the following checks
passed without a dedicated real account, explicit testing authorization, and
recorded platform, revision, outcome and redacted diagnostic trace.

| Scenario | Acceptance evidence |
| --- | --- |
| Fresh install and QR pairing | A real request and reply complete; channel readiness and inference readiness reported separately. |
| Disconnect/reconnect | Resume after network restoration without replaying an uncertain model submission or message send. |
| Sleep/wake and OS reboot | Service returns after login/startup; original task reconciles rather than resubmits. |
| Login expiry | Report authentication failure and official recovery path without claiming the model is ready. |
| Two WeChat accounts on one host | Two foreground submissions serialize; replies return to their original recipients. |
| Stop a waiting entry | Waiting task does not start, other account continues. |
| Crash during execution | Reservation persists; other entry does not start until original execution is reconciled. |
| Crash after completion | Owner account startup clears reservation only when original durable job is done. |
| Explicit project directory | New project uses chosen canonical directory before and after reconnect; existing thread never migrates silently. |
| Missing or mixed deliverables | Preparation warning remains visible and delivery is partial, never accepted for the complete bundle. |
| Upgrade and rollback | All host accounts use compatible gate-aware version; preserve state; reconcile unknown tasks before switching versions. |
| Claude readiness | CLI, supported credentials, real inference, resume and stop each checked separately; simulated adapter tests are insufficient. |

Windows and Linux real-machine validation, real WeChat delivery, network changes,
OS reboot, and credential-expiry checks are not performed by the unit suite.
This gate does not coordinate external CLI processes or detached background work.
