#!/usr/bin/env node
// Creates or updates the monitors of infra/hyperping/moniteurs.json in Hyperping, by their own identifier (external_id):
// run as often as needed, never a duplicate. Run by the firm (infra/hyperping/legarec-hyperping asks the key without
// showing it); never by Claude Code. The key is read from HYPERPING_API_KEY, never written nor printed.
//   node infra/hyperping/provisionner.mjs --essai   shows what would be sent, without a key nor a call
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.hyperping.io/v1/monitors/external/';
const here = dirname(fileURLToPath(import.meta.url));
const { defaults, monitors } = JSON.parse(readFileSync(join(here, 'moniteurs.json'), 'utf8'));
const trial = process.argv.includes('--essai');
const key = process.env.HYPERPING_API_KEY?.trim() ?? '';

if (!trial && !/^\S{16,}$/u.test(key)) {
  console.error('Clé API Hyperping absente : lancez infra/hyperping/legarec-hyperping, qui la demande sans l’afficher.');
  process.exit(2);
}

const WHY = {
  401: 'clé refusée (absente, erronée ou expirée)',
  403: 'clé en lecture seule, ou API non comprise dans l’offre Hyperping',
  409: 'conflit passager : relancez le script',
  422: 'réglage refusé par Hyperping',
  429: 'trop de requêtes : relancez plus tard',
};

let failed = 0;
for (const { external_id: id, ...own } of monitors) {
  const body = { ...defaults, ...own, external_id: id };
  if (trial) {
    console.log(`PUT ${API}${id}\n${JSON.stringify(body, null, 2)}\n`);
    continue;
  }
  const answer = await globalThis.fetch(`${API}${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (answer.status === 201 || answer.status === 200) {
    console.log(`${answer.status === 201 ? 'Créé' : 'Mis à jour'} : ${body.name} (${body.url})`);
    continue;
  }
  failed += 1;
  // Only the message of Hyperping, never the request: it carries the key.
  const detail = await answer.text().catch(() => '');
  console.error(`Échec ${answer.status} pour ${body.name} : ${WHY[answer.status] ?? 'réponse inattendue'}${detail ? ` — ${detail.slice(0, 300)}` : ''}`);
  if (answer.status === 401 || answer.status === 403) break;
}
process.exit(failed ? 1 : 0);
