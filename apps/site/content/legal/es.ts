import { sec, type Privacy, type Terms } from "../types.js";

export const privacy: Privacy = {
  seo: {
    title: "Política de privacidad — AutoFlow",
    description: "Cómo trata AutoFlow tus datos: procesamiento local, cuenta opcional, sincronización cifrada de extremo a extremo, sin anuncios ni venta de datos.",
  },
  h1: "Política de privacidad",
  intro:
    "AutoFlow está diseñado para funcionar primero en tu dispositivo. Esta política explica, con palabras sencillas, qué información tratan las apps de AutoFlow para Windows y Android, la app web de AutoFlow y este sitio, por qué, durante cuánto tiempo y qué derechos tienes.",
  sections: {
    controller: sec(
      "1. Responsable del tratamiento",
      "El responsable de los datos personales tratados a través de AutoFlow es **ProjectTeamForYou** («nosotros»). Puedes escribirnos, también a nuestro responsable de privacidad, a {email}.",
    ),
    summary: sec("2. En pocas palabras", [
      "Tus flujos, grabaciones, perfiles de Keyforge y registros de ejecución se guardan y procesan en tu dispositivo.",
      "La cuenta es opcional. Si creas una, guardamos tu correo electrónico y un hash de tu contraseña.",
      "La sincronización está cifrada de extremo a extremo. Nuestro servidor guarda texto cifrado que no podemos leer.",
      "Las claves de IA se quedan cifradas en tu dispositivo y solo se envían al proveedor de IA que elijas.",
      "Sin anuncios, sin cookies de rastreo, sin perfiles analíticos y sin venta de datos personales.",
    ]),
    local: sec(
      "3. Datos que se quedan en tu dispositivo",
      "Los flujos, variables, grabaciones, capturas usadas para buscar imágenes, resultados de OCR, perfiles de Keyforge, registros de Ledger, ajustes y conversaciones de Copilot se crean y procesan localmente. No nos llegan salvo que los sincronices, publiques o compartas de forma expresa como se describe más abajo.",
      "Puedes borrarlos cuando quieras eliminando el elemento, borrando los datos de la app o desinstalándola.",
    ),
    account: sec(
      "4. Cuenta opcional",
      "Si creas una cuenta, tratamos:",
      ["tu dirección de correo electrónico, para identificar tu cuenta, iniciar sesión y enviarte mensajes esenciales del servicio (por ejemplo, para restablecer la contraseña);", "un hash de la contraseña generado con un algoritmo moderno, unidireccional y con sal: nunca guardamos ni vemos la contraseña;", "tokens de sesión, la fecha de creación de la cuenta y los dispositivos conectados, para mantener el servicio seguro."],
      "Usamos esta información solo para prestar la cuenta y la sincronización. No enviamos correos de marketing.",
    ),
    sync: sec(
      "5. Sincronización cifrada de extremo a extremo",
      "Con la sincronización activada, cada flujo se cifra en tu dispositivo con AES-GCM y una clave que nunca sale de tus dispositivos en forma legible. Nuestro servidor solo guarda el texto cifrado y los metadatos técnicos necesarios: identificador del elemento, número de revisión, hash del contenido, tamaño y marcas de tiempo.",
      "No podemos leer, analizar ni recuperar el contenido de los flujos sincronizados. Si pierdes el acceso a todos tus dispositivos y a tu clave de cifrado, los datos cifrados no se pueden restaurar.",
    ),
    atlas: sec(
      "6. Plantillas públicas de Atlas",
      "Si publicas una plantilla en Atlas, la plantilla, su descripción, el nombre visible que elijas y la fecha de publicación pasan a ser públicos. Antes de publicarla, el servidor la valida, busca errores y le asigna una etiqueta de riesgo. Las valoraciones y denuncias que envíes se guardan con tu cuenta para evitar abusos.",
      "Puedes retirar tus plantillas cuando quieras. Las copias que otras personas ya hayan descargado permanecen en sus dispositivos.",
    ),
    share: sec(
      "7. Enlaces y archivos compartidos",
      "Un enlace o archivo exportado contiene el propio flujo, comprimido y codificado, junto con un hash de su contenido. Cualquiera que tenga el enlace o el archivo puede leer el flujo, así que no compartas flujos con secretos. Al abrir un enlace, el flujo se decodifica en el navegador o la app de quien lo recibe.",
    ),
    ai: sec(
      "8. Copilot y tus claves de IA",
      "Copilot funciona con el proveedor de IA que elijas (por ejemplo, un servicio compatible con OpenAI, Anthropic o un modelo local como Ollama o LM Studio). Tu clave de API se guarda únicamente en tu dispositivo y cifrada (clave WebCrypto no extraíble en el navegador, Administrador de credenciales de Windows, Android Keystore).",
      "Las instrucciones y el contexto que apruebes se envían directamente desde tu dispositivo a ese proveedor. Nunca recibimos tus claves, instrucciones ni respuestas. Antes de enviar, Copilot muestra qué se enviará y adónde. Lo que reciba el proveedor se rige por su propia política de privacidad. En el modo solo local, las llamadas externas están bloqueadas.",
    ),
    android: sec(
      "9. Android: información sobre el servicio de accesibilidad",
      "AutoFlow para Android usa la API AccessibilityService de Android porque es la única forma que Android ofrece para que una app realice toques, deslizamientos y acciones globales en tu nombre. La usamos para:",
      ["realizar los gestos y acciones globales (como Atrás o Inicio) de los flujos que ejecutas;", "leer texto en pantalla solo mientras se ejecuta un flujo y solo cuando un paso que añadiste lo requiere (por ejemplo, «esperar hasta que aparezca este texto»);", "detectar qué app está en primer plano, solo para iniciar flujos con disparadores por app que configuraste."],
      "El servicio **no** recopila, guarda, comparte ni transmite datos personales o sensibles, no registra lo que escribes, no lee campos de contraseña y no se usa con fines publicitarios. Está desactivado hasta que lo actives y puedes desactivarlo en cualquier momento en Ajustes › Accesibilidad. AutoFlow también pide el permiso de superposición (para el botón flotante de parada) y el de notificaciones (para mostrar el estado de ejecución); ambos los controlas tú.",
    ),
    windows: sec(
      "10. Windows: información sobre los hooks de entrada",
      "Para ofrecer atajos globales, la reasignación de Keyforge y la grabadora, AutoFlow para Windows instala hooks de teclado y ratón de bajo nivel mientras esas funciones están activas. Los eventos de entrada se procesan en la memoria de tu PC para detectar tus atajos y reasignaciones; no se registran y nunca se transmiten.",
      "La grabadora solo captura entradas mientras está activa y su indicador es visible. El texto escrito en campos de contraseña se oculta en las grabaciones.",
    ),
    website: sec(
      "11. Este sitio y la app web",
      "No usamos cookies de rastreo, píxeles publicitarios ni analítica de terceros. El sitio guarda tu elección de tema e idioma en el almacenamiento local del navegador, que nunca sale de tu dispositivo. La app web guarda tus flujos en el almacenamiento del navegador (IndexedDB).",
      "Nuestro proveedor de alojamiento trata datos técnicos como la dirección IP, el tipo de navegador y la URL solicitada para servir las páginas y protegerlas de ataques. Estos registros se conservan poco tiempo y solo con fines de seguridad.",
    ),
    noSale: sec(
      "12. Sin anuncios ni venta de datos",
      "AutoFlow no contiene publicidad. No vendemos, alquilamos ni compartimos información personal para publicidad comportamental entre contextos, y no creamos perfiles sobre ti.",
    ),
    processors: sec(
      "13. Proveedores de servicios",
      "Trabajamos con pocos proveedores que tratan datos por cuenta nuestra con obligaciones contractuales de confidencialidad y seguridad:",
      ["**Cloudflare, Inc.**: alojamiento del sitio y de la app web, distribución de contenido y protección frente a ataques;", "**Railway Corporation**: alojamiento de la API y la base de datos de AutoFlow (datos de cuenta, datos de sincronización cifrados, Atlas).", "Las descargas se ofrecen a través de **GitHub** (Windows) y **Google Play** (Android), que tratan tus datos según sus propias políticas de privacidad."],
    ),
    transfers: sec(
      "14. Transferencias internacionales",
      "Nuestros proveedores pueden tratar datos en Estados Unidos y en otros países distintos del tuyo. Cuando la ley lo exige, aplicamos garantías adecuadas como las Cláusulas Contractuales Tipo de la Comisión Europea y el Addendum de transferencias internacionales del Reino Unido, e informamos de las transferencias según exigen las leyes de Corea y Japón. Los flujos sincronizados se cifran antes de salir de tu dispositivo.",
    ),
    retention: sec("15. Cuánto tiempo conservamos los datos", [
      "Datos de la cuenta: mientras exista la cuenta.",
      "Datos de sincronización cifrados: hasta que borres el elemento o la cuenta.",
      "Tras borrar la cuenta: se eliminan de los sistemas activos de inmediato y de las copias de seguridad en un máximo de 30 días.",
      "Plantillas de Atlas: hasta que las retires o borres tu cuenta; las denuncias por abuso, hasta un año.",
      "Registros de seguridad: hasta 30 días, salvo que se necesiten más para investigar un incidente concreto.",
    ]),
    rights: sec(
      "16. Tus derechos",
      "Según dónde vivas, tienes derecho a acceder, rectificar, suprimir y exportar (portabilidad) tus datos personales, a limitar su tratamiento u oponerte a él y a retirar tu consentimiento en cualquier momento. Puedes exportar todos tus flujos desde la app cuando quieras y borrar tu cuenta en los ajustes. Para cualquier otra solicitud, escribe a {email}. Respondemos en un máximo de 30 días y podemos pedirte que verifiques tu identidad. Nunca te trataremos de forma diferente por ejercer tus derechos.",
    ),
    gdpr: sec(
      "17. Espacio Económico Europeo y Reino Unido (RGPD / UK GDPR)",
      "Tratamos los datos de cuenta y sincronización para ejecutar nuestro contrato contigo (art. 6.1.b), los registros de seguridad y la prevención de abusos por nuestro interés legítimo en mantener el servicio seguro (art. 6.1.f) y cualquier elemento opcional con tu consentimiento (art. 6.1.a), que puedes retirar cuando quieras. Tienes derecho a presentar una reclamación ante tu autoridad de protección de datos (en España, la AEPD) o ante la ICO del Reino Unido.",
    ),
    pipa: sec(
      "18. República de Corea (PIPA)",
      "Datos recogidos: correo electrónico y hash de contraseña (necesarios para la cuenta), datos de sincronización cifrados y registros del servicio. Finalidad: gestión de la cuenta, sincronización y seguridad. Conservación y destrucción: según la sección 15; los archivos electrónicos se eliminan de forma irrecuperable. No cedemos datos personales a terceros salvo lo descrito en esta política o lo exigido por ley; los encargados y las transferencias al extranjero figuran en las secciones 13 y 14. Responsable de privacidad: ProjectTeamForYou, {email}.",
      "También puedes acudir al Centro de Denuncias de Infracciones de Información Personal (privacy.kisa.or.kr, teléfono 118) o al Comité de Mediación de Conflictos de Información Personal (www.kopico.go.kr, 1833-6972).",
    ),
    appi: sec(
      "19. Japón (APPI)",
      "Usamos la información personal solo para los fines indicados en esta política y no la facilitamos a terceros sin consentimiento salvo en los casos que permite la ley. Los proveedores que usamos y los países donde se tratan los datos figuran en las secciones 13 y 14. Puedes solicitar la divulgación, corrección, suspensión del uso o eliminación de tus datos escribiendo a {email}.",
    ),
    lgpd: sec(
      "20. Brasil (LGPD)",
      "Tratamos los datos con base en la ejecución del contrato, el interés legítimo y el consentimiento. Puedes ejercer los derechos del artículo 18 de la LGPD —confirmación, acceso, corrección, anonimización, portabilidad, eliminación, información sobre el uso compartido y revocación del consentimiento— escribiendo a nuestro contacto de protección de datos en {email}. También puedes presentar una reclamación ante la ANPD.",
    ),
    ccpa: sec(
      "21. California (CCPA / CPRA)",
      "En los últimos 12 meses hemos recogido identificadores (correo electrónico) y actividad de internet limitada a registros de seguridad, para los fines descritos. No vendemos ni compartimos información personal y no usamos información personal sensible para inferir características. Tienes derecho a saber, eliminar y corregir tu información y a no ser discriminado por ejercer estos derechos. Puedes actuar mediante un agente autorizado; verificaremos las solicitudes antes de atenderlas.",
    ),
    security: sec("22. Seguridad", [
      "cifrado TLS en todo el tráfico de red y cabeceras de seguridad estrictas en nuestros sitios;", "cifrado de extremo a extremo de los flujos sincronizados y cifrado en el dispositivo de las claves de IA;", "hash de contraseñas con sal, limitación de peticiones y protección frente a ataques automatizados;", "acceso con mínimo privilegio a los sistemas de producción y actualizaciones periódicas de dependencias.",
    ], "Ningún sistema es perfectamente seguro. Si una brecha afecta a tus datos personales, te lo notificaremos a ti y a las autoridades según exija la ley."),
    children: sec(
      "23. Menores",
      "AutoFlow no está dirigido a menores de 13 años. Para crear una cuenta debes tener al menos 13 años —o 16 en el EEE y el Reino Unido (o la edad de consentimiento digital inferior que fije tu país; en España, 14) y 14 en Corea—, salvo que tu madre, padre o tutor legal lo consienta. Si sabemos que tenemos la cuenta de un menor sin el consentimiento necesario, la borraremos.",
    ),
    changes: sec(
      "24. Cambios en esta política",
      "Publicaremos cualquier cambio en esta página y actualizaremos la fecha de entrada en vigor. Si un cambio afecta de forma importante a cómo usamos tu información, lo anunciaremos en la app o por correo antes de que se aplique.",
    ),
    contact: sec("25. Contacto", "ProjectTeamForYou · {email}"),
  },
};

