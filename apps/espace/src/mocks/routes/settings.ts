import {
  newMailbox,
  canAccessTechnicalSettings,
  firmGroups,
  hasDelegation,
  isFirmIdentity,
  INTERNAL_SECRETS,
  SERVICE_SECRETS,
  type ServiceSecret,
  type GdprRequest,
  type Mailbox,
  type SecretItem,
  type Session,
  type SettingsHub,
  settingProblems,
  technicalGroups,
} from '@legarec/contracts';
import { http, HttpResponse } from 'msw';
import { audit, auditEntries, resetAudit } from '../audit';
import { done, forbidden, guarded, notFound } from '../http';
import { closeMailboxRequest, mailboxRequests, resetMailboxRequests } from '../mailboxRequests';
import { asInMockup } from '../settingsDemo';
import { administers } from './steering';

type Info = { request: Request; params: Record<string, unknown> };
const staff = (session: Session) => session.role !== 'CREDITOR';

const seedGroups = () => ({ firm: asInMockup(firmGroups()), technical: asInMockup(technicalGroups()) });
let groups = seedGroups();
const SCOPES: Record<string, 'firm' | 'technical'> = { firm: 'firm', techniques: 'technical' };
const scopeOf = (value: unknown) => SCOPES[String(value)] ?? null;
const canRead = (scope: 'firm' | 'technical', session: Session) => (scope === 'technical' ? canAccessTechnicalSettings(session) : staff(session));
const canEdit = (scope: 'firm' | 'technical', session: Session) =>
  scope === 'technical' ? session.role === 'DIRECTOR' || hasDelegation(session, 'TECHNICAL') : administers(session);
const seesMembers = (session: Session) => session.role !== 'CLAIMS_OFFICER';
/** The GDPR registry names debtors: no access for the Developer, nor beyond one's duty for officers. */
const keepsRegistry = (session: Session) => administers(session);

const seedSecrets = (): SecretItem[] =>
  (
    [
      ['k-resend', 'RESEND_API_KEY', 'Resend', 'il y a 2 min', '02/10/2026', 'VALID'],
      ['k-box', 'MAILBOX_SECRETS_KEY', 'Boîtes OVH (chiffrement des mots de passe)', 'il y a 1 min', '24/08/2026', 'EXPIRING'],
      ['k-ovh', 'OVH_API_APP_SECRET', 'API OVHcloud (boîtes e-mail)', 'il y a 1 h', '24/08/2026', 'VALID'],
      ['k-msb', 'MYSENDINGBOX_API_KEY', 'MySendingBox (lettres recommandées)', 'il y a 4 min', '15/09/2026', 'VALID'],
      ['k-s3', 'SCW_SECRET_KEY', 'Scaleway Object Storage (fichiers)', 'il y a 3 min', '15/09/2026', 'VALID'],
      ['k-sms', 'OVH_SMS_APP_SECRET', 'OVHcloud SMS', 'il y a 14 min', '30/09/2026', 'VALID'],
      ['k-3cx', 'TCX_API_CLIENT_SECRET', '3CX (API Call Control)', 'en continu', '01/09/2026', 'EXPIRING'],
      ['k-access', 'ACCESS_CODE_KEY', INTERNAL_SECRETS.ACCESS_CODE_KEY, 'en continu', '06/11/2026', 'VALID'],
    ] as const
  ).map(([id, name, service, used, rotated, status]) => ({
    id,
    name,
    internal: name in INTERNAL_SECRETS,
    service,
    environment: 'Production',
    used,
    rotated,
    status,
  }));
let secrets = seedSecrets();
/** How many times a section was saved. */
let versions: Record<string, number> = {};

