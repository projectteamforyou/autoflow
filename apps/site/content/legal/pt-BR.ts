import { sec, type Privacy, type Terms } from "../types.js";

export const privacy: Privacy = {
  seo: {
    title: "Política de Privacidade — AutoFlow",
    description: "Como o AutoFlow trata seus dados: processamento local, conta opcional, sincronização criptografada de ponta a ponta, sem anúncios nem venda de dados.",
  },
  h1: "Política de Privacidade",
  intro:
    "O AutoFlow foi feito para funcionar primeiro no seu aparelho. Esta política explica, em linguagem simples, quais informações os apps do AutoFlow para Windows e Android, o app web do AutoFlow e este site tratam, por quê, por quanto tempo e quais são os seus direitos.",
  sections: {
    controller: sec(
      "1. Controlador",
      "O controlador dos dados pessoais tratados por meio do AutoFlow é a **ProjectTeamForYou** (“nós”). Você pode falar conosco, inclusive com nosso encarregado de proteção de dados, pelo e-mail {email}.",
    ),
    summary: sec("2. Resumo", [
      "Seus fluxos, gravações, perfis do Keyforge e registros de execução são guardados e processados no seu aparelho.",
      "A conta é opcional. Se você criar uma, guardamos seu e-mail e um hash da sua senha.",
      "A sincronização tem criptografia de ponta a ponta. Nosso servidor guarda um texto cifrado que não conseguimos ler.",
      "As chaves de IA ficam criptografadas no seu aparelho e só são enviadas ao provedor de IA que você escolher.",
      "Sem anúncios, sem cookies de rastreamento, sem perfis analíticos e sem venda de dados pessoais.",
    ]),
    local: sec(
      "3. Dados que ficam no seu aparelho",
      "Fluxos, variáveis, gravações, capturas usadas na busca de imagem, resultados de OCR, perfis do Keyforge, registros do Ledger, configurações e conversas do Copilot são criados e processados localmente. Eles não chegam até nós, a menos que você os sincronize, publique ou compartilhe expressamente, como descrito abaixo.",
      "Você pode apagar esses dados a qualquer momento excluindo o item, limpando os dados do app ou desinstalando-o.",
    ),
    account: sec(
      "4. Conta opcional",
      "Se você criar uma conta, tratamos:",
      ["seu endereço de e-mail, para identificar a conta, fazer login e enviar mensagens essenciais do serviço (como redefinição de senha);", "um hash da senha gerado com um algoritmo moderno, de mão única e com salt — nunca guardamos nem vemos a sua senha;", "tokens de sessão, a data de criação da conta e os aparelhos conectados, para manter o serviço seguro."],
      "Usamos essas informações apenas para oferecer a conta e a sincronização. Não enviamos e-mails de marketing.",
    ),
    sync: sec(
      "5. Sincronização com criptografia de ponta a ponta",
      "Com a sincronização ligada, cada fluxo é criptografado no seu aparelho com AES-GCM, usando uma chave que nunca sai dos seus aparelhos de forma legível. Nosso servidor guarda só o texto cifrado e os metadados técnicos necessários: identificador do item, número de revisão, hash do conteúdo, tamanho e datas.",
      "Não conseguimos ler, analisar nem recuperar o conteúdo dos fluxos sincronizados. Se você perder o acesso a todos os aparelhos e à sua chave de criptografia, os dados criptografados não podem ser restaurados.",
    ),
    atlas: sec(
      "6. Modelos públicos do Atlas",
      "Se você publicar um modelo no Atlas, o modelo, a descrição, o nome de exibição que você escolher e a data de publicação ficam públicos. Antes da publicação, o servidor valida o modelo, verifica erros e atribui um rótulo de risco. As avaliações e denúncias que você enviar são guardadas com a sua conta para evitar abusos.",
      "Você pode despublicar seus modelos quando quiser. Cópias que outras pessoas já baixaram continuam nos aparelhos delas.",
    ),
    share: sec(
      "7. Links e arquivos compartilhados",
      "Um link de compartilhamento ou arquivo exportado contém o próprio fluxo, compactado e codificado, com um hash do conteúdo. Qualquer pessoa com o link ou o arquivo pode ler o fluxo, então não compartilhe fluxos com segredos. Ao abrir um link, o fluxo é decodificado no navegador ou no app de quem recebe.",
    ),
    ai: sec(
      "8. Copilot e suas chaves de IA",
      "O Copilot funciona com o provedor de IA que você escolher (por exemplo, um serviço compatível com OpenAI, a Anthropic ou um modelo local como Ollama ou LM Studio). Sua chave de API fica só no seu aparelho, criptografada (chave WebCrypto não extraível no navegador, Gerenciador de Credenciais do Windows, Android Keystore).",
      "Os comandos e o contexto que você aprovar são enviados diretamente do seu aparelho para esse provedor. Nós nunca recebemos suas chaves, comandos ou respostas. Antes do envio, o Copilot mostra o que será enviado e para onde. O que o provedor recebe segue a política de privacidade dele. No modo somente local, chamadas externas são bloqueadas.",
    ),
    android: sec(
      "9. Android: aviso sobre o serviço de acessibilidade",
      "O AutoFlow para Android usa a API AccessibilityService do Android porque é a única forma que o Android oferece para um app tocar, deslizar e executar ações globais por você. Nós a usamos para:",
      ["executar os gestos e ações globais (como Voltar ou Início) dos fluxos que você roda;", "ler texto na tela só enquanto um fluxo está rodando e só quando um passo que você adicionou exigir (por exemplo, “esperar até este texto aparecer”);", "detectar qual app está em primeiro plano, só para iniciar fluxos com gatilhos por app que você configurou."],
      "O serviço **não** coleta, guarda, compartilha nem transmite dados pessoais ou sensíveis, não registra o que você digita, não lê campos de senha e não é usado para publicidade. Ele fica desligado até você ligar, e você pode desligá-lo a qualquer momento em Configurações › Acessibilidade. O AutoFlow também pede a permissão de sobreposição (para o botão flutuante de parada) e a de notificações (para mostrar o status da execução), ambas sob o seu controle.",
    ),
    windows: sec(
      "10. Windows: aviso sobre hooks de entrada",
      "Para oferecer atalhos globais, o remapeamento do Keyforge e o gravador, o AutoFlow para Windows instala hooks de teclado e mouse de baixo nível enquanto esses recursos estão ligados. Os eventos de entrada são processados na memória do seu PC para detectar seus atalhos e remapeamentos; não são registrados e nunca são transmitidos.",
      "O gravador só captura entradas enquanto a gravação está ligada e o indicador está visível. O texto digitado em campos de senha é mascarado nas gravações.",
    ),
    website: sec(
      "11. Este site e o app web",
      "Não usamos cookies de rastreamento, pixels de publicidade nem ferramentas de análise de terceiros. O site guarda sua escolha de tema e idioma no armazenamento local do navegador, que nunca sai do seu aparelho. O app web guarda seus fluxos no armazenamento do navegador (IndexedDB).",
      "Nosso provedor de hospedagem trata dados técnicos como endereço IP, tipo de navegador e URL acessada para entregar as páginas e protegê-las contra ataques. Esses registros são mantidos por pouco tempo, só para segurança.",
    ),
    noSale: sec(
      "12. Sem anúncios e sem venda de dados",
      "O AutoFlow não tem publicidade. Não vendemos, alugamos nem compartilhamos dados pessoais para publicidade comportamental, e não criamos perfis sobre você.",
    ),
    processors: sec(
      "13. Operadores",
      "Trabalhamos com poucos fornecedores que tratam dados em nosso nome, com obrigações contratuais de confidencialidade e segurança:",
      ["**Cloudflare, Inc.** — hospedagem do site e do app web, entrega de conteúdo e proteção contra ataques;", "**Railway Corporation** — hospedagem da API e do banco de dados do AutoFlow (dados de conta, dados de sincronização criptografados, Atlas).", "Os downloads são oferecidos pelo **GitHub** (Windows) e pelo **Google Play** (Android), que tratam seus dados conforme as próprias políticas de privacidade."],
    ),
    transfers: sec(
      "14. Transferências internacionais",
      "Nossos fornecedores podem tratar dados nos Estados Unidos e em outros países. Quando a lei exige, usamos salvaguardas adequadas, como cláusulas contratuais padrão (inclusive as reconhecidas pela ANPD e pela Comissão Europeia), e informamos as transferências conforme as leis da Coreia e do Japão. Os fluxos sincronizados são criptografados antes de sair do seu aparelho.",
    ),
    retention: sec("15. Por quanto tempo guardamos os dados", [
      "Dados da conta: enquanto a conta existir.",
      "Dados de sincronização criptografados: até você apagar o item ou a conta.",
      "Após a exclusão da conta: removidos dos sistemas ativos imediatamente e dos backups em até 30 dias.",
      "Modelos do Atlas: até você despublicar ou excluir a conta; denúncias de abuso por até um ano.",
      "Registros de segurança: até 30 dias, salvo se forem necessários por mais tempo para investigar um incidente específico.",
    ]),
    rights: sec(
      "16. Seus direitos",
      "Dependendo de onde você mora, você tem direito de acessar, corrigir, excluir e exportar (portabilidade) seus dados pessoais, de restringir ou se opor ao tratamento e de revogar o consentimento a qualquer momento. Você pode exportar todos os seus fluxos pelo app quando quiser e excluir sua conta nas configurações. Para qualquer outro pedido, escreva para {email}. Respondemos em até 30 dias (ou no prazo menor exigido por lei) e podemos pedir a confirmação da sua identidade. Exercer seus direitos nunca vai trazer tratamento diferente para você.",
    ),
    gdpr: sec(
      "17. Espaço Econômico Europeu e Reino Unido (GDPR / UK GDPR)",
      "Tratamos dados de conta e sincronização para executar nosso contrato com você (art. 6(1)(b)), registros de segurança e prevenção de abusos com base no nosso legítimo interesse em manter o serviço seguro (art. 6(1)(f)) e qualquer item opcional com base no seu consentimento (art. 6(1)(a)), que pode ser revogado a qualquer momento. Você pode apresentar reclamação à autoridade de proteção de dados do seu país ou ao ICO do Reino Unido.",
    ),
    pipa: sec(
      "18. República da Coreia (PIPA)",
      "Itens coletados: e-mail e hash de senha (necessários para a conta), dados de sincronização criptografados e registros do serviço. Finalidade: gestão da conta, sincronização e segurança. Retenção e descarte: conforme a seção 15; arquivos eletrônicos são apagados de forma irrecuperável. Não fornecemos dados pessoais a terceiros, salvo como descrito aqui ou exigido por lei; operadores e transferências internacionais estão nas seções 13 e 14. Responsável pela privacidade: ProjectTeamForYou, {email}.",
      "Você também pode procurar o Centro de Denúncias de Violação de Informações Pessoais (privacy.kisa.or.kr, telefone 118) ou o Comitê de Mediação de Disputas de Informações Pessoais (www.kopico.go.kr, 1833-6972).",
    ),
    appi: sec(
      "19. Japão (APPI)",
      "Usamos informações pessoais apenas para as finalidades desta política e não as fornecemos a terceiros sem consentimento, exceto quando a lei permite. Os fornecedores e os países onde os dados são tratados estão nas seções 13 e 14. Você pode pedir divulgação, correção, suspensão de uso ou exclusão dos seus dados pelo e-mail {email}.",
    ),
    lgpd: sec(
      "20. Brasil (LGPD)",
      "Tratamos dados com base na execução de contrato, no legítimo interesse e no consentimento (art. 7º da LGPD). Você pode exercer os direitos do art. 18 — confirmação da existência de tratamento, acesso, correção, anonimização, bloqueio ou eliminação, portabilidade, informação sobre compartilhamento e revogação do consentimento — falando com nosso encarregado pelo e-mail {email}. Você também pode peticionar à Autoridade Nacional de Proteção de Dados (ANPD).",
    ),
    ccpa: sec(
      "21. Califórnia (CCPA / CPRA)",
      "Nos últimos 12 meses, coletamos identificadores (e-mail) e atividade de internet limitada a registros de segurança, para as finalidades descritas acima. Não vendemos nem compartilhamos informações pessoais e não usamos informações sensíveis para inferir características. Você tem direito de saber, excluir e corrigir suas informações e de não ser discriminado por exercer esses direitos. Você pode usar um agente autorizado; verificamos os pedidos antes de atendê-los.",
    ),
    security: sec("22. Segurança", [
      "criptografia TLS em todo o tráfego de rede e cabeçalhos de segurança rígidos nos nossos sites;", "criptografia de ponta a ponta dos fluxos sincronizados e criptografia no aparelho das chaves de IA;", "hash de senhas com salt, limitação de requisições e proteção contra ataques automatizados;", "acesso com privilégio mínimo aos sistemas de produção e atualização periódica de dependências.",
    ], "Nenhum sistema é totalmente seguro. Se um incidente afetar seus dados pessoais, avisaremos você e as autoridades conforme a lei."),
    children: sec(
      "23. Crianças e adolescentes",
      "O AutoFlow não é voltado a menores de 13 anos. Para criar uma conta é preciso ter pelo menos 13 anos — ou 16 no EEE e no Reino Unido (ou a idade de consentimento digital menor definida no seu país) e 14 na Coreia —, salvo com o consentimento de um dos pais ou responsável legal. Se soubermos que existe conta de criança sem o consentimento necessário, vamos excluí-la.",
    ),
    changes: sec(
      "24. Mudanças nesta política",
      "Publicaremos qualquer mudança nesta página e atualizaremos a data de vigência. Se uma mudança afetar de forma relevante o uso das suas informações, avisaremos no app ou por e-mail antes de ela valer.",
    ),
    contact: sec("25. Contato", "ProjectTeamForYou · {email}"),
  },
};

