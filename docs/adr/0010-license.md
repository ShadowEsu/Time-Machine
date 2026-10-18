# ADR 0010: License

Date: 17 October 2026. Status: accepted (founder decision, relayed by BOSS).

## Decision

- The repository, the `tm` CLI (npm name `timetm`), the core engine and the Mac app source are under the **MIT License**. See `LICENSE`.
- Every `package.json` says `"license": "MIT"`.
- The npm package is still not published. The founder creates the npm account with 2FA and publishes. Agents never publish.

## Alternatives

- **Apache 2.0:** adds an explicit patent grant and a NOTICE file. More text for users and contributors to read. Not needed for a solo project today.
- **Source available or proprietary:** would block the free CLI and the open test suite that the site uses as proof.

## Cost

- Anyone can fork and sell the code. The business depends on the Mac app experience, signing, updates and support, not on hiding the engine.

## Migration path

- A later relicense needs consent from every contributor. Keep contributions small and recorded until a CLA or DCO decision is made.