const box = (id: string, local: string, holder: string | null, kind: Mailbox['kind'], usedMb: number, connection: Mailbox['connection'] = 'OK'): Mailbox => ({
  id,
  address: `${local}@legarec.fr`,
  holder,
  kind,
  usedMb,
  sizeMb: 5000,
  connection,
  protected: kind === 'SHARED',
  redirections: [],
  autoReply: null,
});
const seedBoxes = (): Mailbox[] => [
  box('b1', 'recouvrement', null, 'SHARED', 2140),
  box('b2', 'cl', 'Camille Laurent', 'MEMBER', 1280),
  box('b3', 'tg', 'Thomas Giraud', 'MEMBER', 910),
  box('b4', 'hb', 'Hugo Benali', 'MEMBER', 640, 'PASSWORD_NEEDED'),
  box('b5', 'sm', 'Sarah Morel', 'MEMBER', 720),
  box('b6', 'administratif', null, 'FUNCTION', 330),
];
let boxes = seedBoxes();
let boxHistory: { id: string; when: string; who: string; onBehalfOf: string | null; what: string }[] = [];
const logBox = (session: Session, what: string) => {
  audit(session, what, 'TECHNICAL');
  boxHistory = [
    {
      id: `h${boxHistory.length + 1}`,
      when: 'À l’instant',
      who: `${session.firstName} ${session.lastName}`,
      onBehalfOf: session.role === 'DIRECTOR' ? null : session.directorName,
      what,
    },
    ...boxHistory,
  ];
};
/** Fictitious password, drawn at random for each call like the API would do. */
const drawPassword = () =>
  [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'[byte % 56]).join('');

const seedRegistry = (): GdprRequest[] => [
  {
    id: 'g1',
    receivedOn: '2026-11-03',
    dueOn: '2026-12-03',
    daysLeft: 9,
    kind: 'ACCESS',
    debtor: 'Paul Meunier',
    caseId: 'meunier',
    origin: 'E-mail du débiteur',
    status: 'OPEN',
  },
  {
    id: 'g2',
    receivedOn: '2026-11-17',
    dueOn: '2026-12-17',
    daysLeft: 23,
    kind: 'RECTIFICATION',
    debtor: 'Atelier Mistral',
    caseId: 'demo',
    origin: 'Courrier',
    status: 'OPEN',
  },
];
let registry = seedRegistry();
export const addGdprRequest = (item: Pick<GdprRequest, 'kind' | 'debtor' | 'caseId' | 'origin'>) => {
  registry = [...registry, { ...item, id: `g${registry.length + 1}`, receivedOn: '2026-11-24', dueOn: '2026-12-24', daysLeft: 30, status: 'OPEN' }];
};
const STRICT_CAPS = { calls: 2, emails: 2, sms: 1, letters: 2 };
/** Contact cap of a channel, as set in Paramètres du cabinet > Relances. An unreadable value never lifts the cap. */
export const contactCap = (field: 'calls' | 'emails' | 'sms' | 'letters') => {
  const cap = Number(
    groups.firm
      .flatMap((group) => group.items)
      .find((item) => item.id === 'relances')
      ?.blocks[0]?.fields.find((item) => item.id === field)?.value,
  );
  return Number.isInteger(cap) && cap > 0 ? cap : STRICT_CAPS[field];
};
export const resetSettings = () => {
  versions = {};
  resetMailboxRequests();
  resetAudit();
  groups = seedGroups();
  secrets = seedSecrets();
  boxes = seedBoxes();
  boxHistory = [];
  registry = seedRegistry();
};

const SIZES = [1000, 5000, 10000];
const edits = (session: Session) => canEdit('technical', session);
const onBox = (resolve: (item: Mailbox, session: Session, info: Info) => Response | Promise<Response>) =>
  guarded<Info>(edits, (info, session) => {
    const item = boxes.find((entry) => entry.id === info.params.id);
    return item ? resolve(item, session, info) : notFound();
  });

export const settingsHandlers = [
  http.get(
    '/api/settings/:scope',
    guarded<Info>(staff, ({ params }, session) => {
      const scope = scopeOf(params.scope);
      if (!scope) return notFound();
      if (!canRead(scope, session)) return forbidden();
      const hub: SettingsHub = {
        canEdit: canEdit(scope, session),
        groups: groups[scope].map((group) => ({
          label: group.label,
          tiles: group.items
            .filter((item) => item.id !== 'users' || seesMembers(session))
            .map((item) => ({ id: item.id, title: item.title, description: item.description, icon: item.icon, status: item.status, statusTone: item.tone })),
        })),
      };
      return HttpResponse.json(hub);
    }),
  ),
  http.get(
    '/api/settings/:scope/:id',
    guarded<Info>(staff, ({ params }, session) => {
      const scope = scopeOf(params.scope);
      if (!scope) return notFound();
      if (!canRead(scope, session)) return forbidden();
      const item = groups[scope].flatMap((group) => group.items).find((entry) => entry.id === params.id);
      if (!item) return notFound();
      // Bank details: the Director only, not even under a delegation.
      const blocks =
        session.role === 'DIRECTOR'
          ? item.blocks
          : item.blocks.map((entry) => (entry.id === 'bank' ? { ...entry, fields: entry.fields.map((field) => ({ ...field, locked: true })) } : entry));
      const tables = (item.tables ?? []).map((entry) =>
        entry.id === 'audit'
          ? { ...entry, rows: [...auditEntries().map((line) => [line.date, line.who, line.onBehalfOf, line.what, '—']), ...entry.rows] }
          : entry,
      );
      return HttpResponse.json({
        id: item.id,
        version: versions[`${scope}.${item.id}`] ?? 0,
        canEdit: canEdit(scope, session),
        blocks,
        tables,
        notes: item.notes ?? [],
      });
    }),
  ),
  http.put(
    '/api/settings/:scope/:id',
    guarded<Info>(staff, async ({ params, request }, session) => {
      const scope = scopeOf(params.scope);
      if (!scope) return notFound();
      if (!canEdit(scope, session)) return forbidden();
      const item = groups[scope].flatMap((group) => group.items).find((entry) => entry.id === params.id);
      if (!item) return notFound();
      const sent = (await request.json()) as Record<string, string | boolean>;
      const key = `${scope}.${item.id}`;
      const shown = new URL(request.url).searchParams.get('version');
      if (shown !== null && Number(shown) !== (versions[key] ?? 0)) return HttpResponse.json({ code: 'CHANGED' }, { status: 409 });
      // Only what really changes is checked, stored and written in the journal.
      const stored = new Map(item.blocks.flatMap((entry) => entry.fields).map((field) => [field.id, field]));
      const changes = Object.fromEntries(
        Object.entries(sent).filter(([key, next]) => {
          const field = stored.get(key);
          return field && !field.locked && field.kind !== 'value' && next !== (field.kind === 'switch' ? field.checked : field.value);
        }),
      );
      const problems = settingProblems(item, changes);
      if (Object.keys(problems).length) return HttpResponse.json({ code: 'INVALID', fields: Object.keys(problems) }, { status: 422 });
      if (Object.keys(changes).length === 0) return done();
      const bank = Object.keys(changes).filter((key) => scope === 'firm' && isFirmIdentity(item.id, key));
      if (bank.length > 0) {
        if (session.role !== 'DIRECTOR') return forbidden();
        // The journal names the fields, never their values.
        audit(session, `Identifiants du cabinet modifiés : ${bank.join(', ')}`);
      }
      audit(session, `Paramètres modifiés : ${item.title}`, scope === 'technical' ? 'TECHNICAL' : 'ADMINISTRATIVE');
      versions[key] = (versions[key] ?? 0) + 1;
      item.blocks = item.blocks.map((entry) => ({
        ...entry,
        fields: entry.fields.map((field) => {
          const next = changes[field.id];
          if (next === undefined || field.locked || field.kind === 'value') return field;
          return typeof next === 'boolean' ? { ...field, checked: next } : { ...field, value: next };
        }),
      }));
      return done();
    }),
  ),
  http.get(
    '/api/secrets',
    guarded(canAccessTechnicalSettings, () => HttpResponse.json({ items: secrets })),
  ),
  http.post(
    '/api/secrets',
    guarded<Info>(edits, async ({ request }, session) => {
      // The value is never kept nor sent back.
      const { name } = (await request.json()) as { name: ServiceSecret };
      if (secrets.some((entry) => entry.name === name && entry.status !== 'REVOKED')) return HttpResponse.json({ code: 'SECRET_EXISTS' }, { status: 409 });
      audit(session, `Secret ajouté : ${name}`, 'TECHNICAL');
      secrets = [
        ...secrets,
        {
          id: `k${secrets.length}`,
          name,
          internal: false,
          service: SERVICE_SECRETS[name],
          environment: 'Production',
          used: 'jamais',
          rotated: 'Aujourd’hui',
          status: 'VALID',
        },
      ];
      return done();
    }),
  ),
  http.post(
    '/api/secrets/:id/:action',
    guarded<Info>(edits, async ({ params, request }, session) => {
      const item = secrets.find((entry) => entry.id === params.id);
      if (params.action === 'keep' && session.role !== 'DIRECTOR') return forbidden();
      // Internal keys are drawn here: renewed without a value, never revoked.
      if (!item || (item.internal && params.action !== 'rotate')) return notFound();
      if (params.action === 'rotate' && Boolean(((await request.json()) as { value?: string }).value) === item.internal)
        return HttpResponse.json({ code: 'INVALID', fields: ['value'] }, { status: 422 });
      const director = session.role === 'DIRECTOR';
      // Revoking in production needs the Director: the Developer only asks for it.
      const next = {
        rotate: { status: 'VALID' as const, rotated: 'Aujourd’hui' },
        revoke: { status: director ? ('REVOKED' as const) : ('REVOKE_PENDING' as const) },
        keep: director ? { status: 'VALID' as const } : null,
      }[String(params.action)];
      // A revoked secret never comes back, and a pending request only waits for the Director.
      const allowed = {
        VALID: ['rotate', 'revoke'],
        EXPIRING: ['rotate', 'revoke'],
        REVOKE_PENDING: director ? ['revoke', 'keep'] : [],
        REVOKED: [] as string[],
      }[item.status];
      if (!next) return notFound();
      if (!allowed.includes(String(params.action))) return HttpResponse.json({ code: 'CHANGED' }, { status: 409 });
      secrets = secrets.map((entry) => (entry === item ? { ...entry, ...next } : entry));
      audit(
        session,
        `Secret ${item.name} : ${{ rotate: 'renouvelé', revoke: director ? 'révoqué' : 'révocation demandée', keep: 'révocation refusée' }[String(params.action)]}`,
        'TECHNICAL',
      );
      return done();
    }),
  ),
  http.get(
    '/api/mailboxes',
    guarded(canAccessTechnicalSettings, () =>
      HttpResponse.json({
        items: boxes,
        sizes: SIZES,
        holders: [
          { id: 'lp', name: 'Lucas Perrin' },
          { id: 'nf', name: 'Nadia Faure' },
        ],
        history: boxHistory,
        requests: mailboxRequests(),
      }),
    ),
  ),
  http.post(
    '/api/mailboxes',
    guarded<Info>(edits, async ({ request }, session) => {
      const body = (await request.json()) as { requestId?: string; sizeMb: number };
      const asked = mailboxRequests().find((item) => item.id === body.requestId);
      if (body.requestId !== undefined && !asked) return HttpResponse.json({ code: 'REQUEST_GONE' }, { status: 409 });
      // The address and the holder come from the request, never from the screen.
      const parsed = newMailbox.safeParse(asked ? { local: asked.local.toLowerCase(), holderId: asked.memberId, sizeMb: body.sizeMb } : body);
      if (!parsed.success || !SIZES.includes(parsed.data.sizeMb)) return HttpResponse.json({ code: 'INVALID' }, { status: 422 });
      const { local, sizeMb } = parsed.data;
      if (boxes.some((item) => item.address.toLowerCase() === `${local}@legarec.fr`)) return HttpResponse.json({ code: 'ADDRESS_TAKEN' }, { status: 409 });
      const holder = asked?.holder ?? { lp: 'Lucas Perrin', nf: 'Nadia Faure' }[parsed.data.holderId ?? ''] ?? null;
      if (asked) closeMailboxRequest(asked.id);
      const item = { ...box(`b${boxes.length + 1}`, local, holder, holder ? 'MEMBER' : 'FUNCTION', 0), sizeMb };
      boxes = [...boxes, item];
      logBox(session, `Boîte ${item.address} créée`);
      return HttpResponse.json({ password: drawPassword() });
    }),
  ),
  http.delete(
    '/api/mailboxes/requests/:id',
    guarded<Info>(edits, ({ params }, session) => {
      const asked = mailboxRequests().find((item) => item.id === params.id);
      if (!asked) return notFound();
      closeMailboxRequest(asked.id);
      logBox(session, `Demande de boîte refusée : ${asked.local}@legarec.fr`);
      return done();
    }),
  ),
  http.post(
    '/api/mailboxes/:id/password',
    onBox((item, session) => {
      if (item.protected) return forbidden();
      boxes = boxes.map((entry) => (entry.id === item.id ? { ...entry, connection: 'OK' } : entry));
      logBox(session, `Mot de passe de ${item.address} changé`);
      return HttpResponse.json({ password: drawPassword() });
    }),
  ),
  http.post(
    '/api/mailboxes/:id/redirections',
    onBox(async (item, session, { request }) => {
      const { to } = (await request.json()) as { to: string };
      boxes = boxes.map((entry) =>
        entry.id === item.id ? { ...entry, redirections: [...entry.redirections, { id: `r${entry.redirections.length + 1}`, to }] } : entry,
      );
      logBox(session, `Redirection de ${item.address} vers ${to}`);
      return done();
    }),
  ),
  http.put(
    '/api/mailboxes/:id/redirections/:redirection',
    onBox(async (item, session, { request, params }) => {
      const { to } = (await request.json()) as { to: string };
      boxes = boxes.map((entry) =>
        entry.id === item.id ? { ...entry, redirections: entry.redirections.map((r) => (r.id === params.redirection ? { ...r, to } : r)) } : entry,
      );
      logBox(session, `Redirection de ${item.address} modifiée vers ${to}`);
      return done();
    }),
  ),
  http.delete(
    '/api/mailboxes/:id/redirections/:redirection',
    onBox((item, session, { params }) => {
      boxes = boxes.map((entry) => (entry.id === item.id ? { ...entry, redirections: entry.redirections.filter((r) => r.id !== params.redirection) } : entry));
      logBox(session, `Redirection de ${item.address} supprimée`);
      return done();
    }),
  ),
  http.put(
    '/api/mailboxes/:id/auto-reply',
    onBox(async (item, session, { request }) => {
      // The shared mailbox only receives: not even an automatic reply leaves it.
      if (item.protected) return forbidden();
      const autoReply = (await request.json()) as NonNullable<Mailbox['autoReply']>;
      boxes = boxes.map((entry) => (entry.id === item.id ? { ...entry, autoReply } : entry));
      logBox(session, `Réponse automatique de ${item.address} enregistrée`);
      return done();
    }),
  ),
  http.delete(
    '/api/mailboxes/:id/auto-reply',
    onBox((item, session) => {
      boxes = boxes.map((entry) => (entry.id === item.id ? { ...entry, autoReply: null } : entry));
      logBox(session, `Réponse automatique de ${item.address} supprimée`);
      return done();
    }),
  ),
  // No deletion from the application: it is only done in the OVH customer area.
  http.get(
    '/api/gdpr/requests',
    guarded(keepsRegistry, () => HttpResponse.json({ items: registry })),
  ),
  http.put(
    '/api/gdpr/requests/:id',
    guarded<Info>(keepsRegistry, async ({ params, request }, session) => {
      audit(session, 'Registre RGPD : demande traitée', 'ADMINISTRATIVE');
      const { status } = (await request.json()) as { status: GdprRequest['status'] };
      registry = registry.map((item) => (item.id === params.id ? { ...item, status } : item));
      return done();
    }),
  ),
  http.post(
    '/api/gdpr/requests/:id/export',
    guarded<Info>(keepsRegistry, ({ params }, session) => {
      audit(session, 'Export RGPD des données d’un débiteur', 'ADMINISTRATIVE');
      const item = registry.find((entry) => entry.id === params.id);
      return item
        ? HttpResponse.json({
            fileName: `export-rgpd-${item.id}.json`,
            content: { debtor: item.debtor, case: item.caseId, data: 'Données fictives de démonstration' },
          })
        : notFound();
    }),
  ),
];
