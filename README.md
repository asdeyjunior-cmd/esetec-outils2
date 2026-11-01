# Nettoyage ESETEC Marketplace — mode d'emploi

`nettoyage.js` est un outil d'administration à lancer **sur ton PC**, jamais sur le site.
Il utilise les droits administrateur de Firebase pour faire ce que le site ne peut pas faire seul.

## Ce qu'il fait

1. **Supprime les vendeurs refusés** : fiche, profil public, code de parrainage et compte de connexion.
2. **Répare les anciennes fiches vendeurs** (celles d'avant le passage à Firebase Authentication) :
   - si un compte de connexion existe déjà pour l'email (par exemple ton compte admin), la fiche y est rattachée ;
   - sinon, le compte est créé avec le même mot de passe. Si ce mot de passe fait moins de 6 caractères, le script affiche un lien à envoyer au vendeur pour qu'il en choisisse un nouveau.
3. **Supprime les restes** : profils publics et codes de parrainage de vendeurs qui n'existent plus.
4. **Supprime les comptes de connexion fantômes** : comptes qui ne sont ni admin ni liés à une fiche vendeur (vendeurs supprimés, inscriptions abandonnées…). Un compte créé depuis moins de 48 h n'est jamais supprimé : la personne est peut-être en train de payer son inscription.
5. **Supprime ce qui est terminé** : articles expirés (avec leurs favoris et publicités), publicités dont la durée payée est finie, demandes de publicité d'articles supprimés ou traitées depuis plus de 60 jours, événements passés, demandes d'événements dont la date est passée.

Il ne touche **jamais** aux soldes, retraits ni filleuls, ni aux articles encore valides.

---

## Prérequis

- **Node.js** installé. Vérifie dans PowerShell :
  ```powershell
  node -v
  ```
  Si la commande n'est pas reconnue, installe la version « LTS » sur https://nodejs.org puis rouvre PowerShell.

---

## Installation (une seule fois)

### 1. Créer le dossier de l'outil

Crée un dossier **en dehors du dossier du site**, par exemple :

```
C:\esetec-outils
```

Mets-y les fichiers `nettoyage.js`, `package.json` et ce `README.md`.

### 2. Télécharger la clé administrateur

1. Ouvre https://console.firebase.google.com et choisis le projet **esetec-marketplace**.
2. Clique sur **⚙ (roue dentée) → Paramètres du projet**.
3. Ouvre l'onglet **Comptes de service**.
4. Clique sur **Générer une nouvelle clé privée**, puis confirme.
5. Un fichier `.json` est téléchargé. **Renomme-le `cle.json`** et place-le dans `C:\esetec-outils`.

Le dossier doit contenir :

```
C:\esetec-outils
├── cle.json
├── nettoyage.js
├── package.json
└── README.md
```

> **Attention : `cle.json` donne un accès total à ta base de données et à tous les comptes.**
> Ne la mets jamais dans le dossier du site, ne l'envoie à personne et ne la publie nulle part.

### 3. Installer les dépendances

```powershell
cd C:\esetec-outils
npm install
```

Un dossier `node_modules` apparaît : c'est normal.

---

## Utilisation

### Étape 1 — Aperçu (ne modifie rien)

```powershell
cd C:\esetec-outils
node nettoyage.js
```

Le script affiche 4 listes :

```
1) Vendeurs refusés à supprimer
2) Anciennes fiches vendeurs à réparer
3) Restes de vendeurs supprimés
4) Comptes de connexion fantômes (ni admin, ni vendeur)
```

puis un résumé. **Rien n'est modifié à cette étape.** Lis bien les listes.

### Étape 2 — Appliquer

Si tout est correct :

```powershell
node nettoyage.js --appliquer
```

Le script se termine par `Terminé.`

Si des liens « pour choisir son mot de passe » s'affichent, copie chacun et envoie-le au vendeur concerné, par WhatsApp par exemple.

---

## Après le nettoyage

- Vérifie dans la page **admin** que le message indique que tous les comptes vendeurs sont sécurisés.
- Tu peux te connecter dans l'espace vendeur avec ton email `asdeyjunior@gmail.com` et ton **mot de passe admin**, ou avec Google.
- Tu peux relancer le script quand tu veux : il ne refait que ce qui reste à faire.

### Sécurité de la clé

Quand tu n'as plus besoin de l'outil, supprime `cle.json`. Tu pourras en générer une nouvelle plus tard.
Si tu penses qu'elle a été vue par quelqu'un, désactive-la :
**Paramètres du projet → Comptes de service → Gérer les autorisations du compte de service** (Google Cloud), puis supprime la clé concernée.

---

## En cas de problème

| Message | Solution |
|---|---|
| `Cannot find module './cle.json'` | La clé n'est pas dans le dossier, ou n'est pas nommée exactement `cle.json`. |
| `Cannot find module 'firebase-admin'` | Lance `npm install` dans `C:\esetec-outils`. |
| `node` n'est pas reconnu | Installe Node.js (voir Prérequis), puis rouvre PowerShell. |
| `Erreur : ... permission ...` | La clé vient d'un autre projet : régénère-la depuis le projet **esetec-marketplace**. |
| `email invalide, ignoré` | La fiche n'a pas d'email valide : corrige-la ou supprime-la dans la console Firebase. |

Pour toute autre erreur, envoie une capture du message complet.


---

## Automatique sur GitHub (toutes les 12 heures)

GitHub peut lancer l'outil tout seul, à **00 h et 12 h** (heure d'Abidjan), sans que ton PC soit allumé.
En mode automatique, il fait le nettoyage (étapes 1, 3, 4 et 5) mais **ne crée aucun compte** : les anciennes fiches à réparer sont seulement signalées.
S'il a supprimé quelque chose, tu reçois une notification ntfy sur le sujet admin.

