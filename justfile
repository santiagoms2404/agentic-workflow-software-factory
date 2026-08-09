# Thin wrappers over root package scripts — never a second source of truth.

test:
    npm test

unit:
    npm run test:unit

contract:
    npm run test:contract

sim:
    npm run test:sim

journeys:
    npm run test:journeys

lint:
    npm run lint

typecheck:
    npm run typecheck

dash:
    npm run dash

dash-build:
    npm run dash:build

awsf *args:
    npm run awsf -- {{args}}
