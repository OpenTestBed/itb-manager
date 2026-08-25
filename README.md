# ITB Test Manager

Management UI for the [Interoperability Test Bed](https://www.itb.ec.europa.eu/). Import test cases from FHIR Implementation Guides, manage specifications and test suites, deploy to ITB, and run tests.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3001

## Prerequisites

- [itb-starter](https://github.com/HealthOpenSpace/itb-starter) running (`docker compose up`)
- Node.js 18+

## Features

- **Dashboard** with ITB overview (domains, specifications, test suites)
- **Sidebar tree** mirroring the ITB hierarchy — domains, specifications, actors, test suites
- **Import IG** — upload a FHIR IG package, select test plans, compile, deploy to ITB
  - Supports Gherkin-based test plans (compiled to GITB TDL)
  - Supports pre-built ITB test suite ZIPs (deployed directly)
- **Specifications** — drill-down view: domains → specs → test suites → actors
- **Organizations** — manage testing organizations
- **Services & Plugins** — detect running Docker services, show health status, provide docker-compose snippets for missing services
- **ITB Settings** — configure connection (URL, API keys, specification ID)
- **Run in ITB** — after deploy, one-click link to the ITB test execution page

## Architecture

Single JS/TS application — no separate backend:

- **Frontend**: React 18 + TypeScript + Tailwind CSS
- **Backend**: Vite dev server middleware plugins
- **ITB integration**: REST API via CORS proxy, MySQL queries via `docker exec` for ID resolution
- **Plugin catalog**: YAML file listing available services with health checks and docker-compose snippets

## Ecosystem

| Repo | Purpose |
|------|---------|
| [itb-starter](https://github.com/HealthOpenSpace/itb-starter) | Bare ITB docker-compose |
| [itb-plugins](https://github.com/HealthOpenSpace/itb-plugins) | Plugin catalog + docker-compose recipes |
| **itb-test-manager** (this repo) | Management UI |
| [test-workbench](https://github.com/HealthOpenSpace/test-workbench) | Test authoring (Gherkin editor) |

## Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_ITB_BASE_URL` | `http://localhost:10003` | ITB URL |
| `VITE_ITB_COMMUNITY_API_KEY` | | Community API key for deployment |
| `VITE_ITB_ORGANISATION_API_KEY` | | Organisation API key for test execution |
| `VITE_ITB_SPECIFICATION_ID` | | Default specification ID |
| `ITB_MYSQL_CONTAINER` | `itb-gitb-mysql-1` | Docker container name for ITB MySQL |
| `ITB_MOCK` | unset | Set to `1` to run against an in-memory mock instead of a real ITB |
| `ITB_MOCK_FIXTURE` | `mock/itb-default.yml` | Override the mock fixture file path |

## Mock mode (no real ITB needed)

For development without docker / a running ITB, set `ITB_MOCK=1`:

```bash
ITB_MOCK=1 npm run dev
```

This loads [`mock/itb-default.yml`](mock/itb-default.yml) into an in-memory SQLite (sql.js) and routes both `dbQuery()` and `itbFetch()` through it. The header shows a purple **"Mock mode"** indicator instead of *Connected* / *Disconnected*.

What works in mock:

- Listing domains, specs, actors, communities, organizations, systems
- Vendor self-registration (`/#/register`) — creating an org + system + conformance writes to the in-memory DB
- The conformance matrix
- The Matches page (with sample P2P data — see `p2p-exchange` spec in the fixture)
- Per-vendor deep-link **Copy** and **Send via email**

What does **not** work:

- **Open in ITB** / **Run in ITB** — the URLs point at `mock-itb.local` which has no server behind it (intentional)
- IG import deploy (the ZIP isn't actually deployed anywhere)

State persistence:

- Mutations are persisted to `~/.itb-test-manager/mock-runtime.json` so they survive dev-server restarts
- To reset to the seed fixture: `rm ~/.itb-test-manager/mock-runtime.json`
- To use a different seed: `ITB_MOCK=1 ITB_MOCK_FIXTURE=path/to/your.yml npm run dev`
