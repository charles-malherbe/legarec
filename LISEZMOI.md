# Legarec — kit Claude Code v2.5 (front-end web)

1. Ouvrir ce dossier (ou le dépôt GitHub `charles-malherbe/legarec`) dans Claude Code.
2. Accepter le serveur MCP `mantine` proposé par `.mcp.json`.
3. Passer en mode plan.
4. Coller le contenu de `PROMPT-FRONT.md` comme premier message.

Dépôt déjà commencé : copier tout le kit sauf `maquette/` si elle n'a pas changé (les fichiers de documentation ont été mis à jour en v2.5).

| Élément | Rôle |
|---|---|
| `PROMPT-FRONT.md` | Mission, stack, décisions récentes, lots, rythme |
| `CLAUDE.md`, `DECISIONS.md`, `QUESTIONS.md` | Instructions permanentes, décisions, points ouverts |
| `docs/` | Stack, domaines et services, lecture de la maquette, IA |
| `.claude/` | Réglages, contrôles automatiques, règles, commandes `/ecran` `/composant` `/comparer` `/verifier`, agents de relecture |
| `maquette/` | Écrans `.dc.html`, `HANDOFF.md`, `tokens.css`, captures 1440/1024/390, données de démonstration, champs de fusion |
| `scripts/` | Comparaison visuelle et correspondance écran → route |
| `ia/cas-de-test.json` | Cas de test des fonctions IA |
| `kits/` | Modèles d'e-mails (`emails-handlebars`, à ne pas modifier), ajout `emails-ajout-staff-message`, Caddyfile de référence |
