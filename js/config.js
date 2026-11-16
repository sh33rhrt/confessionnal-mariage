// Réglages du confessionnal. Modifiez ce fichier avant le mariage.
export const CONFIG = {
  // Code à 4 chiffres pour ouvrir les coulisses (appui long 3 s sur la date de l'accueil).
  ADMIN_PIN: '2304',

  // Matériel attendu. Les noms viennent de la liste des appareils de l'iPad.
  // L'écran Coulisses permet aussi de choisir la caméra et le micro à la main.
  CAMERA_MATCH: /osmo|pocket|dji/i,
  MIC_MATCH: /dji|wireless|mic\s*2|rx/i,
  MIC_EXCLUDE: /ipad|iphone|built-?in|intégr|default|par défaut/i,

  // Durées (secondes)
  MAX_SECONDS: 300,        // arrêt automatique à 5:00
  WARN_SECONDS: 30,        // bandeau « Plus que 30 secondes »
  STOP_ENABLED_AFTER: 3,   // « Terminer » actif après 3 s
  STOP_HOLD_MS: 1000,      // appui maintenu pour terminer
  COUNTDOWN: 3,
  MERCI_SECONDS: 20,       // retour à l'accueil après le merci
  IDLE_SECONDS: 60,        // accueil / consignes sans contact → écran de veille
  SILENCE_SECONDS: 30,     // silence en pleine prise → alerte
  TEST_SECONDS: 10,        // mode test

  // Enregistrement
  VIDEO_BITRATE: 4_000_000,
  AUDIO_BITRATE: 128_000,
  CHUNK_MS: 1000,

  // Stockage de l'iPad
  STORAGE_BLOCK_BYTES: 1.5e9, // en dessous : on ne filme plus
  STORAGE_WARN_BYTES: 3e9,    // en dessous : alerte

  // Alertes
  NOTIFY_URL: '/.netlify/functions/notify',
  NOTIFY_KEY: 'change-moi',         // même valeur que NOTIFY_KEY dans Netlify
  REMINDER_MINUTES: 60,             // rappel d'export
  HEALTHCHECK_URL: '',              // ex. https://hc-ping.com/xxxxxxxx (laisser vide pour désactiver)
  HEARTBEAT_SECONDS: 60,

  // Mode démo (ordinateur, sans DJI) : ajoutez ?demo à l'adresse.
  DEMO: typeof location !== 'undefined' && /[?&]demo\b/.test(location.search)
};
