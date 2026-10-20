import { sec, type Privacy, type Terms } from "../types.js";

export const privacy: Privacy = {
  seo: {
    title: "Politique de confidentialité — AutoFlow",
    description: "Comment AutoFlow traite vos données : traitement local, compte facultatif, synchro chiffrée de bout en bout, ni publicité, ni traçage, ni revente.",
  },
  h1: "Politique de confidentialité",
  intro:
    "AutoFlow est conçu pour fonctionner d’abord sur votre appareil. Cette politique explique simplement quelles informations les apps AutoFlow pour Windows et Android, l’app web AutoFlow et ce site traitent, pourquoi, pendant combien de temps, et quels sont vos droits.",
  sections: {
    controller: sec(
      "1. Responsable du traitement",
      "Le responsable du traitement des données à caractère personnel traitées via AutoFlow est **ProjectTeamForYou** (프로젝트팀포유 ; représentant : Yusang Lee ; numéro d’enregistrement d’entreprise : 495-25-02209 ; numéro de déclaration de commerce électronique : 제2026-경북봉화-0037호 ; 1166-68 Yebong-ro, Sangun-myeon, Bonghwa-gun, Gyeongsangbuk-do, République de Corée ; téléphone : +82-70-7620-7256). Notre délégué à la protection des données est Yusang Lee (représentant). Vous pouvez nous contacter, y compris notre délégué à la protection des données, à l’adresse suivante : {email}.",
    ),
    summary: sec("2. L’essentiel", [
      "Vos flux, enregistrements, profils Keyforge et journaux d’exécution sont stockés et traités sur votre appareil.",
      "Le compte est facultatif. Si vous en créez un, nous conservons votre adresse e-mail et une empreinte de votre mot de passe.",
      "La synchro est chiffrée de bout en bout. Notre serveur ne stocke qu’un texte chiffré que nous ne pouvons pas lire.",
      "Les clés d’IA restent chiffrées sur votre appareil et ne sont envoyées qu’au fournisseur que vous choisissez.",
      "Ni publicité, ni cookies de traçage, ni profilage, ni vente de données personnelles.",
    ]),
    local: sec(
      "3. Les données qui restent sur votre appareil",
      "Flux, variables, enregistrements, captures utilisées pour la recherche d’image, résultats d’OCR, profils Keyforge, journaux Ledger, réglages et conversations Copilot sont créés et traités localement. Ils ne nous sont pas transmis, sauf si vous les synchronisez, publiez ou partagez expressément comme décrit ci-dessous.",
      "Vous pouvez les effacer à tout moment en supprimant l’élément, en effaçant les données de l’app ou en la désinstallant.",
    ),
    account: sec(
      "4. Compte facultatif",
      "Si vous créez un compte, nous traitons :",
      ["votre adresse e-mail, pour identifier votre compte, vous connecter et vous envoyer les messages indispensables (par exemple la réinitialisation du mot de passe) ;", "une empreinte du mot de passe, générée par un algorithme moderne, salé et à sens unique — nous ne stockons ni ne voyons jamais votre mot de passe ;", "des jetons de session, la date de création du compte et les appareils connectés, pour sécuriser le service."],
      "Ces informations servent uniquement au compte et à la synchro. Nous n’envoyons pas d’e-mails marketing.",
    ),
    sync: sec(
      "5. Synchro chiffrée de bout en bout",
      "Lorsque la synchro est activée, chaque flux est chiffré sur votre appareil en AES-GCM avec une clé qui ne quitte jamais vos appareils sous forme lisible. Notre serveur ne conserve que le texte chiffré et les métadonnées techniques nécessaires : identifiant, numéro de révision, empreinte du contenu, taille et horodatages.",
      "Nous ne pouvons ni lire, ni analyser, ni récupérer le contenu des flux synchronisés. Si vous perdez l’accès à tous vos appareils et à votre clé de chiffrement, les données chiffrées ne peuvent pas être restaurées.",
    ),
    atlas: sec(
      "6. Modèles publics d’Atlas",
      "Si vous publiez un modèle dans Atlas, le modèle, sa description, le nom affiché que vous choisissez et la date de publication deviennent publics. Avant publication, le serveur le valide, recherche les erreurs et lui attribue une étiquette de risque. Vos notes et signalements sont conservés avec votre compte pour prévenir les abus.",
      "Vous pouvez dépublier vos modèles à tout moment. Les copies déjà téléchargées par d’autres restent sur leurs appareils.",
    ),
    share: sec(
      "7. Liens et fichiers de partage",
      "Un lien de partage ou un fichier exporté contient le flux lui-même, compressé et encodé, avec une empreinte de son contenu. Toute personne qui détient le lien ou le fichier peut lire le flux : ne partagez donc pas de flux contenant des secrets. À l’ouverture d’un lien, le flux est décodé dans le navigateur ou l’app du destinataire.",
    ),
    ai: sec(
      "8. Copilot et vos clés d’IA",
      "Copilot fonctionne avec le fournisseur d’IA de votre choix (par exemple un service compatible OpenAI, Anthropic ou un modèle local comme Ollama ou LM Studio). Votre clé d’API est stockée uniquement sur votre appareil, chiffrée (clé WebCrypto non exportable dans le navigateur, Gestionnaire d’identifiants Windows, Android Keystore).",
      "Les requêtes et le contexte que vous approuvez sont envoyés directement de votre appareil à ce fournisseur. Nous ne recevons jamais vos clés, requêtes ou réponses. Avant l’envoi, Copilot indique ce qui sera envoyé et à qui. Ce que reçoit le fournisseur est soumis à sa propre politique de confidentialité. En mode local uniquement, les appels externes sont bloqués.",
    ),
    android: sec(
      "9. Android : information sur le service d’accessibilité",
      "AutoFlow pour Android utilise l’API AccessibilityService d’Android, seul moyen offert par Android pour qu’une app effectue des appuis, balayages et actions globales à votre place. Nous l’utilisons pour :",
      ["exécuter les gestes et actions globales (Retour, Accueil, etc.) contenus dans les flux que vous lancez ;", "lire le texte à l’écran uniquement pendant l’exécution d’un flux et seulement si une étape que vous avez ajoutée l’exige (par exemple « attendre que ce texte apparaisse ») ;", "détecter l’app au premier plan, uniquement pour lancer les flux à déclencheur par app que vous avez configurés."],
      "Ce service ne collecte, ne stocke, ne partage ni ne transmet **aucune** donnée personnelle ou sensible, n’enregistre pas vos frappes, ne lit pas les champs de mot de passe et n’est pas utilisé à des fins publicitaires. Il reste désactivé tant que vous ne l’activez pas, et vous pouvez le désactiver à tout moment dans Paramètres › Accessibilité. AutoFlow demande aussi l’autorisation de superposition (bouton d’arrêt flottant) et celle des notifications (état d’exécution), que vous contrôlez.",
    ),
    windows: sec(
      "10. Windows : information sur les hooks de saisie",
      "Pour offrir les raccourcis globaux, le remappage Keyforge et l’enregistreur, AutoFlow pour Windows installe des hooks clavier et souris de bas niveau tant que ces fonctions sont actives. Les événements de saisie sont traités en mémoire sur votre PC pour détecter vos raccourcis et remappages ; ils ne sont ni journalisés ni transmis.",
      "L’enregistreur ne capture les saisies que pendant l’enregistrement, tant que son indicateur est visible. Le texte saisi dans les champs de mot de passe est masqué dans les enregistrements.",
    ),
    website: sec(
      "11. Ce site et l’app web",
      "Nous n’utilisons ni cookies de traçage, ni pixels publicitaires, ni outils d’analyse tiers. Le site enregistre votre choix de thème et de langue dans le stockage local du navigateur, qui ne quitte jamais votre appareil. L’app web stocke vos flux dans le stockage du navigateur (IndexedDB).",
      "Notre hébergeur traite des données techniques comme l’adresse IP, le type de navigateur et l’URL demandée pour servir les pages et les protéger contre les attaques. Ces journaux sont conservés peu de temps, à des fins de sécurité uniquement.",
    ),
    noSale: sec(
      "12. Ni publicité ni revente",
      "AutoFlow ne contient aucune publicité. Nous ne vendons, ne louons ni ne partageons de données personnelles à des fins de publicité comportementale, et nous ne dressons pas de profil de vous.",
    ),
    processors: sec(
      "13. Sous-traitants",
      "Nous faisons appel à un petit nombre de prestataires qui traitent des données pour notre compte, sous obligations contractuelles de confidentialité et de sécurité :",
      ["**Cloudflare, Inc.** — hébergement du site et de l’app web, diffusion de contenu et protection contre les attaques ;", "**Railway Corporation** — hébergement de l’API et de la base de données AutoFlow (données de compte, données de synchro chiffrées, Atlas).", "Les téléchargements passent par **GitHub** (Windows) et **Google Play** (Android), qui traitent vos données selon leurs propres politiques.", "**PortOne** (Korea PortOne Inc.) et **NHN KCP Corp.** — paiements par carte en wons coréens pour l’offre Business ; **PayPal** — paiements dans d’autres devises. Ils reçoivent les informations de paiement que vous saisissez sur leurs pages ; nous ne recevons que le résultat du paiement (montant, statut, identifiant de paiement et e-mail du compte), jamais votre numéro de carte."],
    ),
    transfers: sec(
      "14. Transferts internationaux",
      "Nos prestataires peuvent traiter des données aux États-Unis et dans d’autres pays que le vôtre. Lorsque la loi l’exige, nous nous appuyons sur des garanties appropriées, telles que les clauses contractuelles types de la Commission européenne et l’addendum britannique sur les transferts internationaux, et nous vous informons des transferts comme l’exigent les lois coréenne et japonaise. Les flux synchronisés sont chiffrés avant de quitter votre appareil.",
    ),
    retention: sec("15. Durées de conservation", [
      "Données de compte : tant que le compte existe.",
      "Données de synchro chiffrées : jusqu’à ce que vous supprimiez l’élément ou le compte.",
      "Après suppression du compte : effacement immédiat des systèmes actifs et des sauvegardes sous 30 jours.",
      "Modèles Atlas : jusqu’à leur dépublication ou la suppression du compte ; signalements d’abus : un an maximum.",
      "Journaux de sécurité : 30 jours maximum, sauf besoin d’enquête sur un incident précis.",
      "Données de paiement (commandes de l’offre Business) : 5 ans, comme l’exige la loi coréenne sur la protection des consommateurs dans le commerce électronique — y compris après la suppression du compte —, puis suppression.",
    ]),
    rights: sec(
      "16. Vos droits",
      "Selon votre lieu de résidence, vous disposez d’un droit d’accès, de rectification, d’effacement, de portabilité, de limitation et d’opposition, ainsi que du droit de retirer votre consentement à tout moment. Vous pouvez exporter tous vos flux depuis l’app et supprimer votre compte dans les réglages. Pour toute autre demande, écrivez à {email}. Nous répondons sous 30 jours et pouvons vous demander de justifier de votre identité. Exercer vos droits ne vous vaudra jamais un traitement différent.",
    ),
    gdpr: sec(
      "17. Espace économique européen et Royaume-Uni (RGPD / UK GDPR)",
      "Nous traitons les données de compte et de synchro pour exécuter notre contrat avec vous (art. 6.1.b), les journaux de sécurité et la prévention des abus sur la base de notre intérêt légitime à sécuriser le service (art. 6.1.f), et tout élément facultatif sur la base de votre consentement (art. 6.1.a), retirable à tout moment. Vous pouvez introduire une réclamation auprès de votre autorité de protection des données (en France, la CNIL) ou de l’ICO au Royaume-Uni.",
    ),
    pipa: sec(
      "18. République de Corée (PIPA)",
      "Données collectées : adresse e-mail et empreinte du mot de passe (nécessaires au compte), données de synchro chiffrées et journaux de service. Finalités : gestion du compte, synchro et sécurité. Conservation et destruction : voir la section 15 ; les fichiers électroniques sont détruits de façon irrécupérable. Nous ne communiquons pas de données à des tiers hors des cas décrits ici ou imposés par la loi ; sous-traitance et transferts à l’étranger : sections 13 et 14. Responsable de la protection des données : ProjectTeamForYou, {email}.",
      "Vous pouvez aussi vous adresser au Centre de signalement des atteintes aux données personnelles (privacy.kisa.or.kr, tél. 118) ou au Comité de médiation des litiges relatifs aux données personnelles (www.kopico.go.kr, 1833-6972).",
    ),
    appi: sec(
      "19. Japon (APPI)",
      "Nous n’utilisons les informations personnelles qu’aux fins indiquées dans cette politique et ne les communiquons pas à des tiers sans consentement, sauf exceptions légales. Les prestataires et les pays de traitement figurent aux sections 13 et 14. Vous pouvez demander la communication, la correction, la suspension d’utilisation ou la suppression de vos données en écrivant à {email}.",
    ),
    lgpd: sec(
      "20. Brésil (LGPD)",
      "Nous traitons les données sur le fondement de l’exécution du contrat, de l’intérêt légitime et du consentement. Vous pouvez exercer les droits de l’article 18 de la LGPD — confirmation, accès, correction, anonymisation, portabilité, suppression, information sur le partage et retrait du consentement — auprès de notre contact protection des données à {email}. Vous pouvez aussi saisir l’ANPD.",
    ),
    ccpa: sec(
      "21. Californie (CCPA / CPRA)",
      "Au cours des 12 derniers mois, nous avons collecté des identifiants (adresse e-mail) et une activité internet limitée aux journaux de sécurité, aux fins décrites ci-dessus. Nous ne vendons ni ne partageons d’informations personnelles et n’utilisons pas d’informations sensibles pour déduire des caractéristiques. Vous avez le droit de savoir, de supprimer et de corriger vos informations, sans discrimination. Vous pouvez passer par un mandataire autorisé ; nous vérifions les demandes avant d’y donner suite.",
    ),
    security: sec("22. Sécurité", [
      "chiffrement TLS de tout le trafic et en-têtes de sécurité stricts sur nos sites ;", "chiffrement de bout en bout des flux synchronisés et chiffrement sur l’appareil des clés d’IA ;", "empreintes de mots de passe salées, limitation de débit et protection contre les attaques automatisées ;", "accès à moindre privilège aux systèmes de production et mises à jour régulières des dépendances.",
    ], "Aucun système n’est parfaitement sûr. Si une violation touche vos données personnelles, nous vous en informerons, ainsi que les autorités, comme la loi l’exige."),
    children: sec(
      "23. Mineurs",
      "AutoFlow ne s’adresse pas aux enfants de moins de 13 ans. Il faut avoir au moins 13 ans pour créer un compte — ou 16 ans dans l’EEE et au Royaume-Uni (ou l’âge inférieur fixé par votre pays ; 15 ans en France) et 14 ans en Corée — sauf consentement d’un parent ou tuteur légal. Si nous apprenons qu’un compte d’enfant existe sans le consentement requis, nous le supprimons.",
    ),
    changes: sec(
      "24. Modifications",
      "Toute modification sera publiée sur cette page avec une nouvelle date d’entrée en vigueur. Si une modification change sensiblement l’usage de vos informations, nous l’annoncerons dans l’app ou par e-mail avant son application.",
    ),
    contact: sec("25. Contact", "ProjectTeamForYou · {email}"),
  },
};

