# Audit d'application du theme ALTA

Branche: `audit/theme-application`

## Diagnostic

Le theme ALTA est bien declare dans `frontend/css/app.css`, mais plusieurs pages chargent une feuille specifique apres `app.css`. Ces feuilles de page redefinissaient ensuite des couleurs de cartes, tableaux, champs, focus et KPI avec des valeurs codees en dur. Le precedent correctif avait ajoute un garde-fou global avec beaucoup de `!important` dans `app.css`; il masquait le symptome, mais rendait la cascade fragile.

Correction appliquee: suppression du garde-fou global, puis remplacement des couleurs locales problematiques par les variables ALTA existantes.

## Pages inspectees

| Page | CSS charges | `app.css` present | Ordre constate | Diagnostic |
| --- | --- | --- | --- | --- |
| `frontend/home.html` | `./css/app.css`, `./css/pages/home-branding.css?v=5` | Oui | `app.css` avant `home-branding.css` | OK: le CSS Home utilise deja majoritairement les variables ALTA. |
| `frontend/clients.html` | `./css/app.css`, `./css/pages/clients.css?v=1` | Oui | `clients.css` apres `app.css` | `clients.css` ecrasait cartes, tableaux, champs et focus avec des couleurs locales, dont un fallback `#005baa`. |
| `frontend/articles.html` | `./css/app.css`, `./css/pages/articles.css?v=10` | Oui | `articles.css` apres `app.css` | `articles.css` redefinissait tableaux et modales avec `#e5e7eb`, `#f9fafb`, `#374151`, `#ffffff`. |
| `frontend/purchases.html` | `./css/app.css`, `./css/pages/purchases.css?v=3` | Oui | `purchases.css` apres `app.css` | Badges de statut en bleus codes en dur (`#1976d2`, `#0288d1`) et texte total local. |
| `frontend/stock.html` | `./css/app.css`, `./css/pages/stock.css?v=3` | Oui | `stock.css` apres `app.css` | KPI stock et champs tarifaires utilisaient encore `#dbeafe`, `#6b7280`, `#111827`, `#d1d5db`. |
| `frontend/sales.html` | `./css/app.css` | Oui | `app.css` seul | Pas de CSS page detecte apres `app.css`; pas d'ecrasement specifique sur cette page. |
| `frontend/settings.html` | `./css/app.css`, `./css/pages/home-branding.css?v=3`, `./css/pages/settings.css?v=2`, `./css/pages/settings-branding.css?v=1` | Oui | Deux CSS settings apres `app.css` | `settings.css` et `settings-branding.css` redefinissaient cartes, champs, focus, previews et textes d'aide avec anciens tons/fallbacks. |
| `frontend/statistiques.html` | `./css/app.css`, `./css/pages/statistiques.css?v=1` | Oui | `statistiques.css` apres `app.css` | Onglets actifs en `#2563eb`, KPI en bordure `#dbeafe`, cartes et listes avec couleurs locales. |

## CSS responsables identifies

- `frontend/css/pages/clients.css`: cartes, titres, formulaires, focus, tableaux et detail client.
- `frontend/css/pages/articles.css`: tableaux et modales.
- `frontend/css/pages/purchases.css`: badges commandes/receptions et cellule total.
- `frontend/css/pages/stock.css`: KPI stock, champs tarifaires et textes secondaires.
- `frontend/css/pages/settings.css`: cartes, formulaires, focus, logo preview.
- `frontend/css/pages/settings-branding.css`: favicon preview et aides.
- `frontend/css/pages/statistiques.css`: onglets, KPI, cartes inactives et indicateurs.
- `frontend/css/pages/dashboard.css`: corrige aussi par coherence avec la Home; KPI et barres de graphique utilisaient les memes anciens bleus.

## Correction appliquee

- Conservation des variables ALTA dans `frontend/css/app.css`:
  - `--alta-navy: #0F2744`
  - `--alta-ocean: #114B7A`
  - `--alta-turquoise: #00A6A6`
  - `--alta-bg: #F5F7FA`
  - `--alta-card: #FFFFFF`
  - `--alta-text: #132238`
  - `--alta-muted: #667085`
  - `--alta-border: #E5E7EB`
- Suppression du bloc global de priorite ALTA dans `app.css`, qui utilisait de nombreux `!important`.
- Remplacement des couleurs de page par les variables communes quand elles correspondent a l'identite ALTA.
- Conservation des couleurs semantiques existantes pour succes, erreur, warning, negatif et statuts metier.

## Hors perimetre

- Aucun backend modifie.
- Aucune API modifiee.
- Aucune logique metier modifiee.
- Aucune migration SQL necessaire.
