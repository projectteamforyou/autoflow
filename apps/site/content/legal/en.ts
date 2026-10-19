import { sec, type Privacy, type Terms } from "../types.js";

export const privacy: Privacy = {
  seo: {
    title: "Privacy Policy — AutoFlow",
    description: "How AutoFlow handles your data: local-first processing, optional account, end-to-end encrypted sync, no ads, no tracking cookies and no sale of data.",
  },
  h1: "Privacy Policy",
  intro:
    "AutoFlow is built to work on your device first. This policy explains, in plain language, what information the AutoFlow apps for Windows and Android, the AutoFlow web app and this website process, why, for how long, and the rights you have.",
  sections: {
    controller: sec(
      "1. Who is responsible",
      "The controller of personal information processed through AutoFlow is **ProjectTeamForYou** (“we”, “us”). You can reach us, including our privacy officer, at {email}.",
    ),
    summary: sec("2. The short version", [
      "Your flows, recordings, Keyforge profiles and run logs are stored and processed on your device.",
      "An account is optional. If you create one, we store your email address and a password hash.",
      "Sync is end-to-end encrypted. Our server stores ciphertext that we cannot read.",
      "AI keys stay encrypted on your device and are sent only to the AI provider you choose.",
      "No ads, no tracking cookies, no analytics profiles and no sale of personal information.",
    ]),
    local: sec(
      "3. Data that stays on your device",
      "Flows, variables, recordings, screenshots used for image search, OCR results, Keyforge profiles, Ledger run logs, settings and Copilot conversations are created and processed locally. They are not sent to us unless you explicitly sync them, publish them or share them as described below.",
      "You can delete this data at any time by deleting the item, clearing the app’s data or uninstalling the app.",
    ),
    account: sec(
      "4. Optional account",
      "If you create an account, we process:",
      ["your email address, to identify your account, sign you in and send essential service messages (for example password reset);", "a password hash created with a modern, salted one-way algorithm — we never store or see your password itself;", "session tokens, account creation time and the devices signed in to your account, to keep the service secure."],
      "We use this information only to provide the account and sync service. We do not send marketing email.",
    ),
    sync: sec(
      "5. End-to-end encrypted sync",
      "When sync is on, each flow is encrypted on your device with AES-GCM using a key that never leaves your devices in readable form. Our server stores only the ciphertext together with technical metadata needed for sync: an item identifier, revision number, content hash, size and timestamps.",
      "We cannot read, scan or recover the contents of synced flows. If you lose access to all of your devices and your encryption key, the encrypted data cannot be restored.",
    ),
    atlas: sec(
      "6. Atlas public templates",
      "If you publish a template to Atlas, the template, its description, your chosen display name and the publication date become public. Before publication the server validates the template, checks it for errors and assigns a risk label. Ratings and reports you submit are stored with your account so we can prevent abuse.",
      "You can unpublish your templates at any time. Copies that others already downloaded remain on their devices.",
    ),
    share: sec(
      "7. Share links and files",
      "A share link or export file contains the flow itself, compressed and encoded, with a content hash. Anyone who has the link or file can read the flow, so do not share flows that contain secrets. When a share link is opened, the flow is decoded in the recipient’s browser or app.",
    ),
    ai: sec(
      "8. Copilot and your AI keys",
      "Copilot works with an AI provider you choose (for example an OpenAI-compatible service, Anthropic, or a local model such as Ollama or LM Studio). Your API key is stored on your device only, encrypted (WebCrypto non-extractable key in the browser, Windows Credential Manager, Android Keystore).",
      "Prompts and the context you approve are sent directly from your device to that provider. We never receive your keys, prompts or responses. Before sending, Copilot shows what will be sent and where. The provider’s own privacy policy applies to what it receives. In local-only mode, external calls are blocked.",
    ),
    android: sec(
      "9. Android: Accessibility service disclosure",
      "AutoFlow for Android uses the Android AccessibilityService API because it is the only way Android lets an app perform taps, swipes and global actions on your behalf. We use it to:",
      ["perform the gestures and global actions (such as Back or Home) contained in the flows you run;", "read text on the screen only while a flow is running and only when a step you added requires it (for example “wait until this text appears”);", "detect which app is in the foreground, only to start flows with app-based triggers you configured."],
      "The service does **not** collect, store, share or transmit personal or sensitive data, does not record what you type, does not read password fields and is not used for advertising. It is off until you turn it on, and you can turn it off at any time in Settings › Accessibility. AutoFlow also asks for the overlay permission (to show the floating stop button) and the notification permission (to show run status), both of which you control.",
    ),
    windows: sec(
      "10. Windows: input hooks disclosure",
      "To provide global hotkeys, Keyforge remapping and the recorder, AutoFlow for Windows installs low-level keyboard and mouse hooks while those features are enabled. Input events are processed in memory on your PC to detect your shortcuts and remaps; they are not logged and are never transmitted.",
      "The recorder captures input only while recording is on and the recording indicator is visible. Text entered into password fields is masked in recordings.",
    ),
    website: sec(
      "11. This website and the web app",
      "We do not use tracking cookies, advertising pixels or third-party analytics. The website stores your theme and language choice in your browser’s local storage; this never leaves your device. The web app stores your flows in your browser’s storage (IndexedDB).",
      "Our hosting provider processes technical data such as IP address, browser type and requested URL to deliver pages and protect against attacks. These logs are kept for a short period for security purposes only.",
    ),
    noSale: sec(
      "12. No ads, no sale of data",
      "AutoFlow contains no advertising. We do not sell, rent or share personal information for cross-context behavioural advertising, and we do not build profiles about you.",
    ),
    processors: sec(
      "13. Service providers",
      "We use a small number of providers that process data on our behalf under contractual confidentiality and security obligations:",
      ["**Cloudflare, Inc.** — website and web app hosting, content delivery and attack protection;", "**Railway Corporation** — hosting of the AutoFlow API and database (account data, encrypted sync data, Atlas).", "Downloads are provided through **GitHub** (Windows) and **Google Play** (Android); those services process your data under their own privacy policies."],
    ),
    transfers: sec(
      "14. International transfers",
      "Our providers may process data in the United States and other countries outside your own. Where the law requires it, we rely on appropriate safeguards such as the European Commission’s Standard Contractual Clauses and the UK International Data Transfer Addendum, and we inform you of transfers as required by Korean and Japanese law. Synced flows are encrypted before they leave your device.",
    ),
    retention: sec("15. How long we keep data", [
      "Account data: for as long as your account exists.",
      "Encrypted sync data: until you delete the item or your account.",
      "After account deletion: removed from active systems immediately and from backups within 30 days.",
      "Atlas templates: until you unpublish them or delete your account; abuse reports for up to one year.",
      "Security logs: up to 30 days, unless needed longer to investigate a specific incident.",
    ]),
    rights: sec(
      "16. Your rights",
      "Depending on where you live, you have the right to access, correct, delete, export (portability), restrict or object to the processing of your personal information, and to withdraw consent at any time. You can export every flow from the app at any time and delete your account in the app’s settings. For anything else, email {email}. We answer within 30 days and may ask you to verify your identity. We will never treat you differently for exercising your rights.",
    ),
    gdpr: sec(
      "17. European Economic Area and United Kingdom (GDPR / UK GDPR)",
      "We process account and sync data to perform our contract with you (Art. 6(1)(b)), security logs and abuse prevention on the basis of our legitimate interests in keeping the service safe (Art. 6(1)(f)), and anything optional on the basis of your consent (Art. 6(1)(a)), which you can withdraw at any time. You have the right to lodge a complaint with your local data protection authority or the UK Information Commissioner’s Office.",
    ),
    pipa: sec(
      "18. Republic of Korea (PIPA)",
      "Items collected: email address and password hash (required for an account); encrypted sync data and service logs. Purpose: account management, sync and security. Retention and destruction: as in section 15; electronic files are deleted using methods that make them unrecoverable. We do not provide personal information to third parties except as described in this policy or required by law, and overseas transfers are described in sections 13–14. Privacy officer: ProjectTeamForYou, {email}.",
      "For help with privacy infringements you may also contact the Personal Information Infringement Report Center (privacy.kisa.or.kr, call 118) or the Personal Information Dispute Mediation Committee (www.kopico.go.kr, 1833-6972).",
    ),
    appi: sec(
      "19. Japan (APPI)",
      "We use personal information only for the purposes stated in this policy and do not provide it to third parties without consent except as permitted by law. Information about the providers we use and the countries where data is processed is set out in sections 13–14. You may request disclosure, correction, suspension of use or deletion of your retained personal data by contacting {email}.",
    ),
    lgpd: sec(
      "20. Brazil (LGPD)",
      "We process data on the legal bases of contract performance, legitimate interest and consent. You may exercise the rights under Article 18 of the LGPD — confirmation, access, correction, anonymisation, portability, deletion, information about sharing and withdrawal of consent — by contacting our data protection contact at {email}. You may also file a complaint with the ANPD.",
    ),
    ccpa: sec(
      "21. California (CCPA / CPRA)",
      "In the past 12 months we have collected identifiers (email address) and internet activity limited to security logs, for the business purposes described above. We do not sell or share personal information and do not use sensitive personal information to infer characteristics. You have the right to know, delete and correct your information and to not be discriminated against for using these rights. You may use an authorised agent; we will verify requests before acting on them.",
    ),
    security: sec("22. Security", [
      "TLS encryption for all network traffic and strict security headers on our sites;", "end-to-end encryption of synced flows and on-device encryption of AI keys;", "salted password hashing, rate limiting and protection against automated attacks;", "least-privilege access to production systems and regular dependency updates.",
    ], "No system is perfectly secure. If a breach affects your personal information, we will notify you and the authorities as required by law."),
    children: sec(
      "23. Children",
      "AutoFlow is not directed at children under 13. You must be at least 13 to create an account — or at least 16 in the EEA and the UK (or the lower age of digital consent in your country), and at least 14 in Korea — unless a parent or legal guardian consents. If we learn that we hold an account of a child without required consent, we will delete it.",
    ),
    changes: sec(
      "24. Changes to this policy",
      "We will post any changes on this page and update the effective date. If a change materially affects how we use your information, we will announce it in the app or by email before it takes effect.",
    ),
    contact: sec("25. Contact", "ProjectTeamForYou · {email}"),
  },
};

