# Core Architecture

`core/` defines application contracts and orchestration rules. It must not depend on concrete media engines, UI frameworks, or external repositories.

## Rules

- Core owns interfaces, lifecycle contracts, app events, data contracts, and policy.
- Core does not import plugin implementations.
- Plugins register through explicit manifests.
- Services coordinate work through interfaces, not direct dependency calls.
- Every feature should be replaceable without rewriting the application.

