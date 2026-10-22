#!/usr/bin/env node
// Prints a fresh Ed25519 keypair for signing web app license keys. Writes nothing to disk.
// Run it once. Keep the private key off the repository: it goes into the Vercel setting
// TM_LICENSE_PRIVATE_KEY and into the founder's private notes only.
import { generateKeyPairSync } from "node:crypto";

// Node exports keys as DER. The raw 32 key bytes are the last 32 bytes of each export, after the
// fixed SPKI (public) or PKCS8 (private) header. Core's license.ts puts the same headers back.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const pub = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64url");
const priv = privateKey.export({ type: "pkcs8", format: "der" }).subarray(-32).toString("base64url");

process.stdout.write(`Public key (32 bytes, base64url):  ${pub}
Private key (32 bytes, base64url): ${priv}

1. Put the public key in LICENSE_PUBLIC_KEY in packages/core/src/license.ts and commit it.
2. Put the private key in the Vercel setting TM_LICENSE_PRIVATE_KEY on the time-machine-site project.
3. Save the private key in .private/LICENSE_SIGNING_KEY.md on your own computer. Never commit it or paste it in chat.
4. Keys signed before a key change stop verifying, so change the public key only when the private key leaked.
`);