export const terms: Terms = {
  seo: {
    title: "Termos de Uso — AutoFlow",
    description: "As regras do AutoFlow: licença, uso aceitável, responsabilidade pelas automações, resultados de IA, modelos, garantias, responsabilidade e lei coreana.",
  },
  h1: "Termos de Uso",
  intro:
    "Estes Termos regem o uso do AutoFlow — os apps para Windows e Android, o app web, a API do AutoFlow, o Atlas e este site (juntos, o “Serviço”). Leia com atenção: eles foram escritos para serem entendidos.",
  sections: {
    agreement: sec(
      "1. Aceite",
      "O Serviço é oferecido pela **ProjectTeamForYou** (“nós”). Ao instalar, acessar ou usar o Serviço, você concorda com estes Termos e com a nossa Política de Privacidade. Se não concordar, não use o Serviço.",
    ),
    service: sec(
      "2. O Serviço",
      "O AutoFlow permite criar, ensaiar, executar e compartilhar automações (“fluxos”), como auto cliques, macros, atalhos, remapeamento de teclas e rotinas. Os recursos podem variar por plataforma. O Serviço é gratuito; recursos opcionais, como a sincronização criptografada, exigem conta.",
    ),
    eligibility: sec(
      "3. Requisitos e contas",
      "Você precisa ter pelo menos 13 anos para usar o Serviço, ou mais se a lei do seu país exigir (16 no EEE e no Reino Unido, 14 na Coreia), salvo com o consentimento de um dos pais ou responsável legal. Você é responsável por proteger seus dados de acesso e sua chave de criptografia e pelas atividades na sua conta.",
    ),
    license: sec(
      "4. Licença",
      "Concedemos a você uma licença pessoal, mundial, não exclusiva, intransferível e revogável para instalar e usar o Serviço para fins pessoais ou profissionais, conforme estes Termos. Você não pode vender, sublicenciar nem redistribuir os apps, nem fazer engenharia reversa além do que a lei permitir apesar desta restrição.",
    ),
    acceptable: sec(
      "5. Uso aceitável",
      "Você não pode usar o Serviço para:",
      [
        "burlar, resolver ou derrotar CAPTCHAs, verificações de identidade, confirmações de pagamento ou outras medidas de segurança;",
        "contornar sistemas anti-cheat ou obter vantagem indevida em jogos que proíbem automação;",
        "violar os termos de uso de apps, jogos ou sites de terceiros;",
        "enviar spam, criar contas automaticamente, inflar visualizações, votos ou outras métricas, ou cometer fraude;",
        "acessar sistemas ou dados sem autorização, coletar dados pessoais sem consentimento ou distribuir malware;",
        "assediar, prejudicar ou enganar outras pessoas, ou fazer qualquer coisa ilegal;",
        "sobrecarregar, atacar ou interferir no Serviço ou na sua infraestrutura, ou abusar do Atlas, de denúncias ou de avaliações.",
      ],
      "Podemos bloquear fluxos, modelos ou contas que violem estas regras.",
    ),
    responsibility: sec(
      "6. Você é responsável pelas suas automações",
      "É você quem decide o que seus fluxos fazem e onde rodam. Você é responsável pelos fluxos que cria, importa, executa e compartilha e pelas consequências deles — inclusive ações em apps de terceiros, compras, mensagens enviadas, dados alterados e restrições de conta impostas por outros. Teste fluxos novos ou importados no Practice Canvas, confira a pontuação de segurança e mantenha o Halt sempre à mão.",
    ),
    ai: sec(
      "7. Copilot e resultados de IA",
      "O Copilot usa o provedor de IA que você escolhe e configura com a sua chave ou um modelo local. Resultados de IA podem estar errados, incompletos ou ser inseguros. Os rascunhos são validados e pontuados, mas você deve revisar cada um antes de salvar ou executar. O uso do provedor segue os termos dele, e os custos que ele cobrar são seus.",
    ),
    content: sec(
      "8. Seu conteúdo, modelos e moderação",
      "Você mantém todos os direitos sobre os fluxos e demais conteúdos que cria. Ao publicar um modelo no Atlas, você nos concede uma licença mundial, gratuita e não exclusiva para hospedar, armazenar, exibir, formatar e distribuir o modelo dentro do Serviço enquanto ele estiver publicado, e concede aos demais usuários uma licença para usá-lo, copiá-lo e modificá-lo em suas próprias automações.",
      "Você garante que tem os direitos sobre o que publica e que isso cumpre estes Termos. Para manter o Atlas seguro, podemos revisar, rotular, ocultar ou remover modelos e suspender o direito de publicar — por exemplo, no caso de modelos de alto risco, enganosos, que violem direitos ou abusivos. Você pode denunciar conteúdo pelo app ou pelo e-mail {email}. Os modelos oficiais são exemplos e podem precisar de ajustes para o seu ambiente.",
    ),
    sync: sec(
      "9. Sincronização e disponibilidade",
      "A sincronização criptografada é opcional e, por enquanto, gratuita durante o lançamento. Trabalhamos para manter o Serviço disponível, mas ele pode ser interrompido por manutenção, falhas ou motivos fora do nosso controle. Como a sincronização tem criptografia de ponta a ponta, não conseguimos recuperar dados se você perder suas chaves. Guarde exportações dos fluxos importantes.",
    ),
    fees: sec(
      "10. Preço",
      "Tudo o que o Serviço oferece hoje é gratuito. Se no futuro criarmos recursos pagos, vamos anunciá-los com antecedência, eles não terão efeito retroativo, e automação local, Halt e exportação continuarão grátis.",
    ),
    ip: sec(
      "11. Nossa propriedade intelectual",
      "O nome, o logotipo, o software, os modelos oficiais e o site do AutoFlow pertencem à ProjectTeamForYou ou aos seus licenciantes e são protegidos por lei. Estes Termos não dão a você direitos sobre nossas marcas. Se você nos enviar sugestões, podemos usá-las sem qualquer obrigação com você.",
    ),
    thirdParty: sec(
      "12. Serviços de terceiros",
      "O Serviço interage com serviços que não controlamos, como seu sistema operacional, o Google Play, o GitHub, provedores de IA e os apps que você automatiza. O uso deles segue os termos e políticas de cada um, e não somos responsáveis por eles.",
    ),
    disclaimer: sec(
      "13. Isenção de garantias",
      "Na máxima extensão permitida por lei, o Serviço é oferecido “no estado em que se encontra” e “conforme disponível”, sem garantias de qualquer tipo, expressas ou implícitas, inclusive de comercialização, adequação a um fim específico e não violação. Não garantimos que os fluxos se comportem igual em todos os aparelhos nem que o Serviço esteja livre de erros. Nada aqui limita os direitos que o Código de Defesa do Consumidor ou outra lei aplicável garantem a você e que não podem ser afastados.",
    ),
    liability: sec(
      "14. Ausência de compensação e limitação de responsabilidade",
      "AutoFlow é fornecido gratuitamente e \"no estado em que se encontra\". Na máxima extensão permitida pela legislação aplicável, não oferecemos qualquer compensação, nem assumimos responsabilidade por quaisquer danos — diretos, indiretos, incidentais, especiais, consequenciais ou punitivos — incluindo, mas não se limitando a, perda de lucros, dados, contas ou fundo de comércio, decorrentes do Serviço, das automações que você criar ou executar, ou de modelos, resultados de IA ou serviços de terceiros. O uso das automações é de sua inteira responsabilidade, sendo imprescindível que você as verifique antes de executá-las. Esta disposição não exclui responsabilidades que não possam ser excluídas nos termos da legislação aplicável, tais como responsabilidade por dolo, culpa grave ou direitos obrigatórios do consumidor.",
    ),
    indemnity: sec(
      "15. Indenização",
      "Na medida permitida por lei, você concorda em nos ressarcir por reclamações de terceiros decorrentes dos seus fluxos, do seu conteúdo ou da violação destes Termos.",
    ),
    termination: sec(
      "16. Encerramento",
      "Você pode deixar de usar o Serviço a qualquer momento e excluir sua conta nas configurações do app. Podemos suspender ou encerrar o acesso se você violar estes Termos de forma grave ou repetida, se a lei exigir ou se encerrarmos o Serviço — nesse caso, avisaremos com antecedência razoável sempre que possível, para que você exporte seus dados. Cláusulas que por natureza devam continuar valendo após o encerramento continuarão válidas.",
    ),
    changes: sec(
      "17. Mudanças nestes Termos",
      "Podemos atualizar estes Termos. Publicaremos as mudanças nesta página pelo menos 7 dias antes de valerem, ou pelo menos 30 dias antes se forem desfavoráveis a você, e avisaremos os titulares de conta sobre mudanças relevantes. Se você continuar usando o Serviço depois, aceita as mudanças; se não concordar, deixe de usá-lo.",
    ),
    law: sec(
      "18. Lei aplicável e foro",
      "Estes Termos são regidos pelas leis da República da Coreia. Qualquer disputa sobre o Serviço será submetida ao Tribunal Distrital Central de Seul como foro de primeira instância, sem prejuízo das normas obrigatórias de proteção ao consumidor e do seu direito de recorrer aos tribunais do país onde você mora quando a lei garantir isso. Fale conosco primeiro — a maioria dos problemas se resolve rápido.",
    ),
    misc: sec(
      "19. Disposições gerais",
      "Se alguma cláusula for considerada inválida, o restante continua valendo. Deixar de exigir uma cláusula não significa renunciar a ela. Você não pode transferir seus direitos sem o nosso consentimento; nós podemos transferi-los em uma reorganização ou venda. Estes Termos estão disponíveis em 12 idiomas; se houver divergência, prevalece a versão em inglês, salvo se a lei do seu país determinar o contrário.",
    ),
    contact: sec("20. Contato", "ProjectTeamForYou · {email}"),
  },
};
