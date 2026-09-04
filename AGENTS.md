# Standing Instructions for All Agents

## Build and Compilation Verification (MANDATORY)
- Always verify that TypeScript compilation and Angular development build succeed with ZERO errors before declaring any task complete.
- Every agent must run:
  1. `npm run typecheck` (`npx tsc -p tsconfig.app.json --noEmit`)
  2. `npm run build`
- NEVER say you are done unless both `npm run typecheck` and `npm run build` exit with code 0 and 0 errors.
- Always kill/stop any background tasks or dev servers (`ng serve`) after verification is done so no lingering background tasks are left running.

## Git Commit (MANDATORY)
- Always stage and commit all changes to Git with a concise, descriptive commit message after verification passes before declaring done.
- In sandbox environments, use `GIT_CONFIG_GLOBAL=/dev/null git ...` to avoid gitconfig permission blocks.

