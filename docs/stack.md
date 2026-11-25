# Stack validée

## Interface (apps/espace, apps/partenaires, apps/paiement)
- **React 19.2+** (exigé par Mantine 9) et **Vite**.
- **Mantine 9.8** : `@mantine/core`, `@mantine/hooks`, `@mantine/form`, `@mantine/dates`, `@mantine/notifications`, `@mantine/modals`, `@mantine/dropzone`, `@mantine/charts`.
  - Thème (`createTheme`) construit à partir de `packages/tokens/tokens.css` : palette marine en 10 nuances comme couleur principale, or en accent, Inter (interface) et Lora (titres des écrans de marque), rayons, espacements, tailles. `cssVariablesResolver` pour exposer les mêmes variables CSS.
  - Styles : CSS modules + `postcss-preset-mantine`. **Pas de Tailwind.**
  - Formulaires : `@mantine/form` + Zod. Depuis Mantine 9, `zodResolver` n'est plus exporté par `@mantine/form` : utiliser un résolveur Zod séparé.
- **TanStack Table 9** (`@tanstack/react-table`) en direct, sans surcouche, affiché avec le `Table` de Mantine. Code v9 : `useTable` (pas `useReactTable`), fonctionnalités et modèles de lignes déclarés explicitement (`tableFeatures`), pas d'export `legacy`. Tout le câblage dans le composant `Tableau` de `packages/ui`.
- **FullCalendar** pour l'agenda des relances (jour, semaine, mois, liste ; français). Extensions gratuites (MIT) uniquement. Alternative à évaluer : `@mantine/schedule` (voir `QUESTIONS.md`).
- **@mantine/charts** (Recharts 3) pour les graphiques ; Recharts directement si un type manque.
- **cmdk** pour la recherche rapide (« / ») et la palette de commandes, dans une `Modal` Mantine.
- TanStack Query (appels API), React Router, MSW (données simulées tant que l'API n'existe pas).
- Types : `packages/contracts` (schémas Zod) est la seule source ; MSW, formulaires et API s'appuient dessus.
- Polices Inter et Lora hébergées dans `packages/tokens` (woff2), jamais chargées depuis un service externe.

## Aspect
Deux ambiances sur les mêmes composants, en deux thèmes dérivés du thème de base :
- `espace` : sobre et dense (outil de production), lignes de tableau serrées, préférence « Densité » du compte.
- `partenaires` et `paiement` : plus aérés et rassurants, titres Lora (`data-brand` dans la maquette).

## API (apps/api → api.legarec.fr)
- **NestJS 12** sur **Node 26 LTS** (TypeScript), API REST : entrées validées par les schémas Zod de `packages/contracts`, OpenAPI produit par `@nestjs/swagger` (`nestjs-zod` abandonné). Versions et dépendances par lot : `docs/api.md`.
- **PostgreSQL 17 + Prisma 7** (adaptateur `pg`). Filtrage par créancier dans chaque requête et sécurité par ligne PostgreSQL, activée et forcée sur toutes les tables.
- **Valkey 8.1 + BullMQ 6** (`VALKEY_URL`) : scénarios de relance, envois groupés, synchronisation IMAP, reversements ; workers dans un conteneur séparé ; persistance AOF, `maxmemory-policy noeviction`.
- **Documents** : modèles HTML Handlebars, PDF générés par **Playwright** (Chromium) ; fichiers reçus contrôlés par **ClamAV**.
- **E-mails** : kit `kits/emails-handlebars` (25 modèles) et ajout `staff-message`, rendus par handlebars 4.x dans `apps/api/templates/emails/` ; envoi par Resend (automatiques) ou par SMTP OVH de la boîte du collaborateur (nodemailer).
- **Fichiers** : **Scaleway Object Storage** (API S3).
- **IA** : auto-hébergée si l'essai du lot W convient ; couche fournisseur (adaptateurs Anthropic et compatible OpenAI pour Scaleway et OVH), deux niveaux de modèle configurables ; voir `docs/ia.md`.
- **OVH** : API OVHcloud (gestion des boîtes MX Plan, SMS), appels signés sans le paquet `ovh`, clés aux droits limités.
- **Développement** : PostgreSQL et Valkey des paquets Debian, lancés par `infra/dev/services.mjs` (utilisateur courant, 127.0.0.1) ; Node 26 par nvm.

## Services externes
Voir `docs/domaines-et-services.md`.

## Hébergement, code, qualité
- Conteneurs **Docker** sur un **VPS** : réservé à Legarec : un `docker-compose.yml` (api, worker, trois fronts, PostgreSQL, Valkey, Gatus, Loki, Grafana, **Caddy** ; ClamAV et n8n à venir). Caddy est le seul service exposé (HTTPS automatique) ; `infra/caddy/Caddyfile`, d'après `kits/caddy/Caddyfile.exemple`. Guide : `docs/deploiement.md`.
- Code sur **GitHub, avec GitHub Actions** pour les vérifications : `.github/workflows/` lance `pnpm verifier` sur chaque pull request. Aucun secret de production ni déploiement dans GitHub Actions ; le déploiement reste `pnpm deployer`, lancé par le cabinet.
- Mises à jour : versions exactes figées ; Renovate propose les mises à jour, vérifiées par GitHub Actions avant fusion.
- Tests : **Vitest** (logique), **Playwright** (parcours + comparaison visuelle avec `maquette/captures/`), **axe** (accessibilité).