### 1. Créer un dépôt **privé**

1. Sur https://github.com, clique sur **New repository**.
2. Nom : `esetec-outils`. Coche **Private** (obligatoire : les journaux d'exécution contiennent des noms et emails de vendeurs).
3. Clique sur **Create repository**.

### 2. Envoyer les fichiers

Sur la page du dépôt : **Add file → Upload files**, puis glisse :

```
nettoyage.js
package.json
README.md
.gitignore
.github/workflows/nettoyage.yml
```

Le fichier `.github/workflows/nettoyage.yml` doit garder exactement ce chemin. Si l'envoi par glisser-déposer ne crée pas les dossiers, fais **Add file → Create new file**, tape le nom `.github/workflows/nettoyage.yml` (les `/` créent les dossiers) et colle son contenu.

**N'envoie jamais `cle.json`** sur GitHub, même dans un dépôt privé.

### 3. Donner la clé à GitHub (en secret)

1. Dans le dépôt : **Settings → Secrets and variables → Actions → New repository secret**.
2. Name : `FIREBASE_CLE`
3. Secret : ouvre ton `cle.json` avec le Bloc-notes, sélectionne **tout** le contenu, copie-le et colle-le ici.
4. **Add secret**.

Le secret est chiffré : personne ne peut le relire, même toi. Il n'apparaît jamais dans les journaux.

### 4. Tester tout de suite

1. Onglet **Actions** → **Nettoyage ESETEC** → **Run workflow** → **Run workflow**.
2. Attends environ 1 minute, puis ouvre l'exécution : l'étape **Nettoyer la base** affiche les mêmes listes que sur ton PC.
3. Une coche verte = tout va bien. Une croix rouge = ouvre l'étape pour lire le message d'erreur.

Ensuite, il se lance tout seul toutes les 12 heures.

### À savoir

- GitHub peut décaler l'exécution de quelques minutes à une heure quand ses serveurs sont chargés : c'est normal.
- Un dépôt privé dispose de 2 000 minutes gratuites par mois ; l'outil en utilise environ 1 par exécution, soit environ 60 par mois.
- Pour arrêter : **Actions → Nettoyage ESETEC → … → Disable workflow**.
- Si tu régénères la clé dans Firebase, remplace la valeur du secret `FIREBASE_CLE`.
- Si une clé a fuité : supprime-la dans Google Cloud (voir « Sécurité de la clé ») et crée-en une nouvelle.
