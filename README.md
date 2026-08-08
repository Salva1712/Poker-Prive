# Poker Privé

MVP de table privée Texas Hold'em avec jetons virtuels.

## Fonctions
- Création d'une table privée avec code à 6 caractères
- Jusqu'à 9 joueurs
- Administrateur principal
- Attribution/retrait de jetons virtuels par l'administrateur
- Réglage des blinds
- Distribution privée des cartes
- Fold / Check / Call / Raise
- Flop / Turn / River
- Calcul du pot
- Détection des mains au showdown
- Gestion simplifiée des side-pots
- Chat de table
- Interface mobile

## Lancer sur ordinateur
1. Installer Node.js 18 ou plus récent
2. Ouvrir un terminal dans ce dossier
3. `npm install`
4. `npm start`
5. Ouvrir http://localhost:3000

## Mettre en ligne
Le projet peut être déployé sur un hébergeur Node.js (Render, Railway, Fly.io, etc.).
Commande de démarrage : `npm start`

## Important
Les jetons sont virtuels et ne sont pas convertibles en argent. Ce prototype n'intègre ni paiement, ni dépôt, ni retrait.
Les tables sont conservées uniquement en mémoire : si le serveur redémarre, elles disparaissent.
