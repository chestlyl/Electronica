# @ee/worker

Background worker application for the Engagement Engine. Handles synchronization jobs, imports, exports, messaging, statements, and webhooks.

## Layer 1

Provides a job registry abstraction, structured logging, and a health-check demonstration job.

Future jobs will be scheduled via cron or triggered by events.
