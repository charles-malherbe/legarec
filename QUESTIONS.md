# Questions ouvertes

Claude Code : ajoute ici toute question que la maquette, `HANDOFF.md` ou `DECISIONS.md` ne tranchent pas, avec l'option que tu retiens par défaut en attendant. Quand une question est tranchée, déplace la réponse dans `DECISIONS.md`.

| # | Question | Option par défaut en attendant | Statut |
|---|---|---|---|
| 164 | IA : prix des jetons | `AI_PRICE_INPUT` et `AI_PRICE_OUTPUT` (euros par million de jetons) sont exigés pour allumer l'IA, sinon le budget (40 € par mois, question 166) ne peut pas être tenu ; pour un modèle auto-hébergé, une estimation du coût du serveur (ou 0) | À renseigner par le cabinet à la mise en service (en place dans le lot W) |
| 194 | Mise en service : 41 routes de l'espace et 1 du portail des créanciers n'existent pas encore sur l'API (`docs/deploiement.md`, « Écrans encore sans API »). Une page de production n'a pas de simulation : ces écrans affichent leur état d'erreur | Pas de mise en service avant que Facturation, Rapports, Équipe et les Documents du créancier soient sur l'API (aucune clé externe n'est nécessaire). Messagerie, Appels et envois de relances attendent leurs clés (lots Q, R, T) : à la mise en service, soit ils sont prêts, soit leurs entrées de menu sont masquées par un réglage de construction, jamais laissées en erreur | À trancher par le cabinet, avant le lot X (fin) |
