# Legarec — application de recouvrement

Cabinet de recouvrement amiable (Paris, 01 87 88 02 98). Ce dépôt transforme une maquette validée (`maquette/`) en application de production.

## Langue
- **Anglais** : code, identifiants, types, tables et colonnes, routes et modules de l'API, nouvelles variables d'environnement, codes techniques, commentaires, messages de commit.
- **Français** : tout ce que voient les utilisateurs (écrans, erreurs de formulaires, PDF, e-mails, SMS) et la documentation du kit (`CLAUDE.md`, `DECISIONS.md`, `QUESTIONS.md`, `docs/`, `.claude/`). Dates, montants et nombres en fr-FR, fuseau Europe/Paris.
- Restent en français : noms des composants de `packages/ui` (props en anglais), routes des portails (`scripts/ecrans.json`), champs de fusion (`maquette/champs-de-fusion.json`), noms existants de fichiers, scripts, commandes, agents et hooks (`pnpm verifier`, `/ecran`…), répertoires `apps/espace`, `apps/partenaires`, `apps/paiement`.
- Les modèles d'e-mails du kit `kits/emails-handlebars` gardent leurs champs en anglais (`config.*`, `case.*`, `debtor.*`).
- **Glossaire** : créancier, mandant → creditor ; débiteur → debtor ; dossier → case ; créance → claim ; relance → reminder ; échéancier → payment plan ; échéance → installment ; mise en demeure → formal notice ; quittance → receipt ; courrier → letter ; LRAR → registered letter ; accusé de réception → acknowledgment of receipt ; pièce → attachment ; contentieux → litigation ; rapprochement → reconciliation ; reversement → remittance ; facture → invoice ; avoir → credit note ; modèle → template ; paramètres → settings ; IA → AI ; délégation → delegation ; code d'accès → access code.

## Sources de vérité (dans cet ordre)
1. `PROMPT-FRONT.md` (mission en cours) et `DECISIONS.md` : décisions prises après la maquette. Elles priment sur tout le reste. En cas de contradiction entre les deux, la décision la plus récente de `DECISIONS.md` l'emporte.
2. `maquette/HANDOFF.md` : règles métier, parcours, textes.
3. `maquette/captures/` : référence visuelle (PNG à 1440, 1024 et 390 px). `maquette/*.dc.html` : structure, états et données de chaque écran.
4. `docs/` : stack, architecture, domaines et services, lecture de la maquette, assistant IA. À lire avant de toucher à la partie concernée.
5. `kits/` : modèles d'e-mails (`emails-handlebars`, à ne pas modifier ; `emails-ajout-staff-message`) et Caddyfile de référence.

En cas de doute : regarder `QUESTIONS.md`. Si la réponse n'y est pas, **ajouter la question** avec une option par défaut, ne pas inventer.

## Stack (détail : `docs/stack.md`)
TypeScript strict · pnpm + Turborepo · React 19.2 + Vite + **Mantine 9.8** · TanStack Table 9 · FullCalendar · @mantine/charts · cmdk · TanStack Query · MSW · NestJS + PostgreSQL + Prisma · **Valkey** + BullMQ · Handlebars + Playwright (PDF, e-mails) · Scaleway S3 · MySendingBox · Resend · OVH (MX Plan, SMS, API) · 3CX · IA par couche fournisseur · Docker sur VPS derrière **Caddy** · GitHub avec **GitHub Actions** (vérifications seulement).

Mantine 9 est récent : consulte le serveur MCP `mantine` (déclaré dans `.mcp.json`) avant d'utiliser un composant ou une API, plutôt que ta mémoire des versions 7 ou 8.

## Organisation
```
apps/espace        → espace.legarec.fr       (collaborateurs)
apps/partenaires   → partenaires.legarec.fr  (créanciers)
apps/paiement      → paiement.legarec.fr     (débiteurs)
apps/api           → api.legarec.fr          (NestJS, seule porte d'accès aux données)
packages/tokens    → tokens.css + thème Mantine, polices locales
packages/ui        → composants Legarec (noms français, props en anglais)
packages/contracts → schémas Zod, seule source des types (front, MSW, API)
packages/platform  → téléphone (tel: vers 3CX), notifications, fichiers générés, liens externes
kits/              → modèles d'e-mails et Caddyfile de référence
```
Règles détaillées chargées automatiquement selon les fichiers touchés : `.claude/rules/`.

