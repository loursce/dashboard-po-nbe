# NBE — Dashboard PO

Dashboard de suivi des PRDs et Specs de l'équipe Product, hébergé sur GitHub Pages.

**URL :** https://loursce.github.io/dashboard-po-nbe/

---

## Accès

La page est protégée par un mot de passe d'équipe. Demande-le à Cécile.

---

## Rafraîchir les données (optionnel)

Par défaut, les données sont mises à jour automatiquement chaque matin à 8h07 UTC.

Pour forcer un refresh immédiat, configure un token GitHub personnel :

### Créer un token GitHub

1. Va sur **https://github.com/settings/tokens/new**
2. **Note** : `Dashboard PO NBE`
3. **Expiration** : 90 jours
4. **Cocher** : `repo` (donne accès aux repos privés de l'org)
5. Cliquer **Generate token** — copier la valeur (affichée une seule fois)

### Configurer dans le dashboard

1. Ouvrir le dashboard
2. Cliquer **⚙ Config**
3. Coller le token dans le champ **GitHub Token**
4. Vérifier : Organisation = `ClubMediterranee`, Repo = `knowledge-base`
5. **Enregistrer & refresh**

Le token est stocké uniquement dans ton navigateur (localStorage). Il expire après 90 jours.

---

## Architecture

| Fichier | Rôle |
|---|---|
| `index.html` | Page dashboard (HTML/CSS/JS autonome) |
| `data.json` | Données chiffrées AES-256-GCM, générées par le workflow |
| `scripts/fetch-data.mjs` | Script Node.js qui lit le repo knowledge-base via l'API GitHub |
| `.github/workflows/update-data.yml` | Workflow Actions — tourne chaque jour à 8h07 UTC |

### Secrets Actions requis

| Secret | Description |
|---|---|
| `KB_TOKEN` | Token GitHub avec scope `repo` sur `ClubMediterranee/knowledge-base` |
| `DASHBOARD_PASSWORD` | Mot de passe de chiffrement AES-256-GCM pour `data.json` |
---

## Rotation du mot de passe

Pour changer le mot de passe du dashboard :

1. Aller sur **https://github.com/loursce/dashboard-po-nbe/settings/secrets/actions**
2. Cliquer sur `DASHBOARD_PASSWORD` → **Update** → saisir le nouveau mot de passe
3. Lancer le workflow manuellement : **https://github.com/loursce/dashboard-po-nbe/actions/workflows/update-data.yml** → **Run workflow**
4. Attendre ~3 min que `data.json` soit rechiffré avec le nouveau mot de passe
5. Partager le nouveau mot de passe à l'équipe — l'ancien ne fonctionnera plus