export const terms: Terms = {
  seo: {
    title: "Conditions d’utilisation — AutoFlow",
    description: "Les règles d’AutoFlow : licence, usage acceptable, responsabilité des automatisations, IA, modèles, garanties, responsabilité et droit coréen.",
  },
  h1: "Conditions d’utilisation",
  intro:
    "Les présentes Conditions régissent votre utilisation d’AutoFlow — les apps Windows et Android, l’app web, l’API AutoFlow, Atlas et ce site (ensemble, le « Service »). Prenez le temps de les lire : elles ont été écrites pour être comprises.",
  sections: {
    agreement: sec(
      "1. Acceptation",
      "Le Service est fourni par **ProjectTeamForYou** (« nous »). En installant, en consultant ou en utilisant le Service, vous acceptez les présentes Conditions et notre Politique de confidentialité. Si vous n’êtes pas d’accord, n’utilisez pas le Service.",
    ),
    service: sec(
      "2. Le Service",
      "AutoFlow vous permet de créer, répéter, exécuter et partager des automatisations (« flux ») : autoclics, macros, raccourcis, remappage de touches, routines. Les fonctions peuvent varier selon la plateforme. Le Service est gratuit pour usage personnel ; tout autre usage requiert une licence Business (Section 10). Certaines fonctions optionnelles comme la synchro chiffrée nécessitent un compte.",
    ),
    eligibility: sec(
      "3. Conditions d’accès et comptes",
      "Vous devez avoir au moins 13 ans pour utiliser le Service, ou davantage si la loi de votre pays l’exige (16 ans dans l’EEE et au Royaume-Uni, 14 ans en Corée), sauf consentement d’un parent ou tuteur légal. Vous êtes responsable de la confidentialité de vos identifiants et de votre clé de chiffrement, ainsi que de l’activité de votre compte.",
    ),
    license: sec(
      "4. Licence",
      "Nous vous accordons une licence personnelle, mondiale, non exclusive, non transférable et révocable pour installer et utiliser le Service conformément aux présentes Conditions : gratuite pour usage personnel, et pour usage non personnel uniquement si vous détenez une licence Business valide (Section 10). Vous ne pouvez ni vendre, ni sous-licencier, ni redistribuer les apps, ni les décompiler sauf dans la mesure permise par la loi malgré cette restriction.",
    ),
    acceptable: sec(
      "5. Usage acceptable",
      "Vous ne devez pas utiliser le Service pour :",
      [
        "contourner, résoudre ou déjouer des CAPTCHA, vérifications d’identité, confirmations de paiement ou autres mesures de sécurité ;",
        "contourner des systèmes anti-triche ou obtenir un avantage déloyal dans des jeux où l’automatisation est interdite ;",
        "enfreindre les conditions d’utilisation d’apps, de jeux ou de sites tiers ;",
        "envoyer du spam, créer des comptes automatiquement, gonfler des vues, votes ou autres indicateurs, ou commettre une fraude ;",
        "accéder sans autorisation à des systèmes ou données, collecter des données personnelles sans consentement ou diffuser des logiciels malveillants ;",
        "harceler, nuire à autrui ou tromper, ou commettre tout acte illégal ;",
        "surcharger, attaquer ou perturber le Service ou son infrastructure, ou abuser d’Atlas, des signalements ou des notes.",
      ],
      "Nous pouvons bloquer les flux, modèles ou comptes qui enfreignent ces règles.",
    ),
    responsibility: sec(
      "6. Vous êtes responsable de vos automatisations",
      "C’est vous qui décidez de ce que font vos flux et de l’endroit où ils s’exécutent. Vous êtes responsable des flux que vous créez, importez, exécutez et partagez, ainsi que de leurs conséquences — actions dans des apps tierces, achats, messages envoyés, données modifiées, restrictions de compte imposées par d’autres. Testez les flux nouveaux ou importés sur Practice Canvas, consultez leur score de sécurité et gardez Halt à portée de main.",
    ),
    ai: sec(
      "7. Copilot et résultats de l’IA",
      "Copilot utilise le fournisseur d’IA que vous choisissez et configurez avec votre propre clé ou un modèle local. Les résultats de l’IA peuvent être faux, incomplets ou dangereux. Les brouillons sont validés et notés, mais vous devez relire chacun d’eux avant de l’enregistrer ou de l’exécuter. L’usage du fournisseur est soumis à ses propres conditions et les frais qu’il facture sont à votre charge.",
    ),
    content: sec(
      "8. Vos contenus, les modèles et la modération",
      "Vous conservez tous les droits sur les flux et autres contenus que vous créez. En publiant un modèle dans Atlas, vous nous accordez une licence mondiale, gratuite et non exclusive pour l’héberger, le stocker, l’afficher, le mettre en forme et le diffuser au sein du Service tant qu’il est publié, et vous accordez aux autres utilisateurs une licence pour l’utiliser, le copier et le modifier pour leurs propres automatisations.",
      "Vous garantissez détenir les droits sur ce que vous publiez et que ce contenu respecte les présentes Conditions. Pour garder Atlas sûr, nous pouvons examiner, étiqueter, masquer ou retirer des modèles et suspendre le droit de publier — par exemple pour des modèles à risque élevé, trompeurs, contrefaisants ou abusifs. Vous pouvez signaler un contenu dans l’app ou à {email}. Les modèles officiels sont fournis à titre d’exemple et peuvent nécessiter des ajustements.",
    ),
    sync: sec(
      "9. Synchro et disponibilité",
      "La synchro chiffrée est optionnelle. Elle est gratuite pour usage personnel ; l’usage non personnel de la synchro est couvert par la licence Business (Section 10). Nous faisons en sorte que le Service reste disponible, mais il peut être interrompu pour maintenance, panne ou cause indépendante de notre volonté. La synchro étant chiffrée de bout en bout, nous ne pouvons pas récupérer vos données si vous perdez vos clés. Exportez les flux importants.",
    ),
    fees: sec(
      "10. Tarifs, licence Business et remboursements",
      "AutoFlow est gratuit pour usage personnel, c’est-à-dire l’utilisation par une personne pour ses propres besoins non commerciaux. Tout autre usage (« usage non personnel ») — pour une entreprise, une organisation ou un organisme public, ou à toute fin commerciale ou lucrative, y compris l’utilisation par des employés ou sous-traitants dans le cadre de leur travail — requiert une licence Business payante par compte utilisateur à partir du 20 octobre 2026 à 00:00 (heure de Corée). Vous choisissez votre type d’usage dans l’app et devez le faire honnêtement et le maintenir exact. Les fonctions de l’app restent disponibles hors ligne quel que soit votre choix : la licence Business fonctionne sur la base de la confiance pour les fonctions hors ligne et est appliquée pour la synchro, où les nouveaux envois par des comptes professionnels sans licence valide sont suspendus.",
      "La licence Business est vendue en achat unique de 1 ou 12 mois. Dans l’app en coréen, le paiement se fait via PortOne (paiement carte KCP en wons) ; dans toutes les autres langues via PayPal (dollars US). Le prix, taxes incluses, est affiché avant paiement. Il n’y a pas de renouvellement automatique et nous ne stockons pas votre carte ; un nouvel achat prolonge votre période en cours. Chaque achat fournit une clé de licence comme preuve. Une clé de licence émise par nous peut être activée une fois, sur un seul compte, et prolonge la licence Business de ce compte de la durée correspondante.",
      "Rétractation : en vertu de la loi coréenne sur la protection des consommateurs dans le commerce électronique, vous pouvez vous rétracter dans les 7 jours suivant le paiement et obtenir un remboursement intégral. L’offre Business étant un contenu numérique fourni dès le paiement, le droit de rétractation prend fin dès que vous commencez à l’utiliser après le paiement (par exemple en envoyant des données vers la synchronisation pour un usage professionnel), à condition que vous l’ayez accepté lors du paiement ; jusque-là, vous pouvez vous rétracter à tout moment. Si le service diffère de ce qui était affiché, annoncé ou convenu, vous pouvez vous rétracter dans les 3 mois suivant sa fourniture, ou dans les 30 jours suivant le moment où vous l’avez su ou auriez pu le savoir. Demandez vos remboursements à {email} ; nous remboursons par le moyen de paiement d’origine dans les 3 jours ouvrables suivant la confirmation de la rétractation.",
      "Si nous ne pouvons pas fournir la synchro pour des raisons qui nous sont imputables, ou si nous arrêtons la licence Business, nous remboursons au prorata la partie non utilisée de votre période. Ne pas payer ne bloque jamais vos données : lecture, export et suppression des données synchronisées restent toujours possibles. Si nous modifions les prix ou introduisons de nouvelles fonctions payantes, nous l’annoncerons à l’avance, cela ne s’appliquera pas aux périodes déjà payées, et l’usage personnel de l’automatisation locale, Halt et l’export restera gratuit.",
      "La section 14 (absence de compensation) s’applique aussi aux offres payantes, mais elle ne limite ni les remboursements décrits dans la présente section ni vos droits au titre du droit de la consommation.",
    ),
    ip: sec(
      "11. Notre propriété intellectuelle",
      "Le nom, le logo, les logiciels, les modèles officiels et le site AutoFlow appartiennent à ProjectTeamForYou ou à ses concédants et sont protégés par la loi. Les présentes Conditions ne vous confèrent aucun droit sur nos marques. Si vous nous faites part de suggestions, nous pouvons les utiliser sans obligation envers vous.",
    ),
    thirdParty: sec(
      "12. Services tiers",
      "Le Service interagit avec des services que nous ne contrôlons pas, comme votre système d’exploitation, Google Play, GitHub, les fournisseurs d’IA et les apps que vous automatisez. Leur utilisation relève de leurs propres conditions et politiques, et nous n’en sommes pas responsables.",
    ),
    disclaimer: sec(
      "13. Exclusion de garanties",
      "Dans toute la mesure permise par la loi, le Service est fourni « en l’état » et « selon disponibilité », sans garantie d’aucune sorte, expresse ou implicite, notamment de qualité marchande, d’adéquation à un usage particulier ou d’absence de contrefaçon. Nous ne garantissons pas que les flux se comportent à l’identique sur tous les appareils ni que le Service soit exempt d’erreurs. Rien ici ne limite les droits que vous confère le droit de la consommation et qui ne peuvent être exclus, notamment la garantie légale de conformité.",
    ),
    liability: sec(
      "14. Absence de compensation et limitation de responsabilité",
      "AutoFlow est fourni gratuitement et « en l’état ». Dans la mesure maximale permise par la loi, nous n’offrons aucune compensation et déclinons toute responsabilité pour tout dommage — direct, indirect, accessoire, spécial, consécutif ou punitif — y compris la perte de bénéfices, de données, de comptes ou de clientèle, résultant du Service, des automatisations que vous créez ou exécutez, ou des modèles, résultats générés par l’IA ou services tiers. Vous utilisez les automatisations à vos propres risques et devez les vérifier avant de les exécuter. La présente clause n’exclut pas la responsabilité qui ne peut être exclue en vertu du droit applicable, telle que la responsabilité en cas d’intention ou de faute lourde, ou les droits impératifs des consommateurs.",
    ),
    indemnity: sec(
      "15. Garantie",
      "Dans la mesure permise par la loi, vous acceptez de nous indemniser des réclamations de tiers résultant de vos flux, de vos contenus ou de votre violation des présentes Conditions.",
    ),
    termination: sec(
      "16. Résiliation",
      "Vous pouvez cesser d’utiliser le Service à tout moment et supprimer votre compte dans les réglages de l’app. Nous pouvons suspendre ou résilier l’accès en cas de manquement grave ou répété aux présentes Conditions, si la loi l’exige ou si nous arrêtons le Service — en vous prévenant alors dans un délai raisonnable, si possible, pour que vous puissiez exporter vos données. Les clauses qui, par nature, doivent survivre à la résiliation restent applicables.",
    ),
    changes: sec(
      "17. Modification des Conditions",
      "Nous pouvons modifier les présentes Conditions. Les changements seront publiés sur cette page au moins 7 jours avant leur entrée en vigueur, ou au moins 30 jours avant s’ils vous sont défavorables, et les titulaires de compte seront informés des changements importants. Continuer à utiliser le Service après leur entrée en vigueur vaut acceptation ; sinon, cessez de l’utiliser.",
    ),
    law: sec(
      "18. Droit applicable et litiges",
      "Les présentes Conditions sont régies par le droit de la République de Corée. Tout litige lié au Service sera soumis au tribunal de district central de Séoul en première instance, sans préjudice des règles impératives de protection des consommateurs ni de la compétence des tribunaux de votre pays de résidence lorsque la loi vous l’accorde. Contactez-nous d’abord : la plupart des problèmes se règlent vite.",
    ),
    misc: sec(
      "19. Dispositions diverses",
      "Si une clause est jugée inapplicable, les autres restent en vigueur. Ne pas faire valoir une clause ne vaut pas renonciation. Vous ne pouvez pas céder vos droits sans notre accord ; nous pouvons les céder dans le cadre d’une réorganisation ou d’une cession. Ces Conditions existent en 12 langues ; en cas de divergence, la version anglaise prévaut, sauf disposition contraire de la loi de votre pays.",
    ),
    contact: sec("20. Contact", "ProjectTeamForYou · {email}"),
  },
};