export const terms: Terms = {
  seo: {
    title: "Términos del servicio — AutoFlow",
    description: "Las reglas para usar AutoFlow: licencia, uso aceptable, responsabilidad por tus automatizaciones, resultados de IA, plantillas, garantías y ley coreana.",
  },
  h1: "Términos del servicio",
  intro:
    "Estos Términos regulan el uso de AutoFlow: las apps para Windows y Android, la app web, la API de AutoFlow, Atlas y este sitio (en conjunto, el «Servicio»). Léelos, por favor: están escritos para entenderse.",
  sections: {
    agreement: sec(
      "1. Aceptación",
      "El Servicio lo presta **ProjectTeamForYou** («nosotros»). Al instalar, acceder o usar el Servicio aceptas estos Términos y nuestra Política de privacidad. Si no estás de acuerdo, no uses el Servicio.",
    ),
    service: sec(
      "2. El Servicio",
      "AutoFlow te permite crear, ensayar, ejecutar y compartir automatizaciones («flujos») como autoclics, macros, atajos, reasignación de teclas y rutinas. Las funciones pueden variar según la plataforma. El Servicio es gratuito; algunas funciones opcionales, como la sincronización cifrada, requieren cuenta.",
    ),
    eligibility: sec(
      "3. Requisitos y cuentas",
      "Debes tener al menos 13 años para usar el Servicio, o más si lo exige la ley de tu país (16 en el EEE y el Reino Unido, 14 en Corea), salvo que tu madre, padre o tutor legal lo consienta. Eres responsable de proteger tus datos de acceso y tu clave de cifrado, y de la actividad de tu cuenta.",
    ),
    license: sec(
      "4. Licencia",
      "Te concedemos una licencia personal, mundial, no exclusiva, intransferible y revocable para instalar y usar el Servicio con fines personales o profesionales conforme a estos Términos. No puedes vender, sublicenciar ni redistribuir las apps, ni aplicarles ingeniería inversa salvo en la medida en que la ley lo permita pese a esta restricción.",
    ),
    acceptable: sec(
      "5. Uso aceptable",
      "No debes usar el Servicio para:",
      [
        "saltarse, resolver o burlar CAPTCHAs, verificaciones de identidad, confirmaciones de pago u otras medidas de seguridad;",
        "eludir sistemas antitrampas u obtener ventajas injustas en juegos donde la automatización está prohibida;",
        "incumplir los términos de servicio de apps, juegos o sitios web de terceros;",
        "enviar spam, crear cuentas automáticamente, inflar visitas, votos u otras métricas o cometer fraude;",
        "acceder a sistemas o datos sin autorización, recopilar datos personales sin consentimiento o distribuir malware;",
        "acosar, perjudicar o engañar a otras personas, o hacer cualquier cosa ilegal;",
        "sobrecargar, atacar o interferir con el Servicio o su infraestructura, o abusar de Atlas, las denuncias o las valoraciones.",
      ],
      "Podemos bloquear flujos, plantillas o cuentas que incumplan estas normas.",
    ),
    responsibility: sec(
      "6. Tú respondes de tus automatizaciones",
      "Tú decides qué hacen tus flujos y dónde se ejecutan. Eres responsable de los flujos que creas, importas, ejecutas y compartes, y de sus consecuencias, incluidas las acciones en apps de terceros, compras, mensajes enviados, datos modificados y restricciones de cuenta impuestas por otros. Prueba los flujos nuevos o importados en Practice Canvas, revisa su puntuación de seguridad y ten Halt siempre a mano.",
    ),
    ai: sec(
      "7. Copilot y resultados de IA",
      "Copilot usa el proveedor de IA que tú eliges y configuras con tu propia clave o un modelo local. Los resultados de la IA pueden ser erróneos, incompletos o inseguros. Los borradores se validan y puntúan, pero debes revisar cada uno antes de guardarlo o ejecutarlo. El uso del proveedor se rige por sus propios términos y los costes que cobre corren de tu cuenta.",
    ),
    content: sec(
      "8. Tu contenido, plantillas y moderación",
      "Conservas todos los derechos sobre los flujos y demás contenido que creas. Al publicar una plantilla en Atlas, nos concedes una licencia mundial, gratuita y no exclusiva para alojarla, almacenarla, mostrarla, adaptar su formato y distribuirla dentro del Servicio mientras esté publicada, y concedes a los demás usuarios una licencia para usarla, copiarla y modificarla para sus propias automatizaciones.",
      "Garantizas que tienes los derechos sobre lo que publicas y que cumple estos Términos. Podemos revisar, etiquetar, ocultar o retirar plantillas y suspender el derecho a publicar para mantener Atlas seguro, por ejemplo ante plantillas de alto riesgo, engañosas, infractoras o abusivas. Puedes denunciar contenido desde la app o en {email}. Las plantillas oficiales se ofrecen como ejemplos y pueden necesitar ajustes para tu configuración.",
    ),
    sync: sec(
      "9. Sincronización y disponibilidad",
      "La sincronización cifrada es opcional y actualmente gratuita durante el lanzamiento. Trabajamos para mantener el Servicio disponible, pero puede interrumpirse por mantenimiento, fallos o causas ajenas a nuestro control. Como la sincronización está cifrada de extremo a extremo, no podemos recuperar datos si pierdes tus claves. Guarda exportaciones de los flujos importantes.",
    ),
    fees: sec(
      "10. Precio",
      "Todo lo que ofrece hoy el Servicio es gratuito. Si en el futuro introducimos funciones de pago, las anunciaremos con antelación, no se aplicarán con carácter retroactivo y la automatización local, Halt y la exportación seguirán siendo gratis.",
    ),
    ip: sec(
      "11. Nuestra propiedad intelectual",
      "El nombre, el logotipo, el software, las plantillas oficiales y el sitio de AutoFlow pertenecen a ProjectTeamForYou o a sus licenciantes y están protegidos por la ley. Estos Términos no te otorgan derechos sobre nuestras marcas. Si nos envías sugerencias, podemos usarlas sin obligación alguna hacia ti.",
    ),
    thirdParty: sec(
      "12. Servicios de terceros",
      "El Servicio interactúa con servicios que no controlamos, como tu sistema operativo, Google Play, GitHub, los proveedores de IA y las apps que automatizas. Su uso se rige por sus propios términos y políticas, y no somos responsables de ellos.",
    ),
    disclaimer: sec(
      "13. Exclusión de garantías",
      "En la máxima medida permitida por la ley, el Servicio se ofrece «tal cual» y «según disponibilidad», sin garantías de ningún tipo, expresas o implícitas, incluidas las de comerciabilidad, idoneidad para un fin concreto y no infracción. No garantizamos que los flujos se comporten igual en todos los dispositivos ni que el Servicio esté libre de errores. Nada de lo aquí dispuesto limita los derechos que te reconoce la normativa de consumo y que no pueden excluirse.",
    ),
    liability: sec(
      "14. Sin compensación y limitación de responsabilidad",
      "AutoFlow se proporciona de forma gratuita y \"tal cual\". En la máxima medida permitida por la ley, no ofrecemos compensación ni asumimos responsabilidad alguna por daños de ningún tipo —ya sean directos, indirectos, incidentales, especiales, consecuenciales o punitivos—, incluyendo, entre otros, la pérdida de beneficios, datos, cuentas o fondo de comercio, que surjan del uso del Servicio, de las automatizaciones que usted cree o ejecute, o de plantillas, resultados generados por inteligencia artificial o servicios de terceros. Usted utiliza las automatizaciones bajo su propio riesgo y debe revisarlas antes de ejecutarlas. Esta disposición no excluye la responsabilidad que no pueda ser excluida conforme a la legislación aplicable, como la responsabilidad por dolo o negligencia grave, o los derechos irrenunciables del consumidor.",
    ),
    indemnity: sec(
      "15. Indemnización",
      "En la medida en que lo permita la ley, aceptas compensarnos por las reclamaciones de terceros derivadas de tus flujos, tu contenido o tu incumplimiento de estos Términos.",
    ),
    termination: sec(
      "16. Terminación",
      "Puedes dejar de usar el Servicio cuando quieras y borrar tu cuenta en los ajustes de la app. Podemos suspender o cancelar el acceso si incumples estos Términos de forma grave o reiterada, si la ley lo exige o si dejamos de ofrecer el Servicio; en ese caso avisaremos con antelación razonable siempre que sea posible para que exportes tus datos. Las cláusulas que por su naturaleza deban subsistir seguirán vigentes.",
    ),
    changes: sec(
      "17. Cambios en estos Términos",
      "Podemos actualizar estos Términos. Publicaremos los cambios en esta página al menos 7 días antes de que entren en vigor, o al menos 30 días antes si te perjudican, y avisaremos de los cambios importantes a quienes tengan cuenta. Si sigues usando el Servicio después, los aceptas; si no estás de acuerdo, deja de usarlo.",
    ),
    law: sec(
      "18. Ley aplicable y litigios",
      "Estos Términos se rigen por las leyes de la República de Corea. Cualquier litigio derivado del Servicio se someterá al Tribunal de Distrito Central de Seúl como tribunal de primera instancia, sin perjuicio de las normas imperativas de protección de los consumidores y de los tribunales de tu país de residencia cuando la ley te reconozca ese derecho. Te animamos a escribirnos primero: la mayoría de los problemas se resuelven rápido.",
    ),
    misc: sec(
      "19. Disposiciones varias",
      "Si alguna cláusula resulta inaplicable, el resto sigue vigente. No exigir el cumplimiento de una cláusula no supone renunciar a ella. No puedes ceder tus derechos sin nuestro consentimiento; nosotros podemos cederlos en una reorganización o venta. Estos Términos están disponibles en 12 idiomas; si las versiones difieren, prevalece la inglesa salvo que la ley de tu país disponga otra cosa.",
    ),
    contact: sec("20. Contacto", "ProjectTeamForYou · {email}"),
  },
};
