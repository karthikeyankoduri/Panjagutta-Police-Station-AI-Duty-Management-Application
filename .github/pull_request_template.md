## What changed

<!-- One or two sentences. -->

## Web and Android stay in step

The Android app must match the web app (see `docs/feature-parity.md`). Tick what applies:

- [ ] This change touches **no** user-facing behaviour (refactor, docs, tests only)
- [ ] **Web** changed → **Android** changed in this PR (screen, `RoleAccess`, or both)
- [ ] **Android** changed → **Web** changed in this PR, or the difference is listed as 🔶 in `docs/feature-parity.md` with a reason
- [ ] Who-sees-what changed → `frontend/src/lib/access-matrix.json` updated, and `RoleAccessTest` and `tests/test_access_matrix.py` pass
- [ ] Endpoint added/removed/re-roled → `UPDATE_CONTRACT=1 pytest tests/test_api_contract.py` run and the snapshot diff committed
- [ ] `docs/feature-parity.md` updated (new feature row, status)
- [ ] Checked on a phone for each role touched (checklist at the bottom of `docs/feature-parity.md`), or noted below why not

## Notes for the reviewer
