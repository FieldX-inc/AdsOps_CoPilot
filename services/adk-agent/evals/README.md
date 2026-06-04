# OpenAI Agent Eval Specs

Production eval specs for the OpenAI Agent Service live inside the service package at:

```txt
services/adk-agent/ad_ops_advisor/evals/
```

Keep the package-local specs focused on human-in-the-loop behavior, evidence requirements, no direct media-write tools, secret exclusion, OpenAI runtime orchestration, and answer quality. This top-level directory is only a pointer for tooling that expects an evals folder near the service root; reusable scenario files stay in the package path above unless a runner requires moving them.