export const terms: Terms = {
  seo: {
    title: "Terms of Service — AutoFlow",
    description: "The rules for using AutoFlow: your licence, acceptable use, responsibility for automations, AI output, templates, warranties, liability and Korean law.",
  },
  h1: "Terms of Service",
  intro:
    "These Terms govern your use of AutoFlow — the Windows and Android apps, the web app, the AutoFlow API, Atlas and this website (together, the “Service”). Please read them; they are written to be understood.",
  sections: {
    agreement: sec(
      "1. Agreement",
      "The Service is provided by **ProjectTeamForYou** (“we”, “us”). By installing, accessing or using the Service you agree to these Terms and to our Privacy Policy. If you do not agree, do not use the Service.",
    ),
    service: sec(
      "2. The Service",
      "AutoFlow lets you create, rehearse, run and share automations (“flows”) such as auto-clicking, macros, hotkeys, key remapping and routines. Features may differ by platform. The Service is free; optional features such as encrypted sync require an account.",
    ),
    eligibility: sec(
      "3. Eligibility and accounts",
      "You must be at least 13 years old to use the Service, or older where the law of your country requires it (16 in the EEA and UK, 14 in Korea), unless a parent or legal guardian has consented. You are responsible for keeping your login details and encryption key safe and for activity under your account.",
    ),
    license: sec(
      "4. Licence",
      "We grant you a personal, worldwide, non-exclusive, non-transferable, revocable licence to install and use the Service for personal or business purposes in accordance with these Terms. You may not sell, sublicense or redistribute the apps, or reverse engineer them except to the extent the law allows despite this restriction.",
    ),
    acceptable: sec(
      "5. Acceptable use",
      "You must not use the Service to:",
      [
        "bypass, solve or defeat CAPTCHAs, identity verification, payment confirmations or other security measures;",
        "circumvent anti-cheat systems or gain an unfair advantage in games where automation is prohibited;",
        "violate the terms of service of any third-party app, game or website;",
        "send spam, create accounts automatically, inflate views, votes or other metrics, or commit fraud;",
        "access systems or data without authorisation, collect personal data without consent, or distribute malware;",
        "harass, harm or deceive others, or do anything illegal;",
        "overload, attack or interfere with the Service or its infrastructure, or abuse Atlas, reports or ratings.",
      ],
      "We may block flows, templates or accounts that break these rules.",
    ),
    responsibility: sec(
      "6. You are responsible for your automations",
      "You decide what your flows do and where they run. You are responsible for the flows you create, import, run and share, and for their consequences — including actions in third-party apps, purchases, messages sent, data changed and account restrictions imposed by others. Test new or imported flows on Practice Canvas, check their Safety Score and keep Halt within reach.",
    ),
    ai: sec(
      "7. Copilot and AI output",
      "Copilot uses an AI provider that you choose and configure with your own key or a local model. AI output can be wrong, incomplete or unsafe. Drafts are validated and safety-scored, but you must review every draft before saving or running it. Your use of a provider is subject to that provider’s terms, and any costs it charges are yours.",
    ),
    content: sec(
      "8. Your content, templates and moderation",
      "You keep all rights to the flows and other content you create. When you publish a template to Atlas, you grant us a worldwide, royalty-free, non-exclusive licence to host, store, display, re-format and distribute it within the Service for as long as it is published, and you grant other users a licence to use, copy and modify it for their own automations.",
      "You confirm that you have the rights to what you publish and that it complies with these Terms. We may review, label, hide or remove templates, and suspend publishing rights, to keep Atlas safe — for example templates that are high-risk, misleading, infringing or abusive. You can report content through the app or at {email}. Official templates are provided as examples and may need adjustment for your setup.",
    ),
    sync: sec(
      "9. Sync and availability",
      "Encrypted sync is optional and currently free during launch. We work to keep the Service available, but it may be interrupted for maintenance, failures or reasons beyond our control. Because sync is end-to-end encrypted, we cannot recover data if you lose your keys. Keep exports of flows that matter to you.",
    ),
    fees: sec(
      "10. Fees",
      "Everything the Service offers today is free. If we introduce paid features in the future, we will announce them in advance, they will not apply retroactively, and local automation, Halt and export will remain free.",
    ),
    ip: sec(
      "11. Our intellectual property",
      "The AutoFlow name, logo, software, official templates and website are owned by ProjectTeamForYou or its licensors and are protected by law. These Terms do not grant you rights to our trademarks. If you send us feedback, we may use it without obligation to you.",
    ),
    thirdParty: sec(
      "12. Third-party services",
      "The Service interacts with services we do not control, such as your operating system, Google Play, GitHub, AI providers and the apps you automate. Their terms and policies apply to your use of them, and we are not responsible for them.",
    ),
    disclaimer: sec(
      "13. Disclaimer of warranties",
      "To the maximum extent permitted by law, the Service is provided “as is” and “as available”, without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose and non-infringement. We do not warrant that flows will behave identically on every device or that the Service will be error-free. Nothing in these Terms limits rights you have as a consumer that cannot be excluded by law.",
    ),
    liability: sec(
      "14. No compensation and limitation of liability",
      "AutoFlow is provided free of charge and “as is”. To the maximum extent permitted by law, we do not compensate for, and are not liable for, any damages — direct, indirect, incidental, special, consequential or punitive — including loss of profits, data, accounts or goodwill, arising from the Service, from automations you create or run, or from templates, AI output or third-party services. You use automations at your own risk and must check them before running them. This does not exclude liability that cannot be excluded under applicable law, such as liability for intent or gross negligence or mandatory consumer rights.",
    ),
    indemnity: sec(
      "15. Indemnity",
      "To the extent permitted by law, you agree to compensate us for claims by third parties arising from your flows, your content or your breach of these Terms.",
    ),
    termination: sec(
      "16. Termination",
      "You may stop using the Service at any time and delete your account in the app’s settings. We may suspend or terminate access if you seriously or repeatedly break these Terms, if required by law, or if we discontinue the Service — in which case we will give reasonable notice where possible so you can export your data. Sections that by their nature should survive termination will survive.",
    ),
    changes: sec(
      "17. Changes to these Terms",
      "We may update these Terms. We will publish changes on this page at least 7 days before they take effect, or at least 30 days before for changes that are unfavourable to you, and notify account holders of material changes. If you continue to use the Service after changes take effect, you accept them; if you do not agree, please stop using the Service.",
    ),
    law: sec(
      "18. Governing law and disputes",
      "These Terms are governed by the laws of the Republic of Korea. Any dispute arising from the Service will be submitted to the Seoul Central District Court as the court of first instance, without prejudice to mandatory consumer-protection rules and the courts of your country of residence where the law gives you that right. We encourage you to contact us first — most issues can be resolved quickly.",
    ),
    misc: sec(
      "19. Miscellaneous",
      "If any provision is found unenforceable, the rest remains in effect. Not enforcing a provision is not a waiver. You may not transfer your rights under these Terms without our consent; we may transfer them as part of a reorganisation or sale. These Terms are available in 12 languages; if versions conflict, the English version prevails unless the law of your country requires otherwise.",
    ),
    contact: sec("20. Contact", "ProjectTeamForYou · {email}"),
  },
};
