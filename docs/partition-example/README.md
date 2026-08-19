# The §2.4 example, runnable

The gate of [PARTITION-FOUNDATIONS.md](../PARTITION-FOUNDATIONS.md) requires the
two-feature example to *compile against the proposed API shape, even if the API
is stubbed*. This folder is that proof, executable on stock Ring:

```bash
ring orders.ring
```

| file | role |
|---|---|
| `orders.ring` | the world author's code — *place an order*, *mark it ready* — plus the §5 scenario as assertions |
| `stub.ring` | the proposed v2 surface, stubbed: `PwaRung`/`PwaRungSet` (new), `PwaOutboxAdd`/`PwaOutboxPending` (v1 shape, `ringscript-pwa/ring/pwa.ring`) |

Output on `D:\ring127\bin\ring.exe`, 2026-08-19:

```
  [ok] cash order accepted while unreachable (P1)
  [ok] card order refused by rule while unreachable (P4)
  [ok] empty order refused with a sentence, not a freeze (Law 5)
  [ok] ready transition accepted while unreachable (Law 6 inverted)
  [ok] re-pressing ready is idempotent, no rollback
  [ok] both decisions queued durably, nothing sent, nothing lost (Law 1)
  [ok] card order accepted once streaming

  7 / 7 assertions hold.
```

Two properties worth seeing in the code rather than the claims:

- **Neither feature contains a network call, a retry, or an `onLine` check.**
  The world decides and queues; delivery is the library's problem, whenever
  delivery is possible. The default path is the partition-tolerant path.
- **The rung is consulted in Ring, not in UI glue** — the card-payment refusal
  (P4: payment is never optimistic) is a business rule, and business rules live
  in the Ring half. That is the design reason v2 pushes the rung into the VM.
