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
| Objet slot 1 / slot 2 | **A** et **E** (AZERTY) · **Q** et **E** (QWERTY) · ou **1** et **2** |
| Ouvrir une porte | F maintenu (1 s, ça fait du bruit) |

> Les libellés affichés dans le HUD sont résolus depuis ta vraie disposition clavier
> (`navigator.keyboard.getLayoutMap`), donc ils affichent les bonnes lettres.
> A et Z eux-mêmes étaient impossibles : Z = avancer en ZQSD, A = gauche en WASD. A et E
> encadrent la touche « avancer » dans les deux dispositions.

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

**Cubes mystères et objets** (façon Mario Kart)
- Des cubes `?` tournent un peu partout, dont quatre posés **dans les goulets** : tentant,
  mais c'est là qu'on se fait attraper. Respawn 8 s.
- Tu portes **2 objets maximum** ; inventaire plein = le cube reste en place.
- Le tirage est pondéré, et **pondéré différemment quand tu portes la bombe** : plus de
  mobilité (turbo, fantôme) pour le chasseur, plus de pièges pour les autres.

| Objet | Effet |
|---|---|
| **TURBO** | +50 % de vitesse, 7 s |
| **FANTÔME** | traverse les murs 4,5 s — et tu ressors toujours au propre, jamais coincé |
| **RADAR** | débloque la minimap 9 s et y montre tout le monde |
| **MÈCHE COURTE** | ta prochaine passe coupe 3,5 s au receveur |
| **COLLE** | tu poses une flaque derrière toi (ralentit) |
| **PIÈGE** | tu poses un piège à ours derrière toi (stun 1,1 s, à usage unique) |
| **SIRÈNE** | révèle 5 s tous les joueurs dans un rayon de 520 px |

Les pièges ne sont plus posés dans le décor : ils viennent tous des cubes, et c'est toi
qui choisis où les laisser. Un objet posé s'arme en 0,5 s (tu ne te piéges pas toi-même)
et disparaît après 18 s.

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

**Minimap : un privilège du porteur**
- Si tu n'as pas la bombe, **tu n'as pas de minimap du tout**. Tu cours à l'aveugle.
- Le porteur, lui, voit la carte et les fuyards — sauf ceux planqués dans les hautes herbes.
- L'objet RADAR est le seul moyen de l'obtenir sans la bombe (9 s).

**Mouvement**
- Dash directionnel (0,16 s, cooldown 2,2 s).
- Collisions avec **glissement tangentiel** : on ne perd que la composante qui rentre dans le
  mur, donc on longe une paroi à pleine vitesse au lieu de s'y coller. Le dash suit la paroi
  lui aussi au lieu de mourir dessus.

**Juice**
- Hit-stop (0,12 s sur l'explosion, 0,05 s sur une passe), punch de caméra (zoom élastique),
  flash blanc, screen shake, confettis qui tournent, textes qui pop, traînées de dash et de
  fantôme, squash & stretch, cubes qui tournent sur eux-mêmes.
- Tic-tac qui double de cadence sous 5 s, vignette rouge pulsante et barre de mèche qui bat.
- **Son entièrement généré** (WebAudio, aucun asset) : passe, réception, ramassage, dash,
  explosion, tic-tac, fanfare de victoire.

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
