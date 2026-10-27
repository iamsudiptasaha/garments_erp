# Garment production portal

Fabric-first pilot for the existing `garments_erp` database. The current runnable application lives in [fabric-poc](fabric-poc/). It includes library comparisons while the protected spreadsheet workflow is validated.

## Start locally

Use Node 22 (22.13 or later) and npm. From `fabric-poc/`:

```sh
npm ci
npm run quality
npm run dev
```

The development server runs at `http://127.0.0.1:8766`. The Fabric workspace is `/` or `/fabric.html`; the earlier FortuneSheet trial remains at `/fortune.html`. `npm run build` creates `dist/`; `npm start` serves that build on port 8765 using Python 3.

No credentials are needed for the local sample. Browser storage is a prototype convenience, not a production data store or authenticated account.

## Repository

Local Git uses branch `main` and origin `https://github.com/iamsudiptasaha/garments_erp.git`, an existing private repository. Setup does not imply that any local files have been committed or pushed. The remote initial commit was fetched and local `main` tracks it, preserving all working files. No force-push is needed.

GitHub Actions will run installation, tests and the production build after these files are pushed. It does not deploy or change the database.

## Project boundaries

- [Raw Material Inventory pilot](docs/raw-material-inventory.md)
- [Administration and RBAC preview](docs/admin-rbac.md)
- [Fabric implementation and data mapping](docs/fabric-data-map.md)
- [Code quality and sanity checks](docs/code-quality.md)
- [Architecture and decisions](docs/architecture.md)
- [Setup and delivery](docs/setup.md)
- [Existing prototype details](fabric-poc/README.md)

The spreadsheet library remains replaceable. Business records, validation, saved presentation preferences and the renderer should stay separate as the remaining modules are added.
