**Dispatch throughput — "how fast do we hand mail to the ESP?"
(deliberately none in v1).** Each team brings its own SMTP config, so
there is no shared upstream to protect. ESP-side throttling surfaces as
transient SMTP errors, absorbed by the transactional path's
`attempts`/backoff. A per-team BullMQ limiter is impractical (group rate
limits are BullMQ Pro), and a global `limiter` on the shared `mail` worker
would let one team's broadcast fan-out starve another team's password
resets — cross-team fairness is handled by job `priority` instead.
