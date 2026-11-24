# Lire la maquette

## Où regarder
- **Apparence** : `maquette/captures/<section>/<Ecran>-<largeur>.png` (1440, 1024, 390). C'est la référence pour les comparaisons.
- **Structure, états, interactions** : `maquette/<Ecran>.dc.html`.
- **Données de démonstration** : `maquette/donnees-demo/<Ecran>.json` (valeurs calculées par `renderVals()` à l'état initial, fonctions retirées). Elles mélangent données métier et valeurs d'affichage (couleurs, libellés) : n'en garder que les données métier pour les mocks.
- **Composants** : catalogue `maquette/captures/composants/Bibliotheque-1440.png` et fichiers `maquette/<Composant>.dc.html`.
- **Fondations** : `maquette/tokens.css` et `captures/composants/Composants-1440.png`.
- **Champs de fusion des modèles** : `maquette/champs-de-fusion.json`.

## Format `.dc.html`
- `<x-dc>…</x-dc>` : gabarit. `{{valeur}}` = donnée, `<sc-if value="{{x}}">` = affichage conditionnel, `<sc-for list="{{items}}" as="i">` = boucle, `<dc-import name="Bouton" label="…" on-press="{{fn}}">` = composant enfant (attributs kebab-case → props camelCase).
- `<script type="text/x-dc">` : classe avec `state` et `renderVals()`, qui calcule toutes les valeurs du gabarit. On y trouve les données de démo, les états (chargement, vide, erreur) et les interactions.
- À ignorer : `style="display: contents"` sur les instances, attributs `hint-*`, blocs `/* tokens:start … tokens:end */` (copie de `tokens.css`), boutons `data-hors-perimetre` (volontairement inactifs).
- `support.js`, chargé en tête de chaque fichier, est le moteur de l'outil de maquette : **il n'est pas fourni, ne pas le chercher.**

## Aperçu local sans support.js
```
cd maquette && python3 -m http.server 8000
# http://localhost:8000/apercu.html            → liste des écrans
# http://localhost:8000/apercu.html?f=Dossiers.dc.html&state=Dossiers.dc.html:loading=false
```
Rendu statique (pas de clic ni de saisie). Paramètres : `&theme=dark`, `&a11y=malvoyant`, `&state=Fichier.dc.html:cle=valeur;Autre.dc.html:cle=valeur`. Attendre `window.__done === true` avant une capture.
