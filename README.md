# Le Confessionnal — Yousra & Dany

Coin « confessionnal de téléréalité » pour le mariage du 23 avril 2027.
Une app web en paysage pour iPad. L'iPad sert de console et d'écran, l'Osmo Pocket 3 de caméra, le DJI Mic 2 de micro.

- Les invités laissent un message vidéo de 5 minutes maximum.
- Les vidéos restent sur l'iPad, puis sont exportées vers iCloud Drive depuis les coulisses.
- Personne ne peut revoir ni supprimer une vidéo depuis l'app.
- Les alertes (panne, silence, rappel d'export toutes les heures) arrivent sur Telegram.

Pas de build : HTML, CSS et JavaScript, hébergés sur Netlify.

## Parcours

Ouverture → Accueil → Consignes et test du micro → Compte à rebours (3 s) → Enregistrement → Merci → Accueil.

- **Arrêt** : automatique à 5:00, ou en maintenant « Terminer » pendant 1 s. Le bouton est actif au bout de 3 s.
- **Fin de prise** : bandeau et double bip à 30 s de la fin.
- **Veille** : après 1 min sans contact sur l'accueil ou les consignes, l'écran de veille avec les chats s'affiche.
- **Panne** : si le micro, la caméra ou le stockage manque, on ne filme pas, l'écran « Petite pause technique » s'affiche et une alerte part. En pleine prise, ce qui a été filmé est conservé.
- **Plantage** : chaque vidéo est écrite sur l'iPad seconde par seconde. Si Safari redémarre, la vidéo en cours est récupérée.
- **Noms de fichiers** : `2027-04-23_21h34_017.mp4`.

## Coulisses

Appui long de 3 s sur « Yousra & Dany · 23 avril 2027 », en bas à gauche de l'accueil, puis le code.
Sur les écrans de pause et de fermeture, l'appui long se fait sur le titre.

- **Ouvert / Pause / Fermé** : « Pause » sert pendant les discours, « Fermé » en fin de soirée.
- **Matériel** : état de la caméra et du micro, choix manuel des appareils, niveau du son, place libre.
- **Mode test** : 10 s filmées puis rejouées, rien n'est gardé.
- **Exporter vers iCloud** : seules les nouvelles vidéos sont exportées.
  - « Exporter » ouvre le partage d'iPadOS : choisir « Enregistrer dans Fichiers », puis iCloud Drive.
  - « Télécharger le suivant » envoie un fichier dans iCloud Drive › Téléchargements.
  - Safari ne peut pas savoir quand iCloud a fini d'envoyer les fichiers.
- **Journal de la soirée**.

## Mise en route

### 1. Réglages (`js/config.js`)

- `ADMIN_PIN` : code des coulisses (par défaut `2304`).
- `NOTIFY_KEY` : un mot de passe au choix, à recopier dans Netlify.
- `HEALTHCHECK_URL` : adresse de ping Healthchecks.io (voir plus bas), ou vide.

### 2. Netlify

1. Créer un site Netlify à partir de ce dépôt. Rien à compiler : le dossier publié est la racine.
2. Dans *Site configuration › Environment variables*, ajouter :
   - `TELEGRAM_BOT_TOKEN` : le jeton du bot.
   - `TELEGRAM_CHAT_ID` : l'identifiant du chat. Pour prévenir plusieurs personnes, séparer les identifiants par des virgules.
   - `NOTIFY_KEY` : la même valeur que dans `config.js`.
3. Redéployer.

### 3. Bot Telegram

1. Dans Telegram, ouvrir **@BotFather**, envoyer `/newbot` et récupérer le jeton.
2. Chaque personne qui doit recevoir les alertes écrit un message au bot.
3. Ouvrir `https://api.telegram.org/bot<JETON>/getUpdates`, puis relever `chat.id` pour chaque personne.
4. Dans les coulisses, « Envoyer une alerte test » vérifie que tout fonctionne.

### 4. Alerte « l'iPad ne répond plus » (Healthchecks.io)

Un iPad sans réseau ne peut prévenir personne. L'app envoie donc un signal toutes les minutes à Healthchecks.io, qui prévient sur Telegram quand ce signal s'arrête.

1. Créer un « check » avec une période d'1 minute et une marge de 5 minutes.
2. Relier Telegram dans *Integrations*.
3. Coller l'adresse de ping dans `HEALTHCHECK_URL`.

### 5. iPad (à faire avant le jour J)

- [ ] **Safari › Caméra** et **Safari › Micro** : *Autoriser* pour le site, sinon Safari demande l'autorisation devant les invités.
- [ ] **Safari › Téléchargements** : *iCloud Drive*.
- [ ] Ouvrir le site dans **Safari**, pas depuis l'écran d'accueil : depuis iPadOS 26, la caméra peut s'afficher tournée de 90° quand on ouvre le site depuis l'écran d'accueil.
- [ ] **Accessibilité › Accès guidé** :
  - activer et définir un code ;
  - régler le verrouillage automatique de l'écran sur *Jamais* ;
  - au lancement : entourer la barre d'adresse et la barre d'onglets ;
  - dans *Options* : couper les boutons de veille et de volume, ainsi que la rotation de l'écran.
- [ ] Matériel :
  - hub USB-C avec recharge, branché sur secteur ;
  - Osmo Pocket 3 en **mode Webcam** ;
  - récepteur DJI Mic 2 branché sur le hub ;
  - émetteur du micro branché sur une recharge.
- [ ] Coulisses › **Mode test**, puis un faux message complet, puis un export vers iCloud.

### 6. Le jour J

- Ouvrir le site, toucher l'écran d'ouverture et accepter caméra et micro si Safari le demande.
- Les coulisses affichent « OK » pour la caméra et le micro. Sinon, choisir les appareils à la main dans les listes.
- Toutes les heures, Telegram rappelle combien de vidéos sont à exporter.

## Essayer sur un ordinateur

Ajouter `?demo` à l'adresse : l'app accepte alors n'importe quelle caméra et n'importe quel micro, en basse définition.

```
python3 -m http.server 8000
# puis ouvrir http://localhost:8000/?demo
```

Les alertes Telegram ne partent que depuis le site Netlify.

## À vérifier sur l'iPad lui-même

Ces points ont été testés dans Chrome avec une fausse caméra, pas encore sur iPad :

- le retour caméra affiché à plusieurs endroits à la fois (consignes et enregistrement) ;
- l'enregistrement MP4 de Safari découpé en morceaux d'1 seconde ;
- le partage de plusieurs vidéos d'un coup vers Fichiers ;
- les noms exacts de l'Osmo Pocket et du DJI Mic dans la liste des appareils. S'ils ne sont pas reconnus, il suffit de les choisir dans les coulisses.

## Fichiers

```
index.html                    tous les écrans
css/app.css                   styles (DA du site RSVP)
js/config.js                  réglages
js/app.js                     parcours, enregistrement, coulisses, export, alertes
js/db.js                      stockage des vidéos sur l'iPad (IndexedDB)
js/cats.js                    écran de veille
sw.js                         fonctionnement hors ligne
netlify/functions/notify.mjs  relais vers Telegram
```
