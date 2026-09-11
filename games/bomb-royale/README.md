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
| Passer la bombe | Espace (ou clic) — seulement si quelqu'un est à portée |
| Dash (rechargeable) | Espace — **sauf** si tu portes la bombe |
| Ouvrir une porte | E maintenu (1 s, ça fait du bruit) |

## Ce qui est implémenté

**La bombe ne touche jamais le sol**
- Elle est **toujours** dans les mains de quelqu'un. Pas de lancer dans le vide, pas de bombe
  qui traîne : c'est un jeu de chat, pas de tir.
- Pour t'en débarrasser, colle-toi à un adversaire (120 px par défaut, en ligne de vue) et
  appuie sur `Espace` : la bombe part automatiquement sur lui. La cible verrouillée est
  reliée à toi par un trait vert ; sinon tu vois ton rayon de portée en pointillés.
- Tu vises avec la souris pour **choisir** entre deux adversaires à portée : celui que tu
  regardes est privilégié.
- Le receveur est **figé 1,5 s** et la mèche **ne redémarre qu'après** — ça lui laisse le
  temps d'encaisser, et à toi celui de décoller.
- Tu ne peux pas la renvoyer à celui qui vient de te la donner pendant 2 s : il faut trouver
  quelqu'un d'autre.

**Le porteur de bombe**
- Court plus vite (+28 %) mais **perd son dash** : il fonce, il ne s'échappe pas.

**Core loop**
- Mèche de 18 s. À zéro : explosion, le porteur est éliminé et les joueurs dans les 130 px
  sautent avec lui. 2 s plus tard la bombe réapparaît chez le survivant le plus éloigné du
  cratère — il y a toujours une bombe en jeu. Dernier survivant gagne.

**Options (menu)**
- Mèche **par porteur** (18 s, reset à chaque passe, défaut) ou **globale** (52 s, compte à
  rebours unique qui se raccourcit à chaque manche).
- Portée de passe : 90 / 120 / 170 px.
- 1 à 7 bots.

**Bonus au sol** (respawn 12 s)
- `»` Vitesse (+45 %, 7 s) · `◉` Radar (tous les joueurs sur la minimap, 9 s) ·
  `✂` Mèche courte (la prochaine passe donne −3,5 s au receveur).

**Level design : des passages obligés**
- 8 salles séparées par des cloisons percées. Chaque trou est un passage obligé, et chaque
  passage obligé contient quelque chose qui coûte du temps.

**Pièges**
- Colle (ralentissement zone) · Piège à ours (stun 1,1 s, se réarme) ·
  Plaque sonore (te révèle 4 s sur la minimap de tout le monde).

**Obstacles qui font perdre du temps**
- **Porte** : 1 s à ouvrir, la jauge se vide si tu lâches, ça fait du bruit (tu apparais 4 s
  sur la minimap de tout le monde) et elle se **referme seule** après 4,5 s.
- **Barrière de chantier** : cycle ouverte 3,4 s → gyrophare 0,9 s → fermée 2,8 s.
- **Tourniquet** : 3 bras qui tournent en continu, il faut passer entre deux bras.
- **Mur coulissant** : fait des allers-retours sur son rail et te pousse avec lui.

**Hautes herbes**
- Tu y es invisible sur la minimap *et* à l'écran des autres (sauf à moins de 200 px).
  Dedans, elles s'éclaircissent pour que tu voies ce que tu fais.

**Champ de vision**
- Sans la bombe : 620 px, les bords s'assombrissent et les ennemis lointains disparaissent.
- Avec la bombe : 980 px. Le chasseur voit loin, la proie voit court.

**Minimap**
- Toi + le porteur de bombe toujours visibles. Les autres : seulement s'ils sont proches et
  hors des buissons, ou révélés (piège sonore / radar).

**Mouvement / feel**
- Dash directionnel (0,16 s, cooldown 2,2 s), squash & stretch, screen shake, particules,
  caméra lissée qui suit la bombe en mode spectateur.

**IA bots — pathfinding A***
- Grille de navigation 32 px, murs dilatés du rayon du joueur, A* 8 directions.
- Les obstacles franchissables (portes, barrières, tourniquets, murs mobiles) ne bloquent pas
  le chemin : ils coûtent cher tant qu'ils sont fermés, donc un bot les contourne s'il existe
  mieux, et les traverse sinon. Pénalités rafraîchies 10×/s.
- Suivi lissé (*string pulling*) + anti-blocage : un bot qui n'avance plus pendant 0,55 s
  repart en crabe et recalcule. Mesuré : ~3 % du temps à l'arrêt sur 7 bots (contre ~25 %
  avec l'ancien évitement par raycast).
- Porteur : chasse la cible la plus proche en pondérant la ligne de vue et passe dès qu'elle
  est à portée (0,10–0,22 s de temps de réaction pour laisser une chance). Non-porteur : fuit
  vers un point atteignable, dash de panique, ramasse les bonus, ouvre les portes qui le
  bloquent.

## Hors périmètre du POC (prochaines étapes)

1. **Réseau** — le POC est local (1 humain + bots). Le code est déjà déterministe côté
   `Game.update(dt)` : passer en client/serveur autoritatif avec un state snapshot 20 Hz +
   interpolation côté client est l'étape suivante (Node + `ws`, ou Colyseus).
2. Génération procédurale des arènes (le niveau est fait main dans `buildLevel()`, mais la
   fonction `partition()` qui perce les cloisons est déjà paramétrique).
3. Audio, manettes, lobby, skins.

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | Menu, overlays, canvas |
| `style.css` | UI (palette Fall Guys) |
| `game.js` | `CFG` (tout l'équilibrage en haut), `buildLevel()`, `Nav` (grille + A*), `Player`/`Bomb`, `Game` (update/IA/rendu/HUD) |
| `artifact.html` | même jeu en page autonome (CSS inline) pour publication |

Tout l'équilibrage se règle dans l'objet `CFG` en tête de `game.js`.
