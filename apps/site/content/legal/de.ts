import { sec, type Privacy, type Terms } from "../types.js";

export const privacy: Privacy = {
  seo: {
    title: "Datenschutzerklärung — AutoFlow",
    description: "Wie AutoFlow mit Ihren Daten umgeht: lokale Verarbeitung, optionales Konto, Ende-zu-Ende-verschlüsselter Sync, keine Werbung, kein Datenverkauf.",
  },
  h1: "Datenschutzerklärung",
  intro:
    "AutoFlow ist so gebaut, dass es zuerst auf Ihrem Gerät arbeitet. Diese Erklärung beschreibt in klaren Worten, welche Informationen die AutoFlow-Apps für Windows und Android, die AutoFlow-Web-App und diese Website verarbeiten, warum, wie lange – und welche Rechte Sie haben.",
  sections: {
    controller: sec(
      "1. Verantwortlicher",
      "Der Verantwortliche für die Verarbeitung personenbezogener Daten über AutoFlow ist **ProjectTeamForYou** (프로젝트팀포유; Vertreter: Yusang Lee; Geschäftsanmeldungsnummer: 495-25-02209; Bericht über den Versandhandelsbetrieb Nr. 제2026-경북봉화-0037호; 1166-68 Yebong-ro, Sangun-myeon, Bonghwa-gun, Gyeongsangbuk-do, Republik Korea; Telefon: +82-70-7620-7256). Unser Datenschutzbeauftragter ist Yusang Lee (Vertreter). Sie können uns, einschließlich unseres Datenschutzbeauftragten, unter {email} erreichen.",
    ),
    summary: sec("2. Das Wichtigste in Kürze", [
      "Ihre Flows, Aufnahmen, Keyforge-Profile und Ausführungsprotokolle werden auf Ihrem Gerät gespeichert und verarbeitet.",
      "Ein Konto ist optional. Legen Sie eines an, speichern wir Ihre E-Mail-Adresse und einen Passwort-Hash.",
      "Der Sync ist Ende-zu-Ende-verschlüsselt. Unser Server speichert Chiffretext, den wir nicht lesen können.",
      "KI-Schlüssel bleiben verschlüsselt auf Ihrem Gerät und gehen nur an den KI-Anbieter, den Sie wählen.",
      "Keine Werbung, keine Tracking-Cookies, keine Analyseprofile und kein Verkauf personenbezogener Daten.",
    ]),
    local: sec(
      "3. Daten, die auf Ihrem Gerät bleiben",
      "Flows, Variablen, Aufnahmen, Bildschirmfotos für die Bildsuche, OCR-Ergebnisse, Keyforge-Profile, Ledger-Protokolle, Einstellungen und Copilot-Unterhaltungen werden lokal erzeugt und verarbeitet. Sie werden nicht an uns übermittelt, es sei denn, Sie synchronisieren, veröffentlichen oder teilen sie ausdrücklich wie unten beschrieben.",
      "Sie können diese Daten jederzeit löschen, indem Sie den Eintrag entfernen, die App-Daten löschen oder die App deinstallieren.",
    ),
    account: sec(
      "4. Optionales Konto",
      "Wenn Sie ein Konto anlegen, verarbeiten wir:",
      ["Ihre E-Mail-Adresse, um Ihr Konto zu identifizieren, Sie anzumelden und notwendige Servicenachrichten (z. B. zum Zurücksetzen des Passworts) zu senden;", "einen Passwort-Hash, erzeugt mit einem modernen, gesalzenen Einwegverfahren – Ihr Passwort selbst speichern oder sehen wir nie;", "Sitzungstoken, den Zeitpunkt der Kontoerstellung und die angemeldeten Geräte, um den Dienst abzusichern."],
      "Diese Daten nutzen wir ausschließlich für Konto und Sync. Wir versenden keine Werbe-E-Mails.",
    ),
    sync: sec(
      "5. Ende-zu-Ende-verschlüsselter Sync",
      "Bei aktiviertem Sync wird jeder Flow auf Ihrem Gerät mit AES-GCM verschlüsselt – mit einem Schlüssel, der Ihre Geräte nie in lesbarer Form verlässt. Unser Server speichert nur den Chiffretext und die für den Sync nötigen technischen Metadaten: Eintragskennung, Revisionsnummer, Inhalts-Hash, Größe und Zeitstempel.",
      "Wir können den Inhalt synchronisierter Flows weder lesen noch durchsuchen noch wiederherstellen. Verlieren Sie den Zugriff auf alle Geräte und Ihren Schlüssel, lassen sich die verschlüsselten Daten nicht wiederherstellen.",
    ),
    atlas: sec(
      "6. Öffentliche Atlas-Vorlagen",
      "Veröffentlichen Sie eine Vorlage in Atlas, werden die Vorlage, ihre Beschreibung, Ihr gewählter Anzeigename und das Veröffentlichungsdatum öffentlich. Vor der Veröffentlichung validiert der Server die Vorlage, prüft sie auf Fehler und vergibt ein Risikolabel. Bewertungen und Meldungen, die Sie abgeben, werden zur Missbrauchsabwehr mit Ihrem Konto gespeichert.",
      "Sie können Vorlagen jederzeit zurückziehen. Kopien, die andere bereits heruntergeladen haben, verbleiben auf deren Geräten.",
    ),
    share: sec(
      "7. Links und Dateien zum Teilen",
      "Ein Teilen-Link oder eine Exportdatei enthält den Flow selbst – komprimiert und kodiert – samt Inhalts-Hash. Wer den Link oder die Datei hat, kann den Flow lesen; teilen Sie daher keine Flows mit Geheimnissen. Beim Öffnen eines Links wird der Flow im Browser oder in der App des Empfängers dekodiert.",
    ),
    ai: sec(
      "8. Copilot und Ihre KI-Schlüssel",
      "Copilot arbeitet mit dem KI-Anbieter Ihrer Wahl (z. B. einem OpenAI-kompatiblen Dienst, Anthropic oder einem lokalen Modell wie Ollama oder LM Studio). Ihr API-Schlüssel wird ausschließlich verschlüsselt auf Ihrem Gerät gespeichert (nicht exportierbarer WebCrypto-Schlüssel im Browser, Windows-Anmeldeinformationsverwaltung, Android Keystore).",
      "Eingaben und der Kontext, den Sie freigeben, werden direkt von Ihrem Gerät an diesen Anbieter gesendet. Wir erhalten weder Schlüssel noch Eingaben noch Antworten. Vor dem Senden zeigt Copilot, was wohin geht. Für die beim Anbieter eingehenden Daten gilt dessen Datenschutzerklärung. Im Nur-lokal-Modus sind externe Aufrufe gesperrt.",
    ),
    android: sec(
      "9. Android: Hinweis zum Bedienungshilfe-Dienst",
      "AutoFlow für Android nutzt die Android-Schnittstelle AccessibilityService, weil Android nur so einer App erlaubt, für Sie zu tippen, zu wischen und globale Aktionen auszuführen. Wir nutzen sie ausschließlich, um:",
      ["die Gesten und globalen Aktionen (z. B. Zurück, Startbildschirm) der Flows auszuführen, die Sie starten;", "Bildschirmtext nur während eines laufenden Flows und nur dann zu lesen, wenn ein von Ihnen hinzugefügter Schritt es erfordert (z. B. „warten, bis dieser Text erscheint“);", "die App im Vordergrund zu erkennen – nur, um Flows mit von Ihnen eingerichteten App-Auslösern zu starten."],
      "Der Dienst erhebt, speichert, teilt oder übermittelt **keine** personenbezogenen oder sensiblen Daten, protokolliert keine Eingaben, liest keine Passwortfelder und wird nicht für Werbung genutzt. Er ist aus, bis Sie ihn einschalten, und lässt sich jederzeit unter Einstellungen › Bedienungshilfen abschalten. AutoFlow fragt außerdem die Berechtigung „Über anderen Apps einblenden“ (für den schwebenden Stopp-Button) und die Benachrichtigungsberechtigung (für den Ausführungsstatus) an – beides steuern Sie.",
    ),
    windows: sec(
      "10. Windows: Hinweis zu Eingabe-Hooks",
      "Für globale Hotkeys, die Keyforge-Tastenbelegung und den Recorder installiert AutoFlow für Windows Low-Level-Tastatur- und Maus-Hooks, solange diese Funktionen aktiv sind. Eingabeereignisse werden im Arbeitsspeicher Ihres PCs verarbeitet, um Ihre Kürzel und Belegungen zu erkennen; sie werden weder protokolliert noch übertragen.",
      "Der Recorder erfasst Eingaben nur, während die Aufnahme läuft und die Aufnahmeanzeige sichtbar ist. In Passwortfelder eingegebener Text wird in Aufnahmen maskiert.",
    ),
    website: sec(
      "11. Diese Website und die Web-App",
      "Wir verwenden keine Tracking-Cookies, Werbepixel oder Analysedienste Dritter. Die Website speichert Ihre Design- und Sprachwahl im lokalen Speicher des Browsers; diese Information verlässt Ihr Gerät nicht. Die Web-App speichert Ihre Flows im Browserspeicher (IndexedDB).",
      "Unser Hosting-Anbieter verarbeitet technische Daten wie IP-Adresse, Browsertyp und aufgerufene URL, um Seiten auszuliefern und Angriffe abzuwehren (berechtigtes Interesse). Diese Protokolle werden nur kurz und nur zu Sicherheitszwecken gespeichert.",
    ),
    noSale: sec(
      "12. Keine Werbung, kein Datenverkauf",
      "AutoFlow enthält keine Werbung. Wir verkaufen, vermieten oder teilen keine personenbezogenen Daten für kontextübergreifende verhaltensbasierte Werbung und erstellen keine Profile über Sie.",
    ),
    processors: sec(
      "13. Auftragsverarbeiter",
      "Wir arbeiten mit wenigen Dienstleistern, die Daten in unserem Auftrag und unter vertraglichen Vertraulichkeits- und Sicherheitspflichten verarbeiten:",
      ["**Cloudflare, Inc.** – Hosting der Website und der Web-App, Content-Auslieferung und Angriffsschutz;", "**Railway Corporation** – Hosting der AutoFlow-API und Datenbank (Kontodaten, verschlüsselte Sync-Daten, Atlas).", "Downloads erfolgen über **GitHub** (Windows) und **Google Play** (Android); diese Dienste verarbeiten Ihre Daten nach ihren eigenen Datenschutzbestimmungen.", "**PortOne** (Korea PortOne Inc.) und **NHN KCP Corp.** – Kartenzahlungen in koreanischen Won für den Business-Tarif; **PayPal** – Zahlungen in anderen Währungen. Sie erhalten die Zahlungsdaten, die Sie auf ihren Seiten eingeben; wir erhalten nur das Zahlungsergebnis (Betrag, Status, Zahlungs-ID und die E-Mail-Adresse Ihres Kontos), niemals Ihre Kartennummer."],
    ),
    transfers: sec(
      "14. Internationale Übermittlungen",
      "Unsere Dienstleister können Daten in den USA und anderen Ländern außerhalb Ihres Landes verarbeiten. Wo gesetzlich erforderlich, stützen wir uns auf geeignete Garantien wie die Standardvertragsklauseln der Europäischen Kommission und das britische International Data Transfer Addendum und informieren über Übermittlungen, wie es koreanisches und japanisches Recht verlangen. Synchronisierte Flows sind verschlüsselt, bevor sie Ihr Gerät verlassen.",
    ),
    retention: sec("15. Speicherdauer", [
      "Kontodaten: solange das Konto besteht.",
      "Verschlüsselte Sync-Daten: bis Sie den Eintrag oder das Konto löschen.",
      "Nach Kontolöschung: sofortige Entfernung aus aktiven Systemen, aus Backups innerhalb von 30 Tagen.",
      "Atlas-Vorlagen: bis zum Zurückziehen oder zur Kontolöschung; Missbrauchsmeldungen bis zu einem Jahr.",
      "Sicherheitsprotokolle: bis zu 30 Tage, sofern sie nicht zur Aufklärung eines konkreten Vorfalls länger benötigt werden.",
      "Zahlungsunterlagen (Bestellungen des Business-Tarifs): 5 Jahre, wie es das koreanische Gesetz zum Verbraucherschutz im elektronischen Handel verlangt – auch nach Löschung des Kontos –, danach werden sie gelöscht.",
    ]),
    rights: sec(
      "16. Ihre Rechte",
      "Je nach Wohnort haben Sie das Recht auf Auskunft, Berichtigung, Löschung, Datenübertragbarkeit, Einschränkung der Verarbeitung und Widerspruch sowie das Recht, eine Einwilligung jederzeit zu widerrufen. Alle Flows können Sie jederzeit in der App exportieren und Ihr Konto in den Einstellungen löschen. Für alle anderen Anliegen schreiben Sie an {email}. Wir antworten innerhalb von 30 Tagen und können Sie bitten, Ihre Identität nachzuweisen. Die Ausübung Ihrer Rechte hat für Sie keine Nachteile.",
    ),
    gdpr: sec(
      "17. Europäischer Wirtschaftsraum und Vereinigtes Königreich (DSGVO / UK GDPR)",
      "Konto- und Sync-Daten verarbeiten wir zur Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO), Sicherheitsprotokolle und Missbrauchsabwehr auf Grundlage unseres berechtigten Interesses an einem sicheren Dienst (Art. 6 Abs. 1 lit. f DSGVO) und optionale Funktionen auf Grundlage Ihrer Einwilligung (Art. 6 Abs. 1 lit. a DSGVO), die Sie jederzeit widerrufen können. Sie haben das Recht, sich bei einer Datenschutz-Aufsichtsbehörde – etwa der Ihres Bundeslandes – oder beim britischen ICO zu beschweren.",
    ),
    pipa: sec(
      "18. Republik Korea (PIPA)",
      "Erhobene Daten: E-Mail-Adresse und Passwort-Hash (für ein Konto erforderlich), verschlüsselte Sync-Daten und Dienstprotokolle. Zweck: Kontoverwaltung, Sync und Sicherheit. Aufbewahrung und Vernichtung: siehe Abschnitt 15; elektronische Dateien werden unwiederbringlich gelöscht. Wir geben personenbezogene Daten nur wie hier beschrieben oder gesetzlich vorgeschrieben an Dritte weiter; Auftragsverarbeitung und Auslandsübermittlungen siehe Abschnitte 13 und 14. Datenschutzverantwortlicher: ProjectTeamForYou, {email}.",
      "Bei Datenschutzverletzungen können Sie sich auch an das Personal Information Infringement Report Center (privacy.kisa.or.kr, Tel. 118) oder das Personal Information Dispute Mediation Committee (www.kopico.go.kr, 1833-6972) wenden.",
    ),
    appi: sec(
      "19. Japan (APPI)",
      "Wir nutzen personenbezogene Informationen nur für die in dieser Erklärung genannten Zwecke und geben sie ohne Einwilligung nicht an Dritte weiter, außer soweit gesetzlich zulässig. Dienstleister und Verarbeitungsländer sind in den Abschnitten 13 und 14 aufgeführt. Offenlegung, Berichtigung, Nutzungsaussetzung oder Löschung Ihrer gespeicherten Daten können Sie unter {email} verlangen.",
    ),
    lgpd: sec(
      "20. Brasilien (LGPD)",
      "Wir verarbeiten Daten auf Grundlage der Vertragserfüllung, berechtigter Interessen und der Einwilligung. Die Rechte nach Art. 18 LGPD – Bestätigung, Zugang, Berichtigung, Anonymisierung, Übertragbarkeit, Löschung, Information über Weitergaben und Widerruf der Einwilligung – üben Sie über unsere Datenschutz-Kontaktadresse {email} aus. Sie können sich auch an die ANPD wenden.",
    ),
    ccpa: sec(
      "21. Kalifornien (CCPA / CPRA)",
      "In den letzten 12 Monaten haben wir Kennungen (E-Mail-Adresse) und auf Sicherheitsprotokolle beschränkte Internetaktivität für die oben genannten Zwecke erhoben. Wir verkaufen oder teilen keine personenbezogenen Daten und nutzen keine sensiblen Daten, um Eigenschaften abzuleiten. Sie haben das Recht auf Auskunft, Löschung und Berichtigung und dürfen wegen der Ausübung dieser Rechte nicht benachteiligt werden. Sie können einen bevollmächtigten Vertreter einsetzen; wir prüfen Anfragen vor der Bearbeitung.",
    ),
    security: sec("22. Sicherheit", [
      "TLS-Verschlüsselung des gesamten Netzwerkverkehrs und strenge Sicherheits-Header auf unseren Websites;", "Ende-zu-Ende-Verschlüsselung synchronisierter Flows und Verschlüsselung von KI-Schlüsseln auf dem Gerät;", "gesalzene Passwort-Hashes, Ratenbegrenzung und Schutz vor automatisierten Angriffen;", "Zugriff auf Produktivsysteme nach dem Prinzip der geringsten Rechte und regelmäßige Aktualisierung von Abhängigkeiten.",
    ], "Kein System ist vollkommen sicher. Betrifft eine Datenpanne Ihre personenbezogenen Daten, benachrichtigen wir Sie und die Behörden wie gesetzlich vorgeschrieben."),
    children: sec(
      "23. Kinder",
      "AutoFlow richtet sich nicht an Kinder unter 13 Jahren. Für ein Konto müssen Sie mindestens 13 Jahre alt sein – im EWR und im Vereinigten Königreich mindestens 16 (oder das in Ihrem Land festgelegte niedrigere Alter für die digitale Einwilligung) und in Korea mindestens 14 –, sofern nicht ein Elternteil oder Erziehungsberechtigter einwilligt. Erfahren wir, dass ein Kinderkonto ohne die nötige Einwilligung besteht, löschen wir es.",
    ),
    changes: sec(
      "24. Änderungen",
      "Änderungen veröffentlichen wir auf dieser Seite und aktualisieren das Gültigkeitsdatum. Ändert sich die Nutzung Ihrer Daten wesentlich, kündigen wir dies vorher in der App oder per E-Mail an.",
    ),
    contact: sec("25. Kontakt", "ProjectTeamForYou · {email}"),
  },
};

