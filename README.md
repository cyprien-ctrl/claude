# Enregistreur d'écran

Application Windows (C# / WPF, .NET 8) pour enregistrer facilement son écran,
avec caméra et micro en option, et un bouton pour recommencer l'enregistrement
en un clic.

## Fonctionnalités

- Enregistrement de l'écran sélectionné (utile si plusieurs moniteurs), au format MP4 (H.264).
- Caméra en option, incrustée en bas à droite de la vidéo.
- Micro en option.
- Bouton **Recommencer** : annule la vidéo en cours (elle n'est pas sauvegardée) et relance
  immédiatement un nouvel enregistrement avec les mêmes réglages.
- Choix du dossier de sortie, avec accès rapide pour l'ouvrir dans l'explorateur.

## Technique

- WPF / .NET 8 (`net8.0-windows`).
- Capture et encodage via [ScreenRecorderLib](https://github.com/sskodje/ScreenRecorderLib)
  (Desktop Duplication API + Media Foundation), qui gère l'incrustation caméra et le mixage audio.

## Prérequis

- Windows 10 ou 11, **64 bits**.
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0) pour compiler.
- Une webcam / un micro si vous voulez utiliser ces options.

> ScreenRecorderLib est fournie en DLL native x64 (pas de build "Any CPU"). Le projet force
> déjà `Platform=x64`, donc `dotnet build`/`dotnet run` fonctionnent sans option supplémentaire.

## Compiler et lancer

```powershell
cd src/ScreenRecorderApp
dotnet restore
dotnet run
```

## Générer un exécutable distribuable (un seul fichier .exe)

```powershell
cd src/ScreenRecorderApp
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true
```

L'exécutable est généré dans `bin/Release/net8.0-windows10.0.19041.0/win-x64/publish/`.

## Ouvrir dans Visual Studio

Ouvrez directement `src/ScreenRecorderApp/ScreenRecorderApp.csproj` (ou le dossier du dépôt)
dans Visual Studio 2022 avec la charge de travail ".NET Desktop Development".

## Note

Ce projet a été écrit et vérifié ligne par ligne contre le code source de ScreenRecorderLib
(headers C++/CLI du dépôt officiel), mais n'a pas pu être compilé dans cet environnement car
WPF ne peut être construit que sous Windows. Compilez-le sur une machine Windows avant la
première utilisation pour confirmer qu'il n'y a pas d'erreur liée à la version exacte du
package NuGet installée.
