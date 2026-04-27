# ADK Eval Specs

ADK eval specs currently live inside the service package at:

```txt
services/adk-agent/ad_ops_advisor/evals/
```

Keep the package-local specs focused on human-in-the-loop behavior, evidence requirements, no media writes, secret exclusion, and answer quality. If a future ADK runner expects a top-level `services/adk-agent/evals/` directory, add runner config here and keep reusable scenario files in the package path above unless the runtime requires moving them.
