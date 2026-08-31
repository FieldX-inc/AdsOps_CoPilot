# Evidence storage

Store one evidence document at:

```txt
harness/evidence/<issue-number>/<commit-sha>/evidence.json
```

Validate it against `harness/schemas/evidence.schema.json`. Large Playwright
traces, videos, and provider exports should be referenced by a redacted artifact
path or immutable CI URL instead of committed directly. Evidence must not
contain secrets, tokens, raw customer lists, or full authenticated payloads.
