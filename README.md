# Enregistreur d'écran

Application Windows (C# / WPF, .NET 8) pour enregistrer facilement son écran,
avec caméra et micro en option, un compte à rebours avant le départ, et un bouton
pour recommencer l'enregistrement en un clic.

## Fonctionnalités

- Enregistrement de l'écran sélectionné (utile si plusieurs moniteurs), au format MP4 (H.264).
- **Caméra en option, incrustée en rond** (style Loom) en bas à droite de la vidéo.
- **Micro en option.**
- **Compte à rebours 3 · 2 · 1** affiché en plein écran avant le début de l'enregistrement
  (il n'apparaît pas dans la vidéo).
- **L'app se minimise** et **la barre des tâches Windows est masquée** pendant l'enregistrement,
  pour une capture propre.
- **Bouton Recommencer** : annule la vidéo en cours (elle n'est pas sauvegardée) et relance
  immédiatement un nouvel enregistrement avec les mêmes réglages.
- **Ouverture automatique du dossier** avec la nouvelle vidéo sélectionnée dès l'arrêt.
- Interface sombre et moderne (barre de titre sombre, cartes, interrupteurs).

## Contrôle pendant l'enregistrement (important)

Comme l'app se minimise **et** que la barre des tâches est masquée, l'arrêt se fait
au clavier grâce à des raccourcis globaux :

- **Ctrl + Alt + S** : arrêter l'enregistrement
- **Ctrl + Alt + R** : recommencer (annule la prise en cours et repart)

Si ces raccourcis sont déjà pris par un autre logiciel, l'app vous le signale : vous
pouvez alors revenir à la fenêtre avec **Alt + Tab** et cliquer sur *Arrêter*.

## Technique

- WPF / .NET 8 (`net8.0-windows`), thème sombre personnalisé.
- Capture et encodage écran/micro via
  [ScreenRecorderLib](https://github.com/sskodje/ScreenRecorderLib)
  (Desktop Duplication API + Media Foundation).
- La caméra ronde est rendue par l'app dans une petite fenêtre circulaire, toujours au
  premier plan et « transparente au clic » ; c'est l'enregistrement de l'écran qui la
  capture (ScreenRecorderLib ne sait afficher que des incrustations rectangulaires).
  La capture de la webcam utilise [OpenCvSharp](https://github.com/shimat/opencvsharp).

## Prérequis

- Windows 10 ou 11, **64 bits**.
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0) pour compiler.
- Une webcam / un micro si vous voulez utiliser ces options.

> Les composants natifs (ScreenRecorderLib, OpenCvSharp) sont en x64 uniquement.
> Le projet force déjà `Platform=x64` et `RuntimeIdentifier=win-x64`, donc
> `dotnet build`/`dotnet run` fonctionnent sans option supplémentaire.

## Compiler et lancer

```powershell
cd src/ScreenRecorderApp
dotnet restore
dotnet run
```

Le premier `restore` télécharge OpenCvSharp (assez volumineux), c'est normal.

## Générer un exécutable distribuable (un seul fichier .exe)

```powershell
cd src/ScreenRecorderApp
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true
```

L'exécutable est généré dans `bin/Release/net8.0-windows10.0.19041.0/win-x64/publish/`.

## Notes et limitations

- **Caméra** : l'app ouvre la caméra par son numéro d'ordre dans la liste. Sur la quasi-totalité
  des PC (une seule webcam) cela correspond exactement au bon appareil. Avec plusieurs caméras,
  si ce n'était pas la bonne, choisissez l'autre entrée dans la liste.
- **Multi-écrans à échelles (DPI) différentes** : le positionnement de la bulle caméra est
  calculé pour l'échelle de l'écran principal ; il peut être légèrement décalé sur un second
  écran réglé à une échelle différente.
- Ce projet a été écrit et vérifié contre le code source des bibliothèques utilisées, mais WPF
  ne se compile que sous Windows : compilez-le une première fois sur une machine Windows pour
  confirmer qu'il n'y a pas d'erreur liée aux versions exactes des paquets NuGet.
