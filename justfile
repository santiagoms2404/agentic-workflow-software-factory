# Thin wrappers over the npm scripts — never a second truth.

plan:
    @echo "plan workflow not implemented yet (M5)"

build:
    @echo "build workflow not implemented yet (M5)"

sdlc:
    @echo "simple-sdlc workflow not implemented yet (M5)"

dash:
    npm --workspace dashboard run dev

doctor:
    @echo "doctor command not implemented yet (M1 cli)"

rebuild:
    node --experimental-strip-types core/src/observability/rebuild.ts
