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
