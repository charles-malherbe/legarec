# Questions ouvertes

Claude Code : ajoute ici toute question que la maquette, `HANDOFF.md` ou `DECISIONS.md` ne tranchent pas, avec l'option que tu retiens par défaut en attendant. Quand une question est tranchée, déplace la réponse dans `DECISIONS.md`.

| # | Question | Option par défaut en attendant | Statut |
|---|---|---|---|
| 70 | OVH accepte-t-il les liens dans les SMS envoyés d'un numéro mobile virtuel ? | SMS simulés ; si les liens sont refusés, le choix de l'expéditeur se rouvre | À demander à OVH par le cabinet, avant le lot R |
| 71 | La licence 3CX est-elle Enterprise 8SC ou plus (exigée par l'API Call Control) ? | Standard simulé | À vérifier par le cabinet, avant le lot T |
| 106 | IA auto-hébergée : l'essai mesuré sur le serveur convient-il ? | IA désactivée | Essai au lot W, puis juriste |
| 121 | Durée maximale d'une session, même active (la maquette ne dit que 30 minutes d'inactivité) | 12 heures | À confirmer par le cabinet, sans urgence |
| 122 | Redemander le mot de passe ou le code avant une action sensible (retirer la double authentification, secrets, IBAN, délégations) ? | Non au lot K ; fenêtre proposée au lot L, montrée avant développement. L'API garde déjà l'heure de la dernière preuve | À trancher par le cabinet avant le lot L |
| 123 | Nouveau Directeur : les délégations de l'ancien s'ouvrent-elles d'elles-mêmes ? | Non : elles prennent fin, le nouveau Directeur les redonne en un clic | À confirmer par le cabinet |
| 124 | Remplacer le Directeur : aucun écran ne le prévoit, et son compte ne peut être ni désactivé ni changé de rôle depuis l'application | Par une commande du serveur, à écrire au lot X | À trancher par le cabinet, avant la mise en service |
| 125 | Codes de secours : montrés une fois dans Mon compte après l'activation (la maquette ne les montre qu'à l'activation du compte) ; en redemander ? | Affichage ajouté ; de nouveaux codes seulement quand il n'en reste aucun, au prochain second facteur | À confirmer par le cabinet |
| 126 | Textes ajustés ou nouveaux du lot K (voir `DECISIONS.md`) | Textes en place | À relire par le cabinet |
| 127 | Questions au support : lues par e-mail et notification (Développeur ; Directeur pour celles du Développeur), sans écran de suivi ; gardées 2 ans | En place | À confirmer par le cabinet |
| 128 | « Tous les comptes » de la question 113 : les comptes des créanciers aussi pour le Développeur ? | Non : il ne les voit pas (cloisonnement) ; le Responsable ou le Directeur les dépannent | À confirmer par le cabinet |
| 129 | « Sessions actives » : la maquette montre une ville (« Paris ») | Adresse IP : une ville demanderait une base de géolocalisation | À confirmer par le cabinet |
| 130 | Le Responsable (délégation administrative) peut nommer le Développeur, qui tient la délégation technique | Il le peut, mais la délégation technique prend fin et le Directeur est prévenu ; il la redonne en un clic | À confirmer par le cabinet |
| 131 | Invitation jamais ouverte : durée de conservation (nom, adresse), non décidée par la question 115 | Supprimée après 1 an | À confirmer par le cabinet, avant le lot V |
| 132 | Compte désactivé puis anonymisé : le nom de la personne reste dans l'historique des dossiers qu'elle a traités (gardé 5 ans après leur clôture) | Conservé : l'historique dit qui a agi | Juriste, avant le lot V |
| 133 | Aide, « Contacter le support » : « indiquez la référence du dossier si besoin », alors que la question part au Développeur, qui n'accède à aucun dossier | Texte inchangé. Conseil : « sans nom ni référence de dossier » | À trancher par le cabinet |
