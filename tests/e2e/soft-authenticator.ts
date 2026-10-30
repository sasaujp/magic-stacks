/**
 * Software WebAuthn authenticator for tests: P-256 keys, "none" attestation, real signatures.
 */
import { webcrypto as crypto } from "node:crypto";

const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const sha256 = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", b as Uint8Array<ArrayBuffer>));
const utf8 = (s: string) => new TextEncoder().encode(s);
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
};

// --- minimal CBOR encoder (maps, text, bytes, small ints) --------------------------
function cborHead(major: number, n: number): Uint8Array {
  if (n < 24) return Uint8Array.of((major << 5) | n);
  if (n < 256) return Uint8Array.of((major << 5) | 24, n);
  return Uint8Array.of((major << 5) | 25, n >> 8, n & 255);
}
function cbor(v: unknown): Uint8Array {
  if (typeof v === "number") return v >= 0 ? cborHead(0, v) : cborHead(1, -1 - v);
  if (typeof v === "string") return concat(cborHead(3, utf8(v).length), utf8(v));
  if (v instanceof Uint8Array) return concat(cborHead(2, v.length), v);
  if (v instanceof Map) return concat(cborHead(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)]));
  throw new Error("unsupported");
}

/** DER-encode a raw (r||s) P-256 signature as WebAuthn expects. */
function derSignature(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    let x = b.slice(i);
    if (x[0] & 0x80) x = concat(Uint8Array.of(0), x);
    return concat(Uint8Array.of(0x02, x.length), x);
  };
  const body = concat(int(raw.slice(0, 32)), int(raw.slice(32)));
  return concat(Uint8Array.of(0x30, body.length), body);
}

export class SoftAuthenticator {
  private keys!: CryptoKeyPair;
  credentialId = crypto.getRandomValues(new Uint8Array(16));
  counter = 0;
  userHandle = "";

  async register(options: { challenge: string; rp: { id: string }; user: { id: string } }, origin: string) {
    this.keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    this.userHandle = options.user.id;
    const jwk = await crypto.subtle.exportKey("jwk", this.keys.publicKey);
    const cose = cbor(
      new Map<number, unknown>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x!, "base64url")],
        [-3, Buffer.from(jwk.y!, "base64url")],
      ]),
    );
    const clientDataJSON = utf8(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin, crossOrigin: false }));
    const authData = concat(
      await sha256(utf8(options.rp.id)),
      Uint8Array.of(0x45), // UP | UV | AT
      Uint8Array.of(0, 0, 0, 0),
      new Uint8Array(16), // AAGUID
      Uint8Array.of(0, this.credentialId.length),
      this.credentialId,
      cose,
    );
    const attestationObject = cbor(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: "public-key",
      response: { clientDataJSON: b64url(clientDataJSON), attestationObject: b64url(attestationObject), transports: ["internal"] },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  async authenticate(options: { challenge: string; rpId: string }, origin: string) {
    this.counter++;
    const clientDataJSON = utf8(JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin, crossOrigin: false }));
    const authData = concat(await sha256(utf8(options.rpId)), Uint8Array.of(0x05), Uint8Array.of(0, 0, 0, this.counter));
    const raw = new Uint8Array(
      await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, this.keys.privateKey, concat(authData, await sha256(clientDataJSON)) as Uint8Array<ArrayBuffer>),
    );
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: "public-key",
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(derSignature(raw)),
        userHandle: this.userHandle,
      },
      clientExtensionResults: {},
    };
  }
}

