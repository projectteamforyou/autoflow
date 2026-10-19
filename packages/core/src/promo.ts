/**
 * "More from Projectteamforyou" band shown on the website, the web app and the native shells.
 * Kept in core so every surface links to the same place with the same wording.
 */
export const STUDIO_URL = "https://projectteamforyou.com";

export interface StudioPromo {
  title: string;
  body: string;
  cta: string;
}

export const STUDIO_PROMO: Record<string, StudioPromo> = {
  en: { title: "More from Projectteamforyou", body: "Discover our other programs, apps and games — and support the team behind AutoFlow.", cta: "Visit projectteamforyou.com" },
  ko: { title: "프로젝트팀포유의 다른 작품", body: "프로젝트팀포유의 다양한 프로그램·앱·게임을 만나 보시고 지지해 주세요.", cta: "projectteamforyou.com 방문하기" },
  ja: { title: "Projectteamforyou のその他の作品", body: "Projectteamforyou のさまざまなプログラム・アプリ・ゲームをご覧いただき、応援してください。", cta: "projectteamforyou.com へ" },
  "zh-CN": { title: "Projectteamforyou 的更多作品", body: "探索 Projectteamforyou 的各类程序、应用和游戏，并支持我们。", cta: "访问 projectteamforyou.com" },
  "zh-TW": { title: "Projectteamforyou 的更多作品", body: "探索 Projectteamforyou 的各種程式、App 與遊戲，並支持我們。", cta: "前往 projectteamforyou.com" },
  es: { title: "Más de Projectteamforyou", body: "Descubre nuestros otros programas, apps y juegos, y apoya al equipo detrás de AutoFlow.", cta: "Visitar projectteamforyou.com" },
  fr: { title: "Plus de Projectteamforyou", body: "Découvrez nos autres logiciels, applis et jeux, et soutenez l’équipe derrière AutoFlow.", cta: "Visiter projectteamforyou.com" },
  de: { title: "Mehr von Projectteamforyou", body: "Entdecke unsere weiteren Programme, Apps und Spiele – und unterstütze das Team hinter AutoFlow.", cta: "projectteamforyou.com besuchen" },
  "pt-BR": { title: "Mais da Projectteamforyou", body: "Conheça nossos outros programas, apps e jogos — e apoie a equipe por trás do AutoFlow.", cta: "Visitar projectteamforyou.com" },
  ru: { title: "Другие проекты Projectteamforyou", body: "Познакомьтесь с другими нашими программами, приложениями и играми — и поддержите команду AutoFlow.", cta: "Перейти на projectteamforyou.com" },
  vi: { title: "Thêm từ Projectteamforyou", body: "Khám phá các chương trình, ứng dụng và trò chơi khác của chúng tôi — và ủng hộ đội ngũ AutoFlow.", cta: "Truy cập projectteamforyou.com" },
  id: { title: "Lainnya dari Projectteamforyou", body: "Temukan program, aplikasi, dan game kami lainnya — dan dukung tim di balik AutoFlow.", cta: "Kunjungi projectteamforyou.com" },
};

export const studioPromo = (lang: string): StudioPromo => STUDIO_PROMO[lang] ?? STUDIO_PROMO.en!;