## Rôles (détail : `PROMPT-FRONT.md`, section « Rôles »)
- Développeur (unique), Directeur (unique), Responsable du recouvrement (unique), Gestionnaire de créances, Créancier. Le débiteur n'a pas de compte.
- Directeur : lecture de tous les dossiers, actions sur les siens, chiffres globaux. Responsable : ses dossiers, ceux des gestionnaires et les dossiers sans gestionnaire. Gestionnaire : les siens. Développeur : aucun dossier.
- Délégations du Directeur, actives dès la mise en service : technique → Développeur, administratif → Responsable. Bandeau « Pour le compte du Directeur », double nom dans l'historique.

## Règles non négociables
- Un créancier ne voit **que ses dossiers**, et chaque rôle n'accède qu'aux dossiers prévus : filtrage dans l'API, jamais seulement dans l'interface.
- Paiement par chèque et virement uniquement : aucune carte, aucun prélèvement SEPA, aucun prestataire de paiement.
- Secrets uniquement côté serveur : chiffrés en base (clés des services saisies dans Paramètres techniques > Secrets, mots de passe des boîtes OVH), ou en variables d'environnement pour les valeurs de démarrage ; jamais dans le code, Git, les journaux, les tests ni GitHub Actions. En développement, `.env` temporaire avec des clés de test seulement. Jamais de jeton dans localStorage.
- Toute action qui engage (envoi, LRAR, désactivation, dépôt, paiement, procédure, boîte OVH) passe par `Confirm` avec récapitulatif. Action réversible : `Toast` avec « Annuler ».
- Paramètres techniques : Développeur (et Directeur). Double authentification obligatoire pour le Développeur, proposée aux autres. Journal d'audit des actions sensibles (qui, quoi, quand, pour le compte de qui).
- Pas de valeur de style en dur : uniquement le thème issu de `tokens.css`. Le rendu par défaut de Mantine (bleu, badges en majuscules) ne doit jamais apparaître.
- Libellés, ordre des menus et règles métier sont validés : ne pas les changer sans le signaler.
- Valeurs entre crochets (`[SIREN]`, `[IBAN DU COMPTE DÉDIÉ]`…) : en configuration, jamais inventées.
- Aucune donnée personnelle ni code d'accès dans une URL, un nom de fichier ou un journal.
- IA : elle suggère, un collaborateur valide toujours ; jamais de décision automatique ni d'envoi sans clic humain (`docs/ia.md`).
- RGAA / WCAG 2.2 AA, navigation clavier complète, aucun défilement horizontal de la page à 390, 768, 1024 et 1440 px.
- Environnement de développement uniquement : aucun accès aux secrets, conteneurs, journaux ni à la base de production.

## Méthode
- Grand chantier : commencer en mode plan, attendre la validation, puis suivre `PLAN.md`.
- **Une branche et une pull request par lot** (`lot/<lettre>`), un commit par écran ; PR empilées tant que le lot précédent n'est pas fusionné.
- Écran : `/ecran <Nom>`. Composant : `/composant <Nom>`. Comparaison visuelle : `/comparer <Nom>`. Avant une PR : `/verifier`.
- Données simulées (MSW) tirées de `maquette/donnees-demo/<Ecran>.json` (données métier uniquement) tant que l'API n'existe pas.
- Les contrôles automatiques (`.claude/settings.json`) formatent chaque fichier modifié et bloquent la fin d'une tâche si `pnpm verifier` échoue.

## Commandes du projet (à créer dès l'initialisation)
- `pnpm dev` · `pnpm build`
- `pnpm verifier` = types + lint + tests + contrats (aussi lancé par GitHub Actions sur chaque PR)
- `pnpm comparer <Ecran>` = `node scripts/comparer-ecran.mjs <Ecran>`
- `pnpm deployer` = déploiement Docker sur le VPS : **jamais lancé par Claude Code**
- Ne jamais pousser directement sur `main`, pas de force push.