export const terms: Terms = {
  seo: {
    title: "Nutzungsbedingungen — AutoFlow",
    description: "Die Regeln für AutoFlow: Lizenz, zulässige Nutzung, Verantwortung für Automatisierungen, KI, Vorlagen, Gewährleistung, Haftung, koreanisches Recht.",
  },
  h1: "Nutzungsbedingungen",
  intro:
    "Diese Bedingungen regeln Ihre Nutzung von AutoFlow – den Apps für Windows und Android, der Web-App, der AutoFlow-API, Atlas und dieser Website (zusammen der „Dienst“). Bitte lesen Sie sie; sie sind verständlich geschrieben.",
  sections: {
    agreement: sec(
      "1. Geltung",
      "Der Dienst wird von **ProjectTeamForYou** („wir“) bereitgestellt. Mit der Installation, dem Aufruf oder der Nutzung des Dienstes stimmen Sie diesen Bedingungen und unserer Datenschutzerklärung zu. Wenn Sie nicht zustimmen, nutzen Sie den Dienst bitte nicht.",
    ),
    service: sec(
      "2. Der Dienst",
      "Mit AutoFlow erstellen, proben, starten und teilen Sie Automatisierungen („Flows“) wie Autoklicks, Makros, Hotkeys, Tastenbelegungen und Routinen. Der Funktionsumfang kann je Plattform variieren. Der Dienst ist kostenlos; optionale Funktionen wie der verschlüsselte Sync erfordern ein Konto.",
    ),
    eligibility: sec(
      "3. Voraussetzungen und Konten",
      "Sie müssen mindestens 13 Jahre alt sein, um den Dienst zu nutzen, oder älter, wenn das Recht Ihres Landes es verlangt (16 im EWR und im Vereinigten Königreich, 14 in Korea), sofern nicht ein Elternteil oder Erziehungsberechtigter eingewilligt hat. Sie sind dafür verantwortlich, Ihre Zugangsdaten und Ihren Schlüssel geheim zu halten, und für Aktivitäten in Ihrem Konto.",
    ),
    license: sec(
      "4. Lizenz",
      "Wir räumen Ihnen eine persönliche, weltweite, nicht ausschließliche, nicht übertragbare und widerrufliche Lizenz ein, den Dienst gemäß diesen Bedingungen privat oder geschäftlich zu installieren und zu nutzen. Sie dürfen die Apps nicht verkaufen, unterlizenzieren oder weiterverbreiten und nicht zurückentwickeln, soweit das Gesetz dies nicht trotz dieser Beschränkung erlaubt.",
    ),
    acceptable: sec(
      "5. Zulässige Nutzung",
      "Sie dürfen den Dienst nicht nutzen, um:",
      [
        "CAPTCHAs, Identitätsprüfungen, Zahlungsbestätigungen oder andere Sicherheitsmaßnahmen zu umgehen, zu lösen oder auszuhebeln;",
        "Anti-Cheat-Systeme zu umgehen oder sich in Spielen, die Automatisierung verbieten, einen unfairen Vorteil zu verschaffen;",
        "gegen die Nutzungsbedingungen von Apps, Spielen oder Websites Dritter zu verstoßen;",
        "Spam zu senden, automatisch Konten anzulegen, Aufrufe, Stimmen oder andere Kennzahlen zu manipulieren oder zu betrügen;",
        "unbefugt auf Systeme oder Daten zuzugreifen, personenbezogene Daten ohne Einwilligung zu sammeln oder Schadsoftware zu verbreiten;",
        "andere zu belästigen, zu schädigen oder zu täuschen oder sonst rechtswidrig zu handeln;",
        "den Dienst oder seine Infrastruktur zu überlasten, anzugreifen oder zu stören oder Atlas, Meldungen oder Bewertungen zu missbrauchen.",
      ],
      "Flows, Vorlagen oder Konten, die gegen diese Regeln verstoßen, können wir sperren.",
    ),
    responsibility: sec(
      "6. Verantwortung für Ihre Automatisierungen",
      "Sie entscheiden, was Ihre Flows tun und wo sie laufen. Sie sind für die Flows verantwortlich, die Sie erstellen, importieren, starten und teilen, und für deren Folgen – einschließlich Aktionen in Apps Dritter, Käufen, gesendeten Nachrichten, geänderten Daten und Kontosperren durch andere. Testen Sie neue oder importierte Flows auf Practice Canvas, prüfen Sie die Sicherheitsbewertung und halten Sie Halt stets griffbereit.",
    ),
    ai: sec(
      "7. Copilot und KI-Ausgaben",
      "Copilot nutzt den KI-Anbieter, den Sie auswählen und mit Ihrem eigenen Schlüssel oder einem lokalen Modell einrichten. KI-Ausgaben können falsch, unvollständig oder unsicher sein. Entwürfe werden validiert und bewertet, Sie müssen aber jeden Entwurf vor dem Speichern oder Ausführen selbst prüfen. Für die Nutzung des Anbieters gelten dessen Bedingungen; anfallende Kosten tragen Sie.",
    ),
    content: sec(
      "8. Ihre Inhalte, Vorlagen und Moderation",
      "Alle Rechte an Ihren Flows und sonstigen Inhalten bleiben bei Ihnen. Veröffentlichen Sie eine Vorlage in Atlas, räumen Sie uns für die Dauer der Veröffentlichung eine weltweite, unentgeltliche, nicht ausschließliche Lizenz ein, sie im Dienst zu hosten, zu speichern, anzuzeigen, zu formatieren und zu verbreiten, und Sie räumen anderen Nutzern eine Lizenz ein, sie für eigene Automatisierungen zu nutzen, zu kopieren und zu verändern.",
      "Sie sichern zu, dass Sie die Rechte an veröffentlichten Inhalten haben und diese den Bedingungen entsprechen. Um Atlas sicher zu halten, können wir Vorlagen prüfen, kennzeichnen, ausblenden oder entfernen und Veröffentlichungsrechte aussetzen – etwa bei hochriskanten, irreführenden, rechtsverletzenden oder missbräuchlichen Vorlagen. Inhalte melden Sie in der App oder an {email}. Offizielle Vorlagen sind Beispiele und müssen ggf. an Ihre Umgebung angepasst werden.",
    ),
    sync: sec(
      "9. Sync und Verfügbarkeit",
      "Der verschlüsselte Sync ist optional und zum Start derzeit kostenlos. Wir bemühen uns um eine hohe Verfügbarkeit, der Dienst kann aber wegen Wartung, Störungen oder Umständen außerhalb unserer Kontrolle unterbrochen werden. Da der Sync Ende-zu-Ende-verschlüsselt ist, können wir Daten bei Schlüsselverlust nicht wiederherstellen. Bewahren Sie Exporte wichtiger Flows auf.",
    ),
    fees: sec(
      "10. Entgelte, kostenpflichtige Tarife und Erstattungen",
      "Die AutoFlow-Apps, lokale Automatisierung, Halt und Export sind kostenlos. Die verschlüsselte Synchronisierung ist während der Startphase kostenlos (₩0). Die private (individuelle, nicht kommerzielle) Nutzung der Synchronisierung ist kostenlos. Die nicht private Nutzung – für ein Unternehmen, eine Organisation oder einen sonstigen kommerziellen Zweck – ist bis zum 25. Oktober 2026, 23:59 Uhr koreanischer Zeit, kostenlos; danach erfordert die nicht private Nutzung der Synchronisierung den kostenpflichtigen Business-Tarif. Sie wählen Ihre Nutzungsart in der App und müssen sie zutreffend halten.",
      "Der Business-Tarif wird als Einmalkauf für 1 oder 12 Monate verkauft und über PortOne (Kartenzahlung in koreanischen Won über KCP) oder PayPal (US-Dollar) bezahlt. Der Preis einschließlich etwaiger Steuern wird vor der Zahlung angezeigt. Es gibt keine automatische Verlängerung, und wir speichern Ihre Karte nicht; ein weiterer Kauf verlängert Ihren laufenden Zeitraum.",
      "Widerruf: Nach dem koreanischen Gesetz zum Verbraucherschutz im elektronischen Handel können Sie einen Kauf innerhalb von 7 Tagen nach der Zahlung widerrufen und erhalten den vollen Betrag zurück. Da der Business-Tarif ein digitaler Inhalt ist, der ab der Zahlung bereitgestellt wird, erlischt das Widerrufsrecht, sobald Sie ihn nach der Zahlung nutzen (zum Beispiel durch Uploads in die Synchronisierung für geschäftliche Zwecke), sofern Sie dem beim Bezahlen zugestimmt haben; bis dahin können Sie jederzeit widerrufen. Weicht der Dienst von dem ab, was angezeigt, beworben oder vereinbart wurde, können Sie innerhalb von 3 Monaten nach Erhalt oder innerhalb von 30 Tagen ab dem Zeitpunkt widerrufen, zu dem Sie davon wussten oder wissen konnten. Erstattungen fordern Sie unter {email} an; wir erstatten über das ursprüngliche Zahlungsmittel innerhalb von 3 Werktagen nach Bestätigung des Widerrufs.",
      "Können wir die Synchronisierung aus Gründen, die wir zu vertreten haben, nicht bereitstellen, oder stellen wir den kostenpflichtigen Tarif ein, erstatten wir den ungenutzten Teil Ihres Zeitraums anteilig. Nicht zu zahlen sperrt Ihre Daten nie: Lesen, Exportieren und Löschen synchronisierter Daten bleiben immer möglich. Ändern wir Preise oder führen neue kostenpflichtige Funktionen ein, kündigen wir dies vorher an; es gilt nicht für bereits bezahlte Zeiträume, und lokale Automatisierung, Halt und Export bleiben kostenlos.",
      "Abschnitt 14 (kein Schadensersatz) gilt auch für kostenpflichtige Tarife, schränkt aber weder die in diesem Abschnitt beschriebenen Erstattungen noch Ihre Rechte nach dem Verbraucherschutzrecht ein.",
    ),
    ip: sec(
      "11. Unser geistiges Eigentum",
      "Name, Logo, Software, offizielle Vorlagen und Website von AutoFlow gehören ProjectTeamForYou oder seinen Lizenzgebern und sind rechtlich geschützt. Diese Bedingungen gewähren Ihnen keine Rechte an unseren Marken. Feedback, das Sie uns senden, dürfen wir ohne Verpflichtung Ihnen gegenüber verwenden.",
    ),
    thirdParty: sec(
      "12. Dienste Dritter",
      "Der Dienst interagiert mit Diensten, die wir nicht kontrollieren – etwa Ihrem Betriebssystem, Google Play, GitHub, KI-Anbietern und den Apps, die Sie automatisieren. Für deren Nutzung gelten deren Bedingungen und Richtlinien; wir sind dafür nicht verantwortlich.",
    ),
    disclaimer: sec(
      "13. Gewährleistung",
      "Soweit gesetzlich zulässig, wird der Dienst unentgeltlich „wie besehen“ und „wie verfügbar“ bereitgestellt, ohne ausdrückliche oder stillschweigende Zusicherungen, etwa der Marktgängigkeit, Eignung für einen bestimmten Zweck oder Nichtverletzung von Rechten. Wir sichern nicht zu, dass Flows auf jedem Gerät gleich funktionieren oder der Dienst fehlerfrei ist. Zwingende gesetzliche Verbraucherrechte bleiben unberührt.",
    ),
    liability: sec(
      "14. Kein Schadensersatz und Haftungsbeschränkung",
      "AutoFlow wird unentgeltlich und „wie besehen“ bereitgestellt. Soweit gesetzlich zulässig, leisten wir keinerlei Vergütung und haften nicht für Schäden jeglicher Art – weder für unmittelbare, mittelbare, beiläufig entstandene, besondere, Folge- oder Strafschäden –, einschließlich entgangenen Gewinns, Datenverlust, Verlust von Konten oder Goodwill, die aus der Nutzung des Dienstes, aus von Ihnen erstellten oder ausgeführten Automatisierungen oder aus Vorlagen, KI-Ausgaben oder Diensten Dritter entstehen. Die Nutzung von Automatisierungen erfolgt auf Ihr eigenes Risiko; Sie sind verpflichtet, diese vor deren Ausführung zu überprüfen. Diese Regelung schließt eine Haftung nicht aus, soweit eine solche nach geltendem Recht nicht ausgeschlossen werden kann, insbesondere bei Vorsatz, grober Fahrlässigkeit oder zwingenden Verbraucherrechten.",
    ),
    indemnity: sec(
      "15. Freistellung",
      "Soweit gesetzlich zulässig, stellen Sie uns von Ansprüchen Dritter frei, die aus Ihren Flows, Ihren Inhalten oder Ihrem Verstoß gegen diese Bedingungen entstehen.",
    ),
    termination: sec(
      "16. Beendigung",
      "Sie können die Nutzung jederzeit beenden und Ihr Konto in den App-Einstellungen löschen. Wir können den Zugang sperren oder beenden, wenn Sie schwerwiegend oder wiederholt gegen diese Bedingungen verstoßen, wenn das Gesetz es verlangt oder wenn wir den Dienst einstellen – dann möglichst mit angemessener Vorankündigung, damit Sie Ihre Daten exportieren können. Bestimmungen, die ihrer Natur nach fortgelten sollen, bleiben wirksam.",
    ),
    changes: sec(
      "17. Änderungen dieser Bedingungen",
      "Wir können diese Bedingungen ändern. Änderungen veröffentlichen wir auf dieser Seite mindestens 7 Tage vor Inkrafttreten, für Sie nachteilige Änderungen mindestens 30 Tage vorher, und informieren Kontoinhaber über wesentliche Änderungen. Nutzen Sie den Dienst danach weiter, gelten die Änderungen als angenommen; andernfalls beenden Sie bitte die Nutzung.",
    ),
    law: sec(
      "18. Anwendbares Recht und Gerichtsstand",
      "Es gilt das Recht der Republik Korea. Für Streitigkeiten aus dem Dienst ist das Seoul Central District Court als Gericht erster Instanz zuständig, unbeschadet zwingender Verbraucherschutzvorschriften und Ihres Rechts, vor den Gerichten Ihres Wohnsitzlandes zu klagen, wo das Gesetz dies vorsieht. Bitte wenden Sie sich zuerst an uns – die meisten Anliegen lassen sich schnell klären.",
    ),
    misc: sec(
      "19. Sonstiges",
      "Ist eine Bestimmung unwirksam, bleibt der Rest wirksam. Die Nichtdurchsetzung einer Bestimmung ist kein Verzicht. Sie dürfen Ihre Rechte aus diesen Bedingungen nicht ohne unsere Zustimmung übertragen; wir dürfen sie im Rahmen einer Umstrukturierung oder eines Verkaufs übertragen. Diese Bedingungen liegen in 12 Sprachen vor; bei Abweichungen gilt die englische Fassung, sofern das Recht Ihres Landes nichts anderes vorschreibt.",
    ),
    contact: sec("20. Kontakt", "ProjectTeamForYou · {email}"),
  },
};
