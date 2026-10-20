/** Plain-text transactional emails (English + Korean). */
import type { MailMessage } from "./mailer.js";

export function verifyEmailMessage(to: string, link: string): MailMessage {
  return {
    to,
    tag: "verify_email",
    subject: "Verify your AutoFlow email / AutoFlow 이메일 인증",
    text: [
      "Confirm your email address for AutoFlow:",
      link,
      "",
      "AutoFlow 이메일 주소를 인증하려면 위 링크를 여세요.",
      "",
      "If you did not create an account, ignore this email. / 계정을 만들지 않았다면 이 메일을 무시하세요.",
    ].join("\n"),
  };
}

export function passwordResetMessage(to: string, link: string, ttlMinutes: number): MailMessage {
  return {
    to,
    tag: "password_reset",
    subject: "Reset your AutoFlow password / AutoFlow 비밀번호 재설정",
    text: [
      `Reset your password (link valid for ${ttlMinutes} minutes):`,
      link,
      "",
      `비밀번호를 재설정하려면 위 링크를 여세요 (${ttlMinutes}분 동안 유효).`,
      "",
      "If you did not request this, ignore this email. Your password stays the same.",
      "요청하지 않았다면 이 메일을 무시하세요. 비밀번호는 바뀌지 않습니다.",
    ].join("\n"),
  };
}

export function passwordChangedMessage(to: string): MailMessage {
  return {
    to,
    tag: "password_changed",
    subject: "Your AutoFlow password was changed / AutoFlow 비밀번호 변경됨",
    text: [
      "Your AutoFlow password was just changed and all other sessions were signed out.",
      "AutoFlow 비밀번호가 변경되어 다른 모든 세션이 로그아웃되었습니다.",
      "",
      "If this was not you, reset your password immediately. / 본인이 아니라면 즉시 비밀번호를 재설정하세요.",
    ].join("\n"),
  };
}

export function accountDeletedMessage(to: string): MailMessage {
  return {
    to,
    tag: "account_deleted",
    subject: "Your AutoFlow account was deleted / AutoFlow 계정 삭제됨",
    text: ["Your AutoFlow account and all synced data were permanently deleted.", "AutoFlow 계정과 동기화된 모든 데이터가 영구 삭제되었습니다."].join("\n"),
  };
}
