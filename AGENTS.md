# Standing Instructions for All Agents

## Build and Compilation Verification (MANDATORY)
- Always verify that the Angular build, TypeScript compilation, and development server bundle generation succeed with ZERO errors before declaring any task complete.
- Every agent must run `npm run build` and `npx tsc --noEmit` before concluding work.
- NEVER say you are done unless compilation and build succeed with exit code 0 and 0 errors.
