import { isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers';
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest();
const b64 = (data: Uint8Array) => isoBase64URL.fromBuffer(new Uint8Array(data));

/** A security key, in software: what a browser would send for it. */
export class Authenticator {
  readonly id = randomBytes(32);
  counter = 0;
  private readonly key: KeyObject;
  private readonly cose: Uint8Array;

  constructor(
    private readonly origin: string,
    private readonly site = new URL(origin).hostname,
  ) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.key = privateKey;
    const { x = '', y = '' } = publicKey.export({ format: 'jwk' });
    // EC2, ES256, P-256.
    this.cose = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, new Uint8Array(Buffer.from(x, 'base64url'))],
        [-3, new Uint8Array(Buffer.from(y, 'base64url'))],
      ]),
    );
  }

  private data(flags: number, attested: Uint8Array = new Uint8Array()) {
    this.counter += 1;
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter);
    return Buffer.concat([sha256(this.site), Buffer.from([flags]), counter, attested]);
  }
  private client(type: string, challenge: string) {
    return Buffer.from(JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false }));
  }

  register(challenge: string) {
    const length = Buffer.alloc(2);
    length.writeUInt16BE(this.id.length);
    // Person present, credential attached.
    const authData = this.data(0x41, Buffer.concat([Buffer.alloc(16), length, this.id, this.cose]));
    const attestationObject = isoCBOR.encode(
      new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', new Uint8Array(authData)],
      ]) as never,
    );
    return {
      id: b64(this.id),
      rawId: b64(this.id),
      type: 'public-key',
      clientExtensionResults: {},
      response: { clientDataJSON: b64(this.client('webauthn.create', challenge)), attestationObject: b64(attestationObject), transports: ['usb'] },
    };
  }

  authenticate(challenge: string) {
    const authenticatorData = this.data(0x01);
    const clientDataJSON = this.client('webauthn.get', challenge);
    return {
      id: b64(this.id),
      rawId: b64(this.id),
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64(clientDataJSON),
        authenticatorData: b64(authenticatorData),
        signature: b64(sign('sha256', Buffer.concat([authenticatorData, sha256(clientDataJSON)]), this.key)),
      },
    };
  }
}
