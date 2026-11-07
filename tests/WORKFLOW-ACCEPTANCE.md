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
| Two WeChat accounts on one host | Two submissions can run concurrently in the same host directory; replies return to their original recipients. |
| Same conversation queue | The second ordinary task starts only after the first finishes. |
| Stop one conversation | Its queued tasks do not start; another conversation continues unaffected. |
| Crash during execution | Original task remains recoverable without automatic resubmission; independent entries are not globally blocked. |
| Explicit project directory | New project uses chosen canonical directory before and after reconnect; existing thread never migrates silently. |
| Missing or mixed deliverables | Preparation warning remains visible and delivery is partial, never accepted for the complete bundle. |
| Upgrade and rollback | Preserve account state; reconcile unknown tasks before switching versions. |
| Claude readiness | CLI, supported credentials, real inference, resume and stop each checked separately; simulated adapter tests are insufficient. |

Windows and Linux real-machine validation, real WeChat delivery, network changes,
OS reboot, and credential-expiry checks are not performed by the unit suite.
Host filesystem sharing is intentional; separate conversations do not isolate files.
Validate isolated backend mounts and OS permissions separately when isolation is required.
