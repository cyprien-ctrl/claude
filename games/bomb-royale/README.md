# HOT POTATO ROYALE — POC

Battle royale où l'on se refile une bombe avant qu'elle n'explose. DA type *Fall Guys*
(pastel, formes rondes, squash & stretch). Canvas 2D, **zéro dépendance**.

## Lancer

```bash
# depuis ce dossier
npx http-server -p 8099 -s .   # ou: python3 -m http.server 8099
# puis ouvrir http://localhost:8099
```

(Un simple double-clic sur `index.html` fonctionne aussi.)

## Contrôles

| Action | Touche |
|---|---|
| Bouger | ZQSD / WASD / flèches |
| Viser | Souris |
| Charger & lancer la bombe | Clic maintenu puis relâcher (plus long = plus loin) |
| Dash (rechargeable) | Espace |
| Ouvrir une porte (prend du temps) | E maintenu |

## Ce qui est implémenté

**Core loop**
- Bombe portée par un joueur, mèche visible, explosion → élimination (zone de blast : les
  voisins sautent aussi). Dernier survivant gagne.
- Lancer visé avec charge de puissance ; rebonds sur les murs.
- **Aimant** : bombe au sol ou en vol qui passe à moins de 150 px d'un joueur (en ligne de
  vue) → elle se dirige vers lui et il la récupère. Grâce de 0,55 s pour le lanceur.

**Options (menu)**
- Mèche **par porteur** (reset à chaque passe, défaut) ou **globale** (compte à rebours unique
  qui se raccourcit à chaque manche).
- Lancer **libre** ou **ventouse + corde** : si la bombe ne trouve personne, elle revient au lanceur.
- 1 à 7 bots.

**Bonus au sol** (respawn 12 s)
- `»` Vitesse (+45 %, 7 s) · `◉` Radar (tous les joueurs sur la minimap, 9 s) ·
  `✂` Mèche courte (la prochaine passe donne −3,5 s au receveur).

**Pièges**
- Colle (ralentissement zone) · Piège à ours (stun 1,1 s, se réarme) ·
  Plaque sonore (te révèle 4 s sur la minimap de tout le monde).
- Portes : 1,1 s d'ouverture, la jauge se vide si tu lâches.

**Minimap**
- Toi + le porteur de bombe toujours visibles. Les autres : seulement s'ils sont proches et
  hors des buissons, ou révélés (piège sonore / radar).

**Mouvement / feel**
- Dash directionnel (0,16 s, cooldown 2,2 s), squash & stretch, screen shake, particules,
  caméra lissée qui suit la bombe en mode spectateur.

**IA bots**
- Porteur : chasse la cible la plus proche en ligne de vue, dash pour combler, lance avec
  anticipation et erreur de visée. Non-porteur : fuit le porteur, dash de panique, ramasse
  les bonus, évitement de murs par raycast.

## Hors périmètre du POC (prochaines étapes)

1. **Réseau** — le POC est local (1 humain + bots). Le code est déjà déterministe côté
   `Game.update(dt)` : passer en client/serveur autoritatif avec un state snapshot 20 Hz +
   interpolation côté client est l'étape suivante (Node + `ws`, ou Colyseus).
2. Génération procédurale des arènes (le niveau est fait main dans `buildLevel()`).
3. Audio, manettes, lobby, skins.

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | Menu, overlays, canvas |
| `style.css` | UI (palette Fall Guys) |
| `game.js` | `CFG` (tout l'équilibrage en haut), `buildLevel()`, `Player`/`Bomb`, `Game` (update/IA/rendu/HUD) |

Tout l'équilibrage se règle dans l'objet `CFG` en tête de `game.js`.
