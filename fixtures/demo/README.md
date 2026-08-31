# Demo fixture source

This directory is the canonical, synthetic-only source for Issue #2. The
manifest fixes the clock, workspace identity, state order, and scenario files.
`npm run demo:reset` composes these files into
`harness/evidence/demo/current.json` without contacting a database, network, or
advertising provider.

Do not add copied customer payloads, real company names, numeric provider
customer IDs, personal contact details, or authentication material. Run
`npm run check:demo-fixture` after every fixture change.
