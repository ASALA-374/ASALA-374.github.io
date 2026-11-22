# Portfolio — Kevin Haroutunian (BTS SIO SISR)

Site statique (HTML/CSS/JS, aucun framework ni bibliothèque) avec 4 onglets : **accueil, projets, veille, contact**.

- **Scène 3D temps réel** (WebGL) : ville au bord de l'eau, ciel, nuages, soleil/lune, reflets, néons, voitures, hélicoptère.
- **Jour / nuit** : même ville sous deux éclairages ; le changement de mode joue un vrai coucher (ou lever) de soleil.
- **Intro bande-annonce** (une fois par visite, bouton « Passer l'intro ») puis **zoom cinéma** à travers « KEVIN » au scroll.
- Boutons en **liquid glass**, grain pellicule, animations au défilement.
L'onglet **veille** se met à jour tout seul chaque matin grâce à GitHub Actions.

```
├── index.html                  ← tout le contenu du site (textes à personnaliser)
├── assets/
│   ├── style.css               ← styles, couleurs jour/nuit (variables en haut du fichier)
│   ├── world.js                ← moteur de la scène 3D (shader WebGL)
│   ├── app.js                  ← onglets, intro, zoom au scroll, thème, veille
│   ├── cv.pdf                  ← À AJOUTER
│   └── tableau-synthese.pdf    ← À AJOUTER (tableau de synthèse E5)
├── data/veille.json            ← historique de veille (rempli automatiquement)
├── scripts/veille.py           ← script de veille (Python, sans dépendance)
└── .github/workflows/veille.yml← exécution quotidienne de la veille
```

## Mise en ligne (GitHub Pages, gratuit) — 5 minutes

1. Crée un dépôt public sur GitHub (ex. `portfolio`) et envoie-y tous les fichiers
   (y compris le dossier caché `.github`).
2. Dans le dépôt : **Settings → Pages → Build and deployment → Source : Deploy from a branch**, branche `main`, dossier `/ (root)`.
3. Onglet **Actions** → workflow « Veille quotidienne » → **Run workflow**.
   La première news apparaît et le site est en ligne sur `https://<ton-pseudo>.github.io/portfolio/`.
4. Ensuite, tout est automatique : chaque matin vers 6-7h, une nouvelle news est ajoutée.

> Pense à faire `git pull` avant de modifier le site en local : le robot ajoute un commit par jour.

## Comment fonctionne la veille

`scripts/veille.py` interroge l'API publique officielle du **CERT-FR** (ANSSI) : `/avis/json/` et `/alerte/json/`.
Les contenus du CERT-FR sont publiés sous **Licence Ouverte 2.0 (Etalab)** : ils peuvent être republiés
intégralement en citant la source, ce qui permet de lire chaque bulletin en entier directement sur le site.

À chaque exécution, le script :
1. récupère les bulletins publiés depuis le **1er octobre 2026** (il rattrape tout seul les jours manquants) ;
2. calcule un score d'importance : alerte > avis, exécution de code à distance, exploitation active,
   équipements réseau (Cisco, Fortinet…), Microsoft / Active Directory, nombre de CVE… ;
3. garde le bulletin le plus important de chaque jour, avec son contenu complet, dans `data/veille.json`.

Les jours sans publication (week-ends, jours fériés) n'ont pas d'entrée.
Pour ajuster la sélection : modifie la liste `KEYWORDS` en haut du script.
Pour tout reconstruire depuis le 1er octobre : `python scripts/veille.py --full`.

## À personnaliser

- `index.html` : email, LinkedIn, GitHub, phrase d'accroche, compétences et **tes vrais projets**
  (les 4 fiches sont des exemples typiques SISR à adapter).
- Ajouter `assets/cv.pdf` et `assets/tableau-synthese.pdf`.
- Couleurs : deux blocs de variables en haut de `assets/style.css` (`[data-theme="night"]` et `[data-theme="day"]`).
- Scène coucher de soleil (accueil) : section « SCÈNE COUCHER DE SOLEIL » de `assets/style.css` (hauteur de l'horizon : `--h`).
- Intro bande-annonce : les cartes de texte sont dans `index.html` (bloc `trailer`), les durées dans `app.js` (`holds`).
- Mot du zoom cinéma : `KEVIN` dans `index.html` (`mask-text`) ; la caméra plonge dans la 4e lettre.
- Compatibilité : sans WebGL, le site affiche un fond animé de secours. La résolution de la scène s'adapte
  automatiquement à la puissance de l'appareil.
- Animations : `assets/app.js` (Web Animations API, sans bibliothèque) ; elles se coupent automatiquement si l'utilisateur a activé « réduire les animations ».

> Note GitHub : les tâches planifiées peuvent avoir quelques minutes de retard, et sont
> mises en pause si le dépôt reste inactif 60 jours — relance-les depuis l'onglet Actions si besoin.
